import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { PageHead, Panel, Empty, Tag } from '@/components/ui';
import { NewOrder, CancelOrder,
         type OrderRow, type ItemOpt, type SupplierOpt } from './order-forms';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; tone: string }> = {
  ORDERED: { label: '발주중', tone: 'info' },
  RECEIVED: { label: '입고 완료', tone: 'ok' },
  CANCELLED: { label: '취소', tone: 'faint' },
};

export default async function OrdersPage() {
  const user = await requireUser();

  const d = await withActor(user.id, async (db) => ({
    orders: await db.rows<OrderRow>(
      `select po.id, po.po_no, po.qty, po.unit_price, po.ordered_at, po.expected_at,
              po.status, i.code as item_code, i.name as item_name, i.usage_uom,
              s.name as supplier_name, u.full_name as ordered_by_name,
              (select count(*)::int from material_lot ml where ml.purchase_order_id = po.id) as lot_count
         from purchase_order po
         join item i on i.id = po.item_id
         join supplier s on s.id = po.supplier_id
         join app_user u on u.id = po.ordered_by
        order by po.ordered_at desc, po.po_no desc
        limit 200`),
    items: await db.rows<ItemOpt>(
      `select id, code, name, usage_uom, type::text as type from item
        where is_active and type <> 'FIN' order by type, code`),
    suppliers: await db.rows<SupplierOpt>(
      `select id, name, status from supplier order by status desc, name`),
    alerts: await db.rows<{ id: string; code: string; name: string; usage_uom: string;
      on_hand: string; on_order: string; min_stock: string; lead_days: number | null }>(
      `select id, code, name, usage_uom, on_hand, on_order, min_stock, lead_days
         from v_reorder_alert order by code`),
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
  }));

  return (
    <div className="space-y-5">
      <PageHead
        title="발주"
        note="발주중 수량은 최소 재고선 알림에 반영되어 같은 자재로 알림이 반복되지 않습니다."
        action={<NewOrder items={d.items} suppliers={d.suppliers} today={d.today ?? ''} />}
      />

      {d.alerts.length > 0 && (
        <Panel title="최소 재고선 아래" note="보유 + 발주중이 기준선에 못 미치는 품목">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">품목</th>
                  <th className="th text-right">보유</th>
                  <th className="th text-right">발주중</th>
                  <th className="th text-right">기준선</th>
                  <th className="th text-right">부족</th>
                  <th className="th text-right">리드타임</th>
                </tr>
              </thead>
              <tbody>
                {d.alerts.map((a) => (
                  <tr key={a.id}>
                    <td className="td">
                      <div className="text-sm">{a.name}</div>
                      <div className="font-mono text-xs text-faint">{a.code}</div>
                    </td>
                    <td className="td tnum text-right">{Number(a.on_hand)} {a.usage_uom}</td>
                    <td className="td tnum text-right text-muted">{Number(a.on_order)}</td>
                    <td className="td tnum text-right text-muted">{Number(a.min_stock)}</td>
                    <td className="td tnum text-right font-semibold text-warn">
                      {Number(a.min_stock) - Number(a.on_hand) - Number(a.on_order)}
                    </td>
                    <td className="td tnum text-right text-xs text-muted">
                      {a.lead_days ? `${a.lead_days}일` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel>
        {d.orders.length === 0 ? (
          <Empty>등록된 발주가 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">발주번호</th>
                  <th className="th">품목</th>
                  <th className="th">공급자</th>
                  <th className="th text-right">수량</th>
                  <th className="th text-right">단가</th>
                  <th className="th">발주일</th>
                  <th className="th">입고 예정</th>
                  <th className="th">상태</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {d.orders.map((o) => {
                  const st = STATUS[o.status] ?? { label: o.status, tone: 'quiet' };
                  return (
                    <tr key={o.id}>
                      <td className="td font-mono text-xs font-semibold">{o.po_no}</td>
                      <td className="td">
                        <div className="text-sm">{o.item_name}</div>
                        <div className="font-mono text-xs text-faint">{o.item_code}</div>
                      </td>
                      <td className="td text-xs">{o.supplier_name}</td>
                      <td className="td tnum text-right">{Number(o.qty)} {o.usage_uom}</td>
                      <td className="td tnum text-right text-muted">
                        {o.unit_price ? Number(o.unit_price).toLocaleString() : ''}
                      </td>
                      <td className="td tnum text-xs">{fmtDate(o.ordered_at)}</td>
                      <td className="td tnum text-xs text-muted">{fmtDate(o.expected_at)}</td>
                      <td className="td">
                        <Tag tone={st.tone}>{st.label}</Tag>
                        {o.lot_count > 0 && <Tag tone="quiet">로트 {o.lot_count}</Tag>}
                      </td>
                      <td className="td text-right">
                        {o.status === 'ORDERED' && <CancelOrder id={o.id} poNo={o.po_no} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
