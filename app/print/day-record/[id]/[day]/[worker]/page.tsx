import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import { logPrint } from '@/lib/print';
import PrintFrame, { Sheet, SignRow } from '@/components/print-frame';
import { dayRecordPayload, type RecRow } from '@/lib/print-payload';
import { chunkRows } from '@/lib/print-pages';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   제조기록서 (§7)

   일차 마감 시점 · 지시서 + 일차 + 작업자 단위
   배치번호, 일차·작업일, 작업자·순환자, 공정별 시작·종료,
   투입 자재 로트·수량, 재포장 수량, 작업자·생산 책임자 서명란

   인쇄하면 이 묶음이 잠긴다 (S04). 잠금 단위가 기록지 묶음 단위와 같아야
   같은 날 두 사람이 작업했을 때 각자 자기 것만 마감할 수 있다.

   순환자는 서명하지 않는다. 이름만 표시한다. 책임 주체는 작업자 하나다.
--------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   공정 기록이 A4 몇 장이 되는가

   쪽 번호 n / N 은 §7 이 모든 인쇄물에 요구한 항목이다. 종이가 흩어졌을 때
   몇 장짜리였는지를 그 장만 보고 알아야 한다. 그러려면 N 이 실제 매수와
   같아야 하고, 지금은 그것을 셀 사람이 여기밖에 없다.

   ── 값의 근거 ─────────────────────────────────────────────────────────────
   A4 세로 297mm 에서 위아래 여백 30mm 를 빼면 267mm 가 남는다.
   첫 장은 머리글 · 지시 내용 표 · 꼬리글이 약 115mm 를 쓰므로 공정 기록에
   150mm 가 남고, 한 줄이 투입 자재 두어 건을 담으면 약 15mm 다. 그래서 열 줄.
   이어지는 장은 표 머리글과 꼬리글만 있어 약 230mm 가 남아 열여덟 줄.

   DX2401 은 공정이 12개이므로 대개 한 장이다. 재작업 회차가 쌓인 날에만
   두 장이 된다.

   브라우저가 실제로 자르는 자리는 globals.css 의 @media print 가 정한다.
   여기 값이 그보다 넉넉해야 종이가 모자라지 않는다 - 모자란 쪽보다 남는
   쪽이 낫다.
--------------------------------------------------------------------------- */
const ROWS_FIRST = 10;
const ROWS_NEXT = 18;

/* ---------------------------------------------------------------------------
   재어 맞히지 않고 우리가 가른다 (4차 감사 B2)

   전에는 sheetsFor(records.length) 로 **몇 장이 될지 예측**하고 그 수를 종이에
   찍었다. 예측이 크면 있지도 않은 2쪽이 생기고(편철 표지가 그 수를 매수로
   옮겨 적으므로 검토자가 없는 종이를 찾는다), 작으면 브라우저가 자른 뒷장에
   배치번호도 자료 식별자도 쪽 번호도 없이 나갔다.

   §7 은 "몇 장이 될지 재어 맞히지 않는다" 고 못 박았다.

   이제 줄을 **우리가 나눠 장에 담는다.** 아래 값은 "브라우저가 몇 줄을
   넣을까" 라는 예측이 아니라 "우리가 한 장에 몇 줄을 담을까" 라는 결정이다.
   넉넉히 잡으면 장이 하나 늘 뿐이고, 늘어난 장에도 머리글과 쪽 번호가 붙는다.
--------------------------------------------------------------------------- */


