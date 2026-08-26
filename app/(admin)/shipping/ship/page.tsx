import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { PageHead, Panel, Empty, Tag } from '@/components/ui';
import { ShipForm, type PlOpt } from '../shipping-forms';

export const dynamic = 'force-dynamic';

interface ShipRow {
  id: string; customer_name: string; qty: number; shipped_at: string;
  lot_no: string; item_code: string; item_name: string;
  batch_no: string; shipped_by_name: string;
}

export default async function ShipPage() {
  const user = await requireUser();

  const d = await withActor(user.id, async (db) => ({
    lots: await db.rows<PlOpt>(
      `select pl.id, pl.lot_no, i.code as item_code, i.name as item_name,
              pl.qty_available, wo.batch_no, pl.status::text as status,
              pl.expiry_date, pl.manufactured_on,
              pl.release_approved_by, pl.release_approved_on::text as release_approved_on,
              coalesce((select sum(sh.qty)::int from shipment sh
                         where sh.product_lot_id = pl.id), 0) as shipped
         from product_lot pl
         join item i on i.id = pl.item_id
         join work_order wo on wo.id = pl.work_order_id
        where pl.release_approved_by is not null and pl.qty_available > 0
        order by pl.expiry_date, pl.lot_no`),
    shipments: await db.rows<ShipRow>(
      `select sh.id, sh.customer_name, sh.qty, sh.shipped_at::text as shipped_at,
              pl.lot_no, i.code as item_code, i.name as item_name,
              wo.batch_no, u.full_name as shipped_by_name
         from shipment sh
         join product_lot pl on pl.id = sh.product_lot_id
         join item i on i.id = pl.item_id
         join work_order wo on wo.id = pl.work_order_id
         join app_user u on u.id = sh.shipped_by
        order by sh.shipped_at desc, sh.id desc limit 100`),
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
  }));

  return (
    <div className="space-y-5">
      <PageHead
        title="출고"
        note="출하 승인이 기록된 제품 로트만 출고할 수 있습니다. 출하 가능 수량을 넘길 수 없습니다."
      />

      <Panel title="출고 가능" note="유효기한이 이른 것부터">
        {d.lots.length === 0 ? (
          <Empty>
            출고할 수 있는 제품 로트가 없습니다. 출하 승인을 먼저 기록하십시오.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th">배치</th>
                  <th className="th text-right">출하 가능</th>
                  <th className="th text-right">기출고</th>
                  <th className="th">유효기한</th>
                  <th className="th">승인</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {d.lots.map((l) => {
                  const days = Math.round(
                    (new Date(l.expiry_date).getTime() - Date.now()) / 864e5);
                  return (
                    <tr key={l.id}>
                      <td className="td font-mono text-xs font-semibold">{l.lot_no}</td>
                      <td className="td">
                        <div className="text-sm">{l.item_name}</div>
                        <div className="font-mono text-xs text-faint">{l.item_code}</div>
                      </td>
                      <td className="td font-mono text-xs text-muted">{l.batch_no}</td>
                      <td className="td tnum text-right font-semibold">{l.qty_available}</td>
                      <td className="td tnum text-right text-muted">{l.shipped || ''}</td>
                      <td className="td tnum text-xs">
                        <span className={days <= 60 ? 'font-semibold text-warn' : ''}>
                          {fmtDate(l.expiry_date)}
                        </span>
                        <span className="ml-1 text-faint">{days}일</span>
                      </td>
                      <td className="td text-xs">
                        {l.release_approved_by}
                        <div className="tnum text-faint">{fmtDate(l.release_approved_on)}</div>
                      </td>
                      <td className="td">
                        <ShipForm lot={l} today={d.today ?? ''} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="출고 이력">
        {d.shipments.length === 0 ? (
          <Empty>출고 기록이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">출고일</th>
                  <th className="th">거래처</th>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th">배치</th>
                  <th className="th text-right">수량</th>
                  <th className="th">기록자</th>
                </tr>
              </thead>
              <tbody>
                {d.shipments.map((s) => (
                  <tr key={s.id}>
                    <td className="td tnum text-xs">{fmtDate(s.shipped_at)}</td>
                    <td className="td text-sm">{s.customer_name}</td>
                    <td className="td font-mono text-xs font-semibold">{s.lot_no}</td>
                    <td className="td text-sm">{s.item_name}</td>
                    <td className="td font-mono text-xs text-muted">{s.batch_no}</td>
                    <td className="td tnum text-right font-semibold">{s.qty}</td>
                    <td className="td text-xs text-muted">{s.shipped_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
