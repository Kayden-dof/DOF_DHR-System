import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { logPrint } from '@/lib/print';
import PrintFrame from '@/components/print-frame';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   출하 승인 요청서 (§7)
   출하 전 · 제품 로트 단위
   제품명·규격·제조번호, 요청 수량, 잔여 수량, 제조일·유효기한, 품질책임자 판정란

   판정란은 비워서 인쇄한다. 시스템은 판정하지 않는다 (§1).
   품질책임자는 시스템 계정이 없으므로 이름을 손으로 적고 서명한다.
--------------------------------------------------------------------------- */

interface Lot {
  lot_no: string; item_code: string; item_name: string;
  qty_produced: number; qty_sample: number; qty_available: number;
  manufactured_on: string; expiry_date: string; status: string;
  batch_no: string; raw_lot_no: string; shipped: number;
  steril_cert: string | null; steril_vendor: string | null; steril_received: string | null;
}

function spec(code: string): string {
  const m = code.match(/^PD(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return '';
  const mm = (s: string) => (Number(s) / 10).toFixed(1);
  return `${mm(m[1])} x ${mm(m[2])} cm · 두께 ${mm(m[3])}~${mm(m[4])} mm`;
}

export default async function ReleaseRequest({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ qty?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;

  const lot = await withActor(user.id, (db) =>
    db.one<Lot>(
      `select pl.lot_no, i.code as item_code, i.name as item_name,
              pl.qty_produced, pl.qty_sample, pl.qty_available,
              pl.manufactured_on, pl.expiry_date, pl.status::text as status,
              wo.batch_no, ml.lot_no as raw_lot_no,
              coalesce((select sum(sh.qty)::int from shipment sh
                         where sh.product_lot_id = pl.id), 0) as shipped,
              (select sb.cert_no from steril_batch_lot sbl
                 join steril_batch sb on sb.id = sbl.steril_batch_id
                where sbl.product_lot_id = pl.id and sb.cert_no is not null
                order by sb.received_at desc limit 1) as steril_cert,
              (select sb.vendor_name from steril_batch_lot sbl
                 join steril_batch sb on sb.id = sbl.steril_batch_id
                where sbl.product_lot_id = pl.id
                order by sb.received_at desc limit 1) as steril_vendor,
              (select sb.received_at::text from steril_batch_lot sbl
                 join steril_batch sb on sb.id = sbl.steril_batch_id
                where sbl.product_lot_id = pl.id
                order by sb.received_at desc limit 1) as steril_received
         from product_lot pl
         join item i on i.id = pl.item_id
         join work_order wo on wo.id = pl.work_order_id
         join material_lot ml on ml.id = wo.material_lot_id
        where pl.id = $1`, [id]));

  if (!lot) notFound();
  const requested = Number(sp.qty ?? 0) || lot.qty_available;

  const meta = await logPrint({
    actorId: user.id, actorName: user.full_name, kind: 'RELEASE_REQUEST',
    productLotId: id, payload: { lot, requested },
  });

  return (
    <PrintFrame
      meta={meta}
      title="출하 승인 요청서"
      subtitle={<>제조번호 {lot.lot_no}</>}
      back="/shipping"
    >
      <table className="print-table">
        <tbody>
          <tr>
            <th className="w-[18%]">제품명</th>
            <td className="w-[32%] text-base font-bold">{lot.item_name}</td>
            <th className="w-[18%]">모델명</th>
            <td className="w-[32%] font-mono font-bold">{lot.item_code}</td>
          </tr>
          <tr>
            <th>규격</th>
            <td colSpan={3}>{spec(lot.item_code)}</td>
          </tr>
          <tr>
            <th>제조번호</th>
            <td className="font-mono text-base font-bold">{lot.lot_no}</td>
            <th>배치번호</th>
            <td className="font-mono">{lot.batch_no}</td>
          </tr>
          <tr>
            <th>제조일</th>
            <td className="tnum">{fmtDate(lot.manufactured_on)}</td>
            <th>유효기한</th>
            <td className="tnum font-bold">{fmtDate(lot.expiry_date)}</td>
          </tr>
          <tr>
            <th>원재료 로트</th>
            <td className="font-mono">{lot.raw_lot_no}</td>
            <th>현재 상태</th>
            <td>{lot.status}</td>
          </tr>
          <tr>
            <th>멸균 위탁</th>
            <td>{lot.steril_vendor ?? ''}</td>
            <th>멸균 성적서</th>
            <td className="font-mono">{lot.steril_cert ?? ''}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-5 text-sm font-bold text-black">수량</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[20%] text-right">생산 수량</th>
            <th className="w-[20%] text-right">샘플 수량</th>
            <th className="w-[20%] text-right">기출고</th>
            <th className="w-[20%] text-right">잔여 수량</th>
            <th className="w-[20%] text-right">요청 수량</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-right tnum">{lot.qty_produced}</td>
            <td className="text-right tnum">{lot.qty_sample || ''}</td>
            <td className="text-right tnum">{lot.shipped || ''}</td>
            <td className="text-right tnum">{lot.qty_available}</td>
            <td className="text-right tnum text-base font-bold">{requested}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-6 text-sm font-bold text-black">품질책임자 판정</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[25%]">판정</th>
            <th className="w-[25%]">판정 일자</th>
            <th className="w-[25%]">품질책임자 성명</th>
            <th className="w-[25%]">서명</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sign-box" />
            <td className="sign-box" />
            <td className="sign-box" />
            <td className="sign-box" />
          </tr>
        </tbody>
      </table>

      <p className="mt-2 text-[10px] leading-relaxed text-black">
        판정란은 비워서 발행합니다. 시스템은 적합 여부를 판정하지 않으며 전자서명을 받지
        않습니다. 품질책임자는 시스템 계정을 쓰지 않으므로 성명을 직접 적고 서명합니다.
        승인된 내용은 관리자가 시스템에 옮겨 적습니다.
      </p>
    </PrintFrame>
  );
}