/* ---------------------------------------------------------------------------
   공정 기록 표.

   장이 여럿일 때 이어지는 장이 같은 표를 다시 그린다. 그래서 함수로 뺀다.
   복제해 두면 한쪽만 고쳐져 두 장이 다른 표가 된다 (§10 "복제는 갈라진다").
--------------------------------------------------------------------------- */
function RecordTable({ rows, title }: { rows: RecRow[]; title: string }) {
  return (
      <>
        <h2 className="mt-5 text-sm font-bold text-black">{title}</h2>
        <table className="print-table mt-1.5">
          <thead>
            <tr>
              <th className="w-[5%] text-center">순번</th>
              <th className="w-[20%]">공정</th>
              <th className="w-[11%]">시작</th>
              <th className="w-[11%]">종료</th>
              <th className="w-[35%]">투입 자재 (로트 / 수량)</th>
              <th className="w-[18%]">비고</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="text-center tnum">
                  {r.operation_seq}
                  {r.attempt > 1 && <div className="text-[9px]">{r.attempt}회차</div>}
                </td>
                <td>
                  {r.operation_name}
                  <div className="font-mono text-[9px]">{r.operation_code}</div>
                  {/*
                    * 재단 이후 공정은 제품 로트 단위다. 제조번호만 적으면 그 로트가
                    * 어떤 규격이고 몇 개인지를 다른 서류에서 찾아야 한다. 규격은
                    * 재단에서야 정해지므로 여기가 규격이 처음 확정되어 적히는 자리다.
                    */}
                  {r.product_lot_no && (
                    <div className="mt-0.5">
                      <div className="font-mono text-[9px] font-bold">
                        제조번호 {r.product_lot_no}
                      </div>
                      {r.product_item_name && (
                        <div className="text-[9px]">
                          {r.product_item_name}
                          <span className="ml-1 font-mono">{r.product_item_code}</span>
                        </div>
                      )}
                      {r.product_qty !== null && (
                        <div className="text-[9px] tnum">
                          {r.product_qty} 개
                          {r.product_sample ? ` (샘플 ${r.product_sample})` : ''}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td className="tnum">{r.started_at ? fmtDateTime(r.started_at).slice(11) : ''}</td>
                <td className="tnum">{r.ended_at ? fmtDateTime(r.ended_at).slice(11) : ''}</td>
                <td>
                  {/*
                    * 정정한 줄에는 그 사실을 함께 적는다. 종이에서 잘못 적은 줄을
                    * 한 줄 긋고 사유를 적는 것과 같다. 원래 값은 감사추적에 있다.
                    */}
                  {r.issues.map((x, j) => (
                    <div key={j}>
                      {x.item_name} · <span className="font-mono">{x.lot_no}</span> ·{' '}
                      <span className="tnum">{Number(x.qty)} {x.usage_uom}</span>
                      {x.amend_reason && (
                        <div className="text-[9px]">정정 · {x.amend_reason}</div>
                      )}
                    </div>
                  ))}
                  {r.steril.map((v, j) => (
                    <div key={`s${j}`} className="font-bold">
                      위탁 발송 <span className="tnum">{v.qty}</span> 개
                      <span className="ml-1.5 font-mono font-normal">{v.batch_no}</span>
                    </div>
                  ))}
                  {r.issues.length === 0 && r.steril.length === 0 && r.no_material_reason && (
                    <span>{r.no_material_reason}</span>
                  )}
                </td>
                <td>
                  {r.equipment_id && <div>설비 {r.equipment_id}</div>}
                  {r.rework_qty ? <div className="tnum">재포장 {r.rework_qty}</div> : null}
                  {r.issues.length > 0 && r.no_material_reason && (
                    <div>{r.no_material_reason}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
    </>
  );
}

export default async function DayRecordSheet({ params }: {
  params: Promise<{ id: string; day: string; worker: string }>;
}) {
  const { id, day, worker } = await params;
  return <DayRecordDoc id={id} dayNo={Number(day)} worker={worker} />;
}

/* ---------------------------------------------------------------------------
   제조기록서 한 묶음

   낱장 발행과 묶음 발행이 같은 것을 그린다. 두 곳이 각자 그리면 갈라지고,
   종이가 정본인 시스템에서 그 어긋남은 되돌릴 수 없다 (§10).

   묶음 발행은 bare 로 부른다 - 인쇄 막대를 양식마다 내지 않는다.

   logPrint 는 여기서 부른다. **묶음 한 번에 대장 한 줄이 아니라 묶음마다 한
   줄**이 남아야 회차가 성립한다 (§7). 열 일차를 한 번에 뽑으면 열 줄이 남고
   각자 제 회차를 갖는다.
--------------------------------------------------------------------------- */
export async function DayRecordDoc({ id, dayNo, worker, bare = false }: {
  id: string; dayNo: number; worker: string; bare?: boolean;
}) {
  const user = await requireUser();

  /*
   * 자료는 lib/print-payload 에서 온다. 인쇄물 조회가 같은 것을 읽어
   * 자료 식별자를 다시 계산하므로, 두 곳이 갈라지면 안 된다.
   */
  const d = await withActor(user.id, (db) => dayRecordPayload(db, id, dayNo, worker));

  if (!d || d.records.length === 0) notFound();
  const { head, records } = d;
  const rotations = [...new Set(records.map((r) => r.rotation_name).filter(Boolean))];

  // 이 기록지에 걸린 위탁 멸균 배치와 규격별 발송 수량
  const sterilBatches = [
    ...new Map(
      records.flatMap((r) => r.steril).map((v) => [v.batch_no, v]),
    ).values(),
  ];
  /*
   * 이 기록지에 나오는 제품 로트를 규격별로 한 줄씩 모은다. 같은 로트가 여러
   * 공정에 걸쳐 나오므로 제조번호로 한 번만 남긴다.
   */
  const specLines = [
    ...new Map(
      records
        .filter((r) => r.product_lot_no)
        .map((r) => [r.product_lot_no!, {
          lot_no: r.product_lot_no!,
          item_code: r.product_item_code ?? '',
          item_name: r.product_item_name ?? '',
          produced: r.product_qty ?? 0,
          sample: r.product_sample ?? 0,
          steril: 0,
        }]),
    ).values(),
  ].sort((a, b) => a.item_code.localeCompare(b.item_code));

  for (const r of records) {
    if (!r.product_lot_no || r.steril.length === 0) continue;
    const line = specLines.find((l) => l.lot_no === r.product_lot_no);
    if (line) line.steril = r.steril.reduce((a, v) => a + v.qty, 0);
  }

  /* 줄을 장에 나눠 담는다. 장 수가 곧 pages 다 - 예측이 아니라 결과다 */
  const pageRows = chunkRows(records, ROWS_FIRST, ROWS_NEXT);
  const sheetCount = pageRows.length + (specLines.length > 0 ? 1 : 0);

  const meta = await logPrint({
    actorId: user.id, actorName: user.full_name, kind: 'DAY_RECORD',
    workOrderId: id, dayNo, workerId: worker,
    payload: { head, records },
    pages: sheetCount,
    lockDay: true,
  });

  return (
    <PrintFrame
      bare={bare}
      meta={meta}
      title="제조기록서"
      subtitle={<>배치 {head.batch_no} · {dayNo}일차 · {head.worker_name}</>}
      back={`/production/${id}`}
      after={<>
        {/*
          * 이어지는 장. 줄이 한 장에 안 담기면 여기서 장을 더 낸다.
          * 예측이 아니라 우리가 나눈 결과이므로 쪽 번호가 실제와 어긋날 수 없다.
          */}
        {pageRows.slice(1).map((rows, k) => (
          <Sheet key={k} meta={meta} page={k + 2}
                 title="제조기록서"
                 subtitle={<>배치 {head.batch_no} · {dayNo}일차 · {head.worker_name} · 이어짐</>}>
            <RecordTable rows={rows} title="공정 기록 (이어짐)" />
          </Sheet>
        ))}
        {specLines.length > 0 ? (
        /*
          * 생산 규격 기록지.
          *
          * 규격은 재단에서야 정해진다. 그전 공정은 배치 하나로 흐르고, 재단
          * 뒤로는 규격별로 갈려 각자 제조번호를 갖는다. 그래서 규격 내역을
          * 공정 기록 사이에 끼워 넣으면 같은 배치가 여러 건인 것처럼 읽힌다.
          * 장을 나눠 뒤에 붙인다.
          */
        <Sheet meta={meta} page={sheetCount}
               title="생산 규격 기록지"
               subtitle={<>배치 {head.batch_no} · {dayNo}일차 · {head.worker_name}</>}>
          <table className="print-table">
            <tbody>
              <tr>
                <th className="w-[15%]">배치번호</th>
                <td className="w-[35%] font-mono font-bold">{head.batch_no}</td>
                <th className="w-[15%]">원재료 로트</th>
                <td className="w-[35%] font-mono">{head.raw_lot_no}</td>
              </tr>
              <tr>
                <th>제품</th>
                <td>{head.item_name}</td>
                <th>장입 장수</th>
                <td className="tnum">{head.sheet_count} 장</td>
              </tr>
            </tbody>
          </table>

          <h2 className="mt-5 text-sm font-bold text-black">규격별 생산 수량</h2>
          <table className="print-table mt-1.5">
            <thead>
              <tr>
                <th className="w-[18%]">제조번호</th>
                <th className="w-[18%]">모델명</th>
                <th className="w-[26%]">규격</th>
                <th className="w-[10%] text-right">생산</th>
                <th className="w-[10%] text-right">샘플</th>
                <th className="w-[18%] text-right">멸균 발송</th>
              </tr>
            </thead>
            <tbody>
              {specLines.map((l) => (
                <tr key={l.lot_no}>
                  <td className="font-mono font-bold">{l.lot_no}</td>
                  <td className="font-mono">{l.item_code}</td>
                  <td>{l.item_name}</td>
                  <td className="text-right tnum">{l.produced}</td>
                  <td className="text-right tnum">{l.sample || ''}</td>
                  <td className="text-right tnum font-bold">{l.steril || ''}</td>
                </tr>
              ))}
              <tr>
                <th colSpan={3} className="text-right">합계</th>
                <td className="text-right tnum font-bold">
                  {specLines.reduce((a, l) => a + l.produced, 0)}
                </td>
                <td className="text-right tnum">
                  {specLines.reduce((a, l) => a + l.sample, 0) || ''}
                </td>
                <td className="text-right tnum font-bold">
                  {specLines.reduce((a, l) => a + l.steril, 0) || ''}
                </td>
              </tr>
            </tbody>
          </table>

          {sterilBatches.length > 0 && (
            <>
              <h2 className="mt-5 text-sm font-bold text-black">위탁 멸균</h2>
              {sterilBatches.map((b) => (
                <table key={b.batch_no} className="print-table mt-1.5">
                  <tbody>
                    <tr>
                      <th className="w-[15%]">멸균 배치</th>
                      <td className="w-[35%] font-mono font-bold">{b.batch_no}</td>
                      <th className="w-[15%]">위탁 업체</th>
                      <td className="w-[35%]">{b.vendor_name}</td>
                    </tr>
                    <tr>
                      <th>발송일</th>
                      <td className="tnum">{b.shipped_at ? fmtDate(b.shipped_at) : ''}</td>
                      <th>멸균 성적서</th>
                      <td className="font-mono">{b.cert_no ?? ''}</td>
                    </tr>
                  </tbody>
                </table>
              ))}
            </>
          )}

          <p className="mt-3 text-[10px] leading-relaxed text-black">
            규격은 재단 공정에서 확정됩니다. 이 표의 수량은 재단 결과이며 시스템이
            판정한 값이 아닙니다.
          </p>

          <SignRow roles={['작업자', '생산 책임자']} />
        </Sheet>
      ) : null}
      </>}
    >
      <table className="print-table">
        <tbody>
          <tr>
            <th className="w-[15%]">배치번호</th>
            <td className="w-[35%] font-mono font-bold">{head.batch_no}</td>
            <th className="w-[15%]">일차 / 작업일</th>
            <td className="w-[35%] tnum">
              {dayNo}일차 / {fmtDate(head.work_date)}
            </td>
          </tr>
          <tr>
            <th>제품</th>
            <td>{head.item_name} ({head.item_code})</td>
            <th>제품표준서 개정</th>
            <td className="font-mono">{head.dmr_revision}</td>
          </tr>
          <tr>
            <th>원재료 로트</th>
            <td className="font-mono font-bold">
              {head.raw_lot_no}
              <span className="ml-1.5 font-sans font-normal">({head.raw_item_code})</span>
            </td>
            <th>장입 장수 / 두께</th>
            <td className="tnum">
              {head.sheet_count} 장
              {head.raw_thickness && <> / {head.raw_thickness}</>}
            </td>
          </tr>
          <tr>
            <th>원재료 공급자</th>
            <td>
              {head.raw_supplier}
              <span className="ml-1.5 font-mono text-[10px]">{head.supplier_lot_no}</span>
            </td>
            <th>성적서</th>
            <td>
              <span className="font-mono">{head.raw_coa_no}</span>
              <span className="ml-1.5 tnum">{fmtDate(head.raw_coa_date)}</span>
            </td>
          </tr>
          <tr>
            <th>작업자</th>
            <td className="font-bold">{head.worker_name}</td>
            <th>순환자</th>
            <td>{rotations.length ? rotations.join(', ') : ''}</td>
          </tr>
        </tbody>
      </table>

      <RecordTable rows={pageRows[0]} title="공정 기록" />

      <p className="mt-2 text-[10px] leading-relaxed text-black">
        여기 적힌 것은 실제로 수행하고 투입한 내용입니다. 작업 지시서의 예정과 달라도
        시스템이 보정하지 않습니다. 순환자는 서명하지 않으며 이름만 표시합니다.
      </p>

      {/*
        * 작업자 옆에 생산 책임자를 둔다 (사용자 결정 2026-08-31).
        *
        * 본지에는 작업자만 있고 붙어 나가는 규격 기록지에만 생산 책임자가 있어,
        * 같은 묶음의 두 장이 서로 다른 결재선을 그리고 있었다. 종이가 정본인
        * 시스템에서 그 어긋남은 "누가 이 기록을 확인했는가" 에 두 개의 답이
        * 있다는 뜻이 된다.
        *
        * 시스템은 여기서도 판정하지 않는다 (§1). 빈 칸을 인쇄할 뿐이고 확인은
        * 사람이 종이 위에서 한다. 순환자는 여전히 서명하지 않는다 (§7).
        */}
      <SignRow roles={['작업자', '생산 책임자']} />
    </PrintFrame>
  );
}
