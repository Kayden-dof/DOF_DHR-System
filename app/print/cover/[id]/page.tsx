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
  raw_lot_no: string; raw_item_code: string; thickness_band: string | null;
  supplier_name: string; coa_no: string; prod_name: string; qa_name: string;
  cancelled_reason: string | null;
}
interface MatRow {
  item_code: string; item_name: string; lot_no: string; usage_uom: string;
  qty: string; operation_name: string; product_lot_no: string | null;
}
interface LotRow {
  lot_no: string; item_code: string; item_name: string;
  qty_produced: number; qty_sample: number; qty_available: number;
  manufactured_on: string; expiry_date: string; status: string;
}
interface DayRow { day_no: number; worker_name: string; work_date: string; records: number; prints: number }

export default async function CoverSheet({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const d = await withActor(user.id, async (db) => {
    const head = await db.one<Head>(
      `select wo.batch_no, wo.wo_no, wo.status::text as status, wo.sheet_count,
              wo.dmr_revision, wo.issued_at, wo.cancelled_reason,
              i.code as item_code, i.name as item_name,
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
                operation_name, product_lot_id,
                (select lot_no from product_lot pl where pl.id = g.product_lot_id) as product_lot_no,
                (select usage_uom from item i2 where i2.code = g.item_code) as usage_uom
           from v_lot_genealogy g
          where work_order_id = $1
          order by item_code, material_lot_no`, [id]),
      lots: await db.rows<LotRow>(
        `select pl.lot_no, i.code as item_code, i.name as item_name,
                pl.qty_produced, pl.qty_sample, pl.qty_available,
                pl.manufactured_on, pl.expiry_date, pl.status::text as status
           from product_lot pl join item i on i.id = pl.item_id
          where pl.work_order_id = $1 order by i.code`, [id]),
      days: await db.rows<DayRow>(
        `select pr.day_no, u.full_name as worker_name,
                min(pr.work_date)::text as work_date, count(*)::int as records,
                (select count(*)::int from record_print rp
                  where rp.kind='DAY_RECORD' and rp.work_order_id = pr.work_order_id
                    and rp.day_no = pr.day_no and rp.worker_id = pr.worker_id) as prints
           from process_record pr join app_user u on u.id = pr.worker_id
          where pr.work_order_id = $1
          group by pr.work_order_id, pr.day_no, pr.worker_id, u.full_name
          order by pr.day_no, u.full_name`, [id]),
    };
  });

  if (!d) notFound();
  const { head, materials, lots, days } = d;

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
            <td>{head.item_name} ({head.item_code})</td>
            <th>제품표준서 개정</th>
            <td className="font-mono">{head.dmr_revision}</td>
          </tr>
          <tr>
            <th>원재료 로트</th>
            <td className="font-mono font-bold">
              {head.raw_lot_no}
              {head.thickness_band && <span className="ml-2">두께 {head.thickness_band}</span>}
            </td>
            <th>공급자 / 성적서</th>
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
            <td>작업지시 지정</td>
            <td>배치 전체</td>
          </tr>
          {materials.map((m, i) => (
            <tr key={i}>
              <td>{m.item_name} ({m.item_code})</td>
              <td className="font-mono">{m.lot_no}</td>
              <td className="text-right tnum">{Number(m.qty)} {m.usage_uom}</td>
              <td>{m.operation_name}</td>
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
              <td className="text-right tnum">{r.prints}</td>
            </tr>
          ))}
          <tr>
            <th colSpan={4} className="text-right">기록서 총 매수</th>
            <td className="text-right tnum font-bold">
              {days.reduce((s, r) => s + r.prints, 0)}
            </td>
          </tr>
        </tbody>
      </table>

      <SignRow roles={['생산 책임자', '품질 검토', '품질 책임자']} />
    </PrintFrame>
  );
}
