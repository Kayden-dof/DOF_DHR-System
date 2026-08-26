import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { MATERIAL_STATUS_LABEL } from '@/lib/forms';
import { PageHead, Panel, Empty, Tag } from '@/components/ui';
import ReceiveForm, { type ItemOpt, type SupplierOpt, type OrderOpt } from './receive-form';

export const dynamic = 'force-dynamic';

interface LotRow {
  id: string; lot_no: string; item_code: string; item_name: string; usage_uom: string;
  supplier_name: string; supplier_status: string; supplier_lot_no: string;
  coa_no: string; coa_date: string;
  qty_received: string; qty_available: string;
  status: string; expiry_date: string | null;
  thickness_band: string | null; used_in: number;
}

type Search = Promise<{ status?: string; q?: string }>;

export default async function MaterialLotsPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = sp.status || null;
  const q = (sp.q || '').trim() || null;

  const d = await withActor(user.id, async (db) => ({
    lots: await db.rows<LotRow>(
      `select ml.id, ml.lot_no, i.code as item_code, i.name as item_name, i.usage_uom,
              s.name as supplier_name, s.status as supplier_status, ml.supplier_lot_no,
              ml.coa_no, ml.coa_date, ml.qty_received, ml.qty_available,
              ml.status::text as status, ml.expiry_date, ml.thickness_band,
              (select count(distinct pr.work_order_id)::int
                 from material_issue mi join process_record pr on pr.id = mi.process_record_id
                where mi.material_lot_id = ml.id) as used_in
         from material_lot ml
         join item i on i.id = ml.item_id
         join supplier s on s.id = ml.supplier_id
        where ($1::text is null or ml.status::text = $1)
          and ($2::text is null
               or ml.lot_no ilike concat('%', $2::text, '%')
               or i.code ilike concat('%', $2::text, '%')
               or i.name ilike concat('%', $2::text, '%')
               or ml.coa_no ilike concat('%', $2::text, '%')
               or ml.supplier_lot_no ilike concat('%', $2::text, '%'))
        order by ml.received_at desc, ml.lot_no desc
        limit 200`, [status, q]),
    items: await db.rows<ItemOpt>(
      `select id, code, name, type::text as type, purchase_uom, usage_uom, conversion,
              shelf_life_months
         from item where is_active order by type, code`),
    suppliers: await db.rows<SupplierOpt>(
      `select id, name, status from supplier order by status desc, name`),
    orders: await db.rows<OrderOpt>(
      `select id, po_no, item_id, supplier_id, qty, unit_price
         from purchase_order where status = 'ORDERED' order by ordered_at desc`),
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
    counts: await db.rows<{ status: string; n: number }>(
      `select status::text as status, count(*)::int as n from material_lot group by status`),
  }));

  const byStatus = new Map(d.counts.map((c) => [c.status, c.n]));
  const total = d.counts.reduce((s, c) => s + c.n, 0);
  const link = (st?: string) => {
    const p = new URLSearchParams();
    if (st) p.set('status', st);
    if (q) p.set('q', q);
    const s = p.toString();
    return s ? `/material?${s}` : '/material';
  };

  return (
    <div className="space-y-5">
      <PageHead
        title="자재 로트"
        note="입고할 때 성적서 번호가 반드시 들어갑니다 (S02). 로트번호는 채번 규칙이 만들며 바코드 값으로 씁니다."
        action={<ReceiveForm items={d.items} suppliers={d.suppliers}
                             orders={d.orders} today={d.today ?? ''} />}
      />

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <a href={link()} className={`chip ${!status ? 'bg-brand text-white' : 'bg-canvas text-muted'}`}>
            전체 {total}
          </a>
          {Object.entries(MATERIAL_STATUS_LABEL).map(([code, label]) => (
            <a key={code} href={link(code)}
               className={`chip ${status === code ? 'bg-brand text-white' : 'bg-canvas text-muted'}`}>
              {label} {byStatus.get(code) ?? 0}
            </a>
          ))}
        </div>
        <form className="ml-auto flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q ?? ''} autoComplete="off"
                 placeholder="로트번호 · 품목 · 성적서" className="input h-9 w-64 text-xs" />
          <button className="btn-ghost h-9 px-3 text-xs">검색</button>
        </form>
      </div>

      <Panel>
        {d.lots.length === 0 ? (
          <Empty>해당하는 자재 로트가 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">로트번호</th>
                  <th className="th">품목</th>
                  <th className="th">공급자</th>
                  <th className="th">성적서</th>
                  <th className="th text-right">입고</th>
                  <th className="th text-right">잔여</th>
                  <th className="th">유효기한</th>
                  <th className="th">상태</th>
                  <th className="th text-right">사용 배치</th>
                </tr>
              </thead>
              <tbody>
                {d.lots.map((l) => {
                  const soon = l.expiry_date &&
                    new Date(l.expiry_date).getTime() - Date.now() < 30 * 864e5;
                  return (
                    <tr key={l.id}>
                      <td className="td font-mono text-xs font-semibold">
                        {l.lot_no}
                        {l.thickness_band && (
                          <span className="ml-1.5 text-faint">{l.thickness_band}</span>
                        )}
                      </td>
                      <td className="td">
                        <div className="text-sm">{l.item_name}</div>
                        <div className="font-mono text-xs text-faint">{l.item_code}</div>
                      </td>
                      <td className="td text-xs">
                        {l.supplier_name}
                        {l.supplier_status !== 'APPROVED' && <Tag tone="warn">미승인</Tag>}
                        <div className="font-mono text-xs text-faint">{l.supplier_lot_no}</div>
                      </td>
                      <td className="td">
                        <div className="font-mono text-xs">{l.coa_no}</div>
                        <div className="tnum text-xs text-faint">{fmtDate(l.coa_date)}</div>
                      </td>
                      <td className="td tnum text-right text-muted">
                        {Number(l.qty_received)} {l.usage_uom}
                      </td>
                      <td className="td tnum text-right font-semibold">
                        {Number(l.qty_available)}
                      </td>
                      <td className="td tnum text-xs">
                        {l.expiry_date
                          ? <span className={soon ? 'font-semibold text-warn' : ''}>
                              {fmtDate(l.expiry_date)}
                            </span>
                          : ''}
                      </td>
                      <td className="td">
                        <Tag tone={l.status === 'AVAILABLE' ? 'ok'
                                 : l.status === 'EXPIRED' ? 'warn'
                                 : l.status === 'DISPOSED' ? 'danger' : 'quiet'}>
                          {MATERIAL_STATUS_LABEL[l.status] ?? l.status}
                        </Tag>
                      </td>
                      <td className="td tnum text-right text-muted">{l.used_in || ''}</td>
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
