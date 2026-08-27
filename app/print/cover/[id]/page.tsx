import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import { logPrint } from '@/lib/print';
import PrintFrame, { SignRow } from '@/components/print-frame';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   편철 표지 (§7)
   로트 종료 시점 · 배치 단위
   배치 요약, 전체 투입 자재, 생성된 제품 로트 목록, 일차별 기록서 매수,
   품질 검토 서명란
--------------------------------------------------------------------------- */

interface Head {
  batch_no: string; wo_no: string; status: string; sheet_count: number;
  dmr_revision: string; issued_at: Date; item_code: string; item_name: string;
  product_code: string | null; product_name: string | null;
  raw_lot_no: string; raw_item_code: string; thickness_band: string | null;
  supplier_name: string; coa_no: string; prod_name: string; qa_name: string;
  cancelled_reason: string | null;
}
interface MatRow {
  item_code: string; item_name: string; lot_no: string; usage_uom: string;
  qty: string; operation_name: string; product_lot_no: string | null;
  day_no: number; attempt: number;
}
interface LotRow {
  lot_no: string; item_code: string; item_name: string;
  qty_produced: number; qty_sample: number; qty_available: number;
  manufactured_on: string; expiry_date: string; status: string;
}
interface DayRow {
  day_no: number; worker_name: string; work_date: string;
  records: number; prints: number; issues: number;
}

