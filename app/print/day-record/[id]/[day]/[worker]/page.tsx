import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import { logPrint } from '@/lib/print';
import PrintFrame, { Sheet, SignRow } from '@/components/print-frame';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   제조기록서 (§7)

   일차 마감 시점 · 지시서 + 일차 + 작업자 단위
   배치번호, 일차·작업일, 작업자·순환자, 공정별 시작·종료,
   투입 자재 로트·수량, 재포장 수량, 작업자 서명란

   인쇄하면 이 묶음이 잠긴다 (S04). 잠금 단위가 기록지 묶음 단위와 같아야
   같은 날 두 사람이 작업했을 때 각자 자기 것만 마감할 수 있다.

   순환자는 서명하지 않는다. 이름만 표시한다. 책임 주체는 작업자 하나다.
--------------------------------------------------------------------------- */

interface Head {
  batch_no: string; wo_no: string; sheet_count: number; dmr_revision: string;
  item_code: string; item_name: string;
  raw_lot_no: string; raw_item_code: string; raw_supplier: string;
  raw_coa_no: string; raw_coa_date: string; raw_thickness: string | null;
  supplier_lot_no: string;
  worker_name: string; work_date: string;
}
interface RecRow {
  operation_seq: number; operation_code: string; operation_name: string;
  attempt: number;
  product_lot_no: string | null; product_item_code: string | null;
  product_item_name: string | null; product_qty: number | null;
  product_sample: number | null;
  started_at: Date | null; ended_at: Date | null;
  equipment_id: string | null; rework_qty: number | null; no_material_reason: string | null;
  rotation_name: string | null;
  issues: { item_code: string; item_name: string; lot_no: string;
            qty: string; usage_uom: string }[];
  // 위탁 멸균으로 나간 수량. 자재가 아니라 제품이라 투입 자재 칸에 들어가지 않는다.
  steril: { batch_no: string; qty: number; vendor_name: string;
            shipped_at: string | null; cert_no: string | null }[];
}

export default async function DayRecordSheet({ params }: {
  params: Promise<{ id: string; day: string; worker: string }>;
}) {
  const user = await requireUser();
  const { id, day, worker } = await params;
  const dayNo = Number(day);

  const d = await withActor(user.id, async (db) => {
    const head = await db.one<Head>(
      `select wo.batch_no, wo.wo_no, wo.sheet_count, wo.dmr_revision,
              i.code as item_code, i.name as item_name,
              ml.lot_no as raw_lot_no, ri.code as raw_item_code,
              s.name as raw_supplier, ml.coa_no as raw_coa_no,
              ml.coa_date::text as raw_coa_date, ml.thickness_band as raw_thickness,
              ml.supplier_lot_no,
              u.full_name as worker_name,
              (select min(pr.work_date)::text from process_record pr
                where pr.work_order_id = wo.id and pr.day_no = $2
                  and pr.worker_id = $3) as work_date
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
         join material_lot ml on ml.id = wo.material_lot_id
         join item ri on ri.id = ml.item_id
         join supplier s on s.id = ml.supplier_id
         join app_user u on u.id = $3
        where wo.id = $1`, [id, dayNo, worker]);
    if (!head) return null;

    return {
      head,
      records: await db.rows<RecRow>(
        `select o.seq as operation_seq, o.code as operation_code, o.name as operation_name,
                pr.attempt, pl.lot_no as product_lot_no,
                pi.code as product_item_code, pi.name as product_item_name,
                pl.qty_produced as product_qty, pl.qty_sample as product_sample,
                pr.started_at, pr.ended_at,
                pr.equipment_id, pr.rework_qty, pr.no_material_reason,
                ru.full_name as rotation_name,
                coalesce((
                  select json_agg(json_build_object(
                    'item_code', i.code, 'item_name', i.name, 'lot_no', ml.lot_no,
                    'qty', mi.qty, 'usage_uom', i.usage_uom) order by i.code)
                    from material_issue mi
                    join material_lot ml on ml.id = mi.material_lot_id
                    join item i on i.id = ml.item_id
                   where mi.process_record_id = pr.id), '[]'::json) as issues,
                /*
                 * 멸균은 위탁이라 자재를 넣는 공정이 아니라 제품을 내보내는 공정이다.
                 * 몇 개가 나갔는지가 기록서에 없으면 회수 수량과 대조할 근거가 없다.
                 * 수량은 steril_batch_lot 에 있고 제품 로트로 이어 붙인다.
                 */
                coalesce((
                  select json_agg(json_build_object(
                    'batch_no', sb.batch_no, 'qty', sbl.qty,
                    'vendor_name', sb.vendor_name,
                    'shipped_at', sb.shipped_at::text, 'cert_no', sb.cert_no)
                    order by sb.batch_no)
                    from steril_batch_lot sbl
                    join steril_batch sb on sb.id = sbl.steril_batch_id
                   where pr.product_lot_id is not null
                     and sbl.product_lot_id = pr.product_lot_id), '[]'::json) as steril
           from process_record pr
           join dmr_operation o on o.id = pr.operation_id
           left join product_lot pl on pl.id = pr.product_lot_id
           left join item pi on pi.id = pl.item_id
           left join app_user ru on ru.id = pr.rotation_worker_id
          where pr.work_order_id = $1 and pr.day_no = $2 and pr.worker_id = $3
          order by o.seq, pr.attempt`, [id, dayNo, worker]),
    };
  });

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

  const meta = await logPrint({
    actorId: user.id, actorName: user.full_name, kind: 'DAY_RECORD',
    workOrderId: id, dayNo, workerId: worker,
    payload: { head, records },
    // 규격 기록지가 붙으면 두 장이다. 쪽 번호가 실제 매수와 맞아야 한다.
    pages: specLines.length > 0 ? 2 : 1,
    lockDay: true,
  });

  return (
    <PrintFrame
      meta={meta}
      title="제조기록서"
      subtitle={<>배치 {head.batch_no} · {dayNo}일차 · {head.worker_name}</>}
      back={`/production/${id}`}
      after={specLines.length > 0 ? (
        /*
          * 생산 규격 기록지.
          *
          * 규격은 재단에서야 정해진다. 그전 공정은 배치 하나로 흐르고, 재단
          * 뒤로는 규격별로 갈려 각자 제조번호를 갖는다. 그래서 규격 내역을
          * 공정 기록 사이에 끼워 넣으면 같은 배치가 여러 건인 것처럼 읽힌다.
          * 장을 나눠 뒤에 붙인다.
          */
        <Sheet meta={meta} page={2}
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

      <h2 className="mt-5 text-sm font-bold text-black">공정 기록</h2>
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
          {records.map((r, i) => (
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
                {r.issues.map((x, j) => (
                  <div key={j}>
                    {x.item_name} · <span className="font-mono">{x.lot_no}</span> ·{' '}
                    <span className="tnum">{Number(x.qty)} {x.usage_uom}</span>
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

      <p className="mt-2 text-[10px] leading-relaxed text-black">
        여기 적힌 것은 실제로 수행하고 투입한 내용입니다. 작업 지시서의 예정과 달라도
        시스템이 보정하지 않습니다. 순환자는 서명하지 않으며 이름만 표시합니다.
      </p>

      <SignRow roles={['작업자']} />
    </PrintFrame>
  );
}