export default async function CoverSheet({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const d = await withActor(user.id, async (db) => {
    const head = await db.one<Head>(
      `select wo.batch_no, wo.wo_no, wo.status::text as status, wo.sheet_count,
              wo.dmr_revision, wo.issued_at, wo.cancelled_reason,
              i.code as item_code, i.name as item_name,
              dm.product_code, dm.product_name,
              ml.lot_no as raw_lot_no, ri.code as raw_item_code, ml.thickness_band,
              s.name as supplier_name, ml.coa_no,
              up.full_name as prod_name, uq.full_name as qa_name
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
         join material_lot ml on ml.id = wo.material_lot_id
         join item ri on ri.id = ml.item_id
         join supplier s on s.id = ml.supplier_id
         join app_user up on up.id = wo.issued_by_prod
         join app_user uq on uq.id = wo.issued_by_qa
        where wo.id = $1`, [id]);
    if (!head) return null;

    return {
      head,
      materials: await db.rows<MatRow>(
        `select item_code, item_name, material_lot_no as lot_no, qty,
                operation_name, product_lot_id, day_no, attempt,
                (select lot_no from product_lot pl where pl.id = g.product_lot_id) as product_lot_no,
                (select usage_uom from item i2 where i2.code = g.item_code) as usage_uom
           from v_lot_genealogy g
          where work_order_id = $1
          order by item_code, material_lot_no, day_no, attempt, product_lot_no`, [id]),
      lots: await db.rows<LotRow>(
        `select pl.lot_no, i.code as item_code, i.name as item_name,
                pl.qty_produced, pl.qty_sample, pl.qty_available,
                pl.manufactured_on, pl.expiry_date, pl.status::text as status
           from product_lot pl join item i on i.id = pl.item_id
          where pl.work_order_id = $1 order by i.code`, [id]),
      days: await db.rows<DayRow>(
        `select pr.day_no, u.full_name as worker_name,
                min(pr.work_date)::text as work_date, count(*)::int as records,
                /*
                 * 인쇄 "횟수"가 아니라 실제 장수를 센다. 제조기록서는 생산 규격
                 * 기록지까지 두 장이 되기도 한다. 표지의 매수와 실제 종이가
                 * 어긋나면 이 표지가 존재하는 이유가 사라진다.
                 *
                 * 재발행분은 세지 않는다. 마지막에 뽑은 것만 편철에 들어간다.
                 */
                coalesce((
                  select rp.pages from record_print rp
                   where rp.kind='DAY_RECORD' and rp.work_order_id = pr.work_order_id
                     and rp.day_no = pr.day_no and rp.worker_id = pr.worker_id
                   order by rp.seq desc limit 1), 0) as prints,
                (select count(*)::int from record_print rp
                  where rp.kind='DAY_RECORD' and rp.work_order_id = pr.work_order_id
                    and rp.day_no = pr.day_no and rp.worker_id = pr.worker_id) as issues
           from process_record pr join app_user u on u.id = pr.worker_id
          where pr.work_order_id = $1
          group by pr.work_order_id, pr.day_no, pr.worker_id, u.full_name
          order by pr.day_no, u.full_name`, [id]),
      /*
       * 편철 서류 목록의 재료. 이 배치에서 시스템이 발행한 양식들의 마지막
       * 회차와, 서면으로만 존재하는 문서(멸균 성적서 원본, 원재료 성적서
       * 사본)의 번호다. 목록은 사실이고, 실제로 철했는지는 사람이 확인란에
       * 표시한다.
       */
      /* 특채가 있으면 그 기록지도 이 묶음에 철한다 */
      concessions: await db.rows<{ concession_doc_no: string; qty: number }>(
        `select concession_doc_no, qty from v_batch_concession
          where work_order_id = $1 order by concession_doc_no`, [id]),
      prints: await db.rows<{ kind: string; latest: number; count: number }>(
        `select kind::text as kind, max(seq)::int as latest, count(*)::int as count
           from record_print
          where work_order_id = $1 and kind in ('WORK_ORDER','LABEL_REQUEST')
          group by kind`, [id]),
      requests: await db.rows<{ seq: number }>(
        `select seq from record_print
          where work_order_id = $1 and kind = 'RELEASE_REQUEST'
          order by seq`, [id]),
      certs: await db.rows<{ cert_no: string; vendor_name: string }>(
        `select distinct sb.cert_no, sb.vendor_name
           from steril_batch sb
           join steril_batch_lot sbl on sbl.steril_batch_id = sb.id
           join product_lot pl on pl.id = sbl.product_lot_id
          where pl.work_order_id = $1 and sb.cert_no is not null
          order by sb.cert_no`, [id]),
    };
  });

  if (!d) notFound();
  const { head, materials, lots, days, prints, requests, certs, concessions } = d;

  // 아직 남아 있는 것. 사실만 적고 판정하지 않는다 (§10).
  const openDays = days.filter((r) => r.prints === 0).length;
  const open = [
    head.status !== 'DONE' && head.status !== 'CANCELLED' && '배치 미종료',
    openDays > 0 && `기록서 미발행 ${openDays}건`,
    lots.length === 0 && '재단 전',
  ].filter(Boolean) as string[];

  const meta = await logPrint({
    actorId: user.id, actorName: user.full_name, kind: 'COVER',
    workOrderId: id, payload: { head, materials, lots, days },
  });

  return (
    <PrintFrame
      meta={meta}
      title="제조기록 편철 표지"
      subtitle={<>배치 {head.batch_no}</>}
      back={`/production/${id}`}
    >
      <table className="print-table">
        <tbody>
          <tr>
            <th className="w-[15%]">배치번호</th>
            <td className="w-[35%] font-mono font-bold">{head.batch_no}</td>
            <th className="w-[15%]">지시서번호</th>
            <td className="w-[35%] font-mono">{head.wo_no}</td>
          </tr>
          <tr>
            <th>제품</th>
            <td>
              {head.product_name ?? head.item_name}{' '}
              (<span className="font-mono">{head.product_code ?? head.item_code}</span>)
              {head.product_code && (
                <span className="ml-2">형명 <span className="font-mono">{head.item_code}</span></span>
              )}
            </td>
            <th>제품표준서 개정</th>
            <td className="font-mono">{head.dmr_revision}</td>
          </tr>
          <tr>
            <th>원재료 로트</th>
            <td className="font-mono font-bold">
              {head.raw_lot_no}
              {head.thickness_band && <span className="ml-2">두께 {head.thickness_band}</span>}
            </td>
            <th>원재료 공급자 / 성적서</th>
            <td>{head.supplier_name} / {head.coa_no}</td>
          </tr>
          <tr>
            <th>장입 장수</th>
            <td className="tnum">{head.sheet_count} 장</td>
            <th>발행</th>
            <td className="tnum">
              {fmtDate(head.issued_at)} · {head.prod_name} / {head.qa_name}
            </td>
          </tr>
        </tbody>
      </table>

      {/*
        * 편철 표지는 배치가 끝난 뒤에 뽑는다 (§7 "로트 종료"). 표지에 적히는
        * 값이 기록이 쌓일수록 바뀌기 때문이다. 일찍 뽑는 것을 막지는 않지만
        * (§2 차단은 다섯 개뿐이다), 그 종이에는 아직 끝나지 않았다고 적어 둔다.
        * 나중에 이 종이만 보고 완결된 묶음으로 오해하지 않게 한다.
        */}
      {open.length > 0 && (
        <p className="mt-3 border-2 border-black p-2 text-xs font-bold text-black">
          이 배치는 아직 끝나지 않았습니다 ({open.join(' · ')}).
          편철은 배치가 끝난 뒤에 합니다. 지금 이 표지의 매수와 목록은 확정값이 아닙니다.
        </p>
      )}

      {head.cancelled_reason && (
        <p className="mt-3 border border-black p-2 text-xs font-bold text-black">
          취소된 배치입니다. 사유: {head.cancelled_reason}
        </p>
      )}

      <h2 className="mt-5 text-sm font-bold text-black">생성된 제품 로트</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[18%]">제조번호</th>
            <th className="w-[26%]">형명</th>
            <th className="w-[10%] text-right">생산</th>
            <th className="w-[10%] text-right">샘플</th>
            <th className="w-[12%] text-right">출하 가능</th>
            <th className="w-[12%]">제조일</th>
            <th className="w-[12%]">유효기한</th>
          </tr>
        </thead>
        <tbody>
          {lots.length === 0 ? (
            <tr><td colSpan={7} className="text-center">재단하지 않았습니다.</td></tr>
          ) : lots.map((l) => (
            <tr key={l.lot_no}>
              <td className="font-mono font-bold">{l.lot_no}</td>
              <td>{l.item_name}<div className="font-mono text-[9px]">{l.item_code}</div></td>
              <td className="text-right tnum">{l.qty_produced}</td>
              <td className="text-right tnum">{l.qty_sample || ''}</td>
              <td className="text-right tnum">{l.qty_available}</td>
              <td className="tnum">{fmtDate(l.manufactured_on)}</td>
              <td className="tnum">{fmtDate(l.expiry_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-5 text-sm font-bold text-black">전체 투입 자재</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[24%]">자재</th>
            <th className="w-[18%]">로트번호</th>
            <th className="w-[12%] text-right">수량</th>
            <th className="w-[26%]">공정</th>
            <th className="w-[20%]">제품 로트</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{head.raw_item_code} (원재료)</td>
            <td className="font-mono font-bold">{head.raw_lot_no}</td>
            <td className="text-right tnum">{head.sheet_count} 장</td>
            <td>작업 지시 지정</td>
            <td>배치 전체</td>
          </tr>
          {/*
            * 같은 자재 · 같은 로트 행이 여러 번 나오는 것은 중복이 아니다.
            * 재단 이후 공정은 제품 로트별로 불출이 갈리고 (§3), 같은 공정을
            * 두 번 한 것은 회차가 다른 두 번의 불출이다. 합치면 §8.3 의
            * 정추적이 끊긴다. 대신 갈린 이유(일차 · 회차 · 제품 로트)를
            * 행마다 적어 종이만 봐도 알게 한다.
            */}
          {materials.map((m, i) => (
            <tr key={i}>
              <td>{m.item_name} ({m.item_code})</td>
              <td className="font-mono">{m.lot_no}</td>
              <td className="text-right tnum">{Number(m.qty)} {m.usage_uom}</td>
              <td>
                {m.operation_name}
                <span className="tnum"> · {m.day_no}일차</span>
                {m.attempt > 1 && <span className="tnum font-bold"> · {m.attempt}회차</span>}
              </td>
              <td className="font-mono">{m.product_lot_no ?? '배치 전체'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-5 text-sm font-bold text-black">일차별 기록서</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[14%] text-center">일차</th>
            <th className="w-[22%]">작업일</th>
            <th className="w-[28%]">작업자</th>
            <th className="w-[18%] text-right">기록 건수</th>
            <th className="w-[18%] text-right">매수</th>
          </tr>
        </thead>
        <tbody>
          {days.length === 0 ? (
            <tr><td colSpan={5} className="text-center">기록이 없습니다.</td></tr>
          ) : days.map((r, i) => (
            <tr key={i}>
              <td className="text-center tnum">{r.day_no}</td>
              <td className="tnum">{fmtDate(r.work_date)}</td>
              <td>{r.worker_name}</td>
              <td className="text-right tnum">{r.records}</td>
              <td className="text-right tnum">
                {r.prints || '미발행'}
                {r.issues > 1 && (
                  <span className="ml-1 text-[9px]">재발행 {r.issues - 1}</span>
                )}
              </td>
            </tr>
          ))}
          <tr>
            <th colSpan={4} className="text-right">기록서 총 매수 (이 장 제외)</th>
            <td className="text-right tnum font-bold">
              {days.reduce((s, r) => s + r.prints, 0)}
            </td>
          </tr>
        </tbody>
      </table>

      {/*
        * 이 묶음에 무엇이 철해져야 하는가 (사용자 요청 2026-08-27).
        *
        * 시스템이 발행한 양식은 마지막 회차와 매수를 사실로 적고, 서면으로만
        * 존재하는 문서(멸균 성적서 원본, 원재료 성적서 사본)는 번호만 적는다.
        * 철 확인란은 비워서 낸다 - 실제로 철했는지는 편철하는 사람이 종이
        * 위에서 표시한다. 시스템은 목록까지만 안다.
        *
        * 설비 사용 기록은 여기 없다. 그건 배치 묶음이 아니라 설비별 이력
        * 파일에 철하는 문서다.
        */}
      <h2 className="mt-5 text-sm font-bold text-black">편철 서류 목록</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[6%] text-center">순번</th>
            <th className="w-[30%]">서류</th>
            <th className="w-[40%]">시스템 기록</th>
            <th className="w-[12%] text-right">매수</th>
            <th className="w-[12%] text-center">철 확인</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            const wp = prints.find((x) => x.kind === 'WORK_ORDER');
            const lp = prints.find((x) => x.kind === 'LABEL_REQUEST');
            const dayPages = days.reduce((a, r) => a + r.prints, 0);
            const rows: { name: string; fact: React.ReactNode; pages: string }[] = [
              { name: '편철 표지 (이 장)',
                fact: <>발행 {meta.seq}회차 · 식별자 {meta.dataHash.slice(0, 12)}</>,
                pages: '1' },
              { name: '작업 지시서',
                fact: wp
                  ? <>최종 {wp.latest}회차 발행분{wp.count > 1 && ` (총 ${wp.count}회 발행)`}</>
                  : '발행 이력 없음',
                pages: wp ? '1' : '-' },
              { name: '제조기록서 (일차 · 작업자별)',
                fact: <>{days.length}묶음{days.some((r) => r.prints === 0) &&
                        ` · 미발행 ${days.filter((r) => r.prints === 0).length}건`}
                        {' '}· 재단 일차는 생산 규격 기록지 포함</>,
                pages: String(dayPages || '-') },
              { name: '라벨요청서',
                fact: lp ? <>최종 {lp.latest}회차 발행분</> : '발행 이력 없음',
                pages: lp ? '1' : '-' },
              { name: '출하 승인 요청서 (서면 승인 원본)',
                fact: requests.length === 0
                  ? '발행 이력 없음'
                  : <span className="font-mono">
                      {requests.map((r) =>
                        `RR-${head.batch_no}-${String(r.seq).padStart(2, '0')}`).join(' · ')}
                    </span>,
                pages: requests.length ? String(requests.length) : '-' },
              { name: '멸균 성적서 (외부 원본)',
                fact: certs.length === 0
                  ? '회수된 성적서 없음'
                  : <span className="font-mono">
                      {certs.map((c) => c.cert_no).join(' · ')}
                    </span>,
                pages: certs.length ? String(certs.length) : '-' },
              /*
                * 특채 기록지. 품질팀이 발행한 종이이고 시스템은 그 문서 코드만
                * 안다. 특채가 없으면 이 줄 자체가 나오지 않는다 - 없는 서류를
                * 목록에 세워 두면 찾다가 시간을 버린다.
                */
              ...(concessions.length > 0 ? [{
                name: '특채 기록지 (품질팀 발행)',
                fact: (
                  <span className="font-mono">
                    {concessions.map((c) => `${c.concession_doc_no} (${c.qty}개)`).join(' · ')}
                  </span>
                ),
                pages: String(concessions.length),
              }] : []),
              { name: '원재료 성적서 사본',
                fact: <span className="font-mono">{head.coa_no}</span>,
                pages: '1' },
            ];
            return rows.map((r, i) => (
              <tr key={i}>
                <td className="text-center tnum">{i + 1}</td>
                <td className="font-bold">{r.name}</td>
                <td className="text-[10px]">{r.fact}</td>
                <td className="text-right tnum">{r.pages}</td>
                <td className="sign-box" style={{ height: 'auto' }} />
              </tr>
            ));
          })()}
        </tbody>
      </table>
      <p className="mt-1.5 text-[10px] leading-relaxed text-black">
        목록과 회차 · 매수는 시스템 발행 기록입니다. 철 확인란은 편철하는 사람이
        서류를 편철하며 대조 표시합니다. 설비 사용 기록은 배치 묶음이 아니라 설비별
        이력 파일에 철합니다.
      </p>

      <SignRow roles={['생산 책임자', '품질 검토', '품질 책임자']} />
    </PrintFrame>
  );
}
