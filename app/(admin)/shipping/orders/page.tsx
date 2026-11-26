import { requireUser, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { isViewerOnly } from '@/lib/roles';
import { withUser } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { SHIPPING_NAV } from '../../sections';
import { fmtDate } from '@/lib/fmt';
import { Panel, Empty, Tag } from '@/components/ui';
import {
  NewOrderForm, EditOrder, CancelOrderButton, CancelLineButton, CustomerButton,
  type ModelOpt, type CustomerOpt, type OrderHead, type LineRow,
} from './order-forms';

export const dynamic = 'force-dynamic';

export const metadata = { title: '수주' };

/* ---------------------------------------------------------------------------
   수주 (0159 · 사용자 2026-11-25)

   고객이 낸 주문을 주문서 + 형명 줄로 적는다. 출고는 출고 화면에서 이 주문 줄을 골라서 한다.
   주문 · 출고 · 남은 수량은 출고 기록에서 센다 (so_line_left).
--------------------------------------------------------------------------- */

const STATUS: Record<string, { label: string; tone: string }> = {
  OPEN: { label: '접수', tone: 'info' },
  PARTIAL: { label: '일부 출고', tone: 'warn' },
  DONE: { label: '출고 완료', tone: 'ok' },
  CANCELLED: { label: '취소', tone: 'faint' },
};

interface OrderRow extends OrderHead {
  status: string; cancel_reason: string | null;
  lines: (LineRow & {
    shipments: { shipped_at: string; lot_no: string; qty: number }[];
    /** 이 줄을 채우려고 낸 배치 (작업 지시에 건 것 · 0159) */
    batches: string | null;
  })[];
}

export default async function SalesOrdersPage() {
  const user = await requireUser();
  if (blocksScreen(user, '/shipping/orders')) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;
  const viewer = isViewerOnly(user.roles);

  const d = await withUser(user, async (db) => ({
    orders: await db.rows<OrderRow>(
      `select o.id, o.customer_po_no, c.name as customer_name, o.ordered_on::text as ordered_on,
              o.ship_to, o.due_on::text as due_on, o.ship_by::text as ship_by, o.note, o.cancel_reason, so_status(o.id) as status,
              coalesce((
                select json_agg(json_build_object(
                         'id', l.id, 'code', i.code, 'name', i.name, 'qty', l.qty,
                         'shipped', so_line_shipped(l.id), 'left', so_line_left(l.id),
                         'cancelled', l.cancelled_at is not null,
                         'batches', (select string_agg(wo.batch_no, ', ' order by wo.batch_no)
                                       from work_order_so_line w join work_order wo on wo.id = w.work_order_id
                                      where w.sales_order_line_id = l.id and w.unlinked_at is null),
                         'shipments', coalesce((
                           select json_agg(json_build_object(
                                    'shipped_at', sh.shipped_at::text, 'lot_no', pl.lot_no, 'qty', sh.qty)
                                    order by sh.shipped_at, pl.lot_no)
                             from shipment sh join product_lot pl on pl.id = sh.product_lot_id
                            where sh.sales_order_line_id = l.id), '[]'::json))
                         order by l.seq, i.code)
                  from sales_order_line l join item i on i.id = l.item_id
                 where l.sales_order_id = o.id), '[]'::json) as lines
         from (select o.*, row_number() over (
                         partition by so_status(o.id) in ('DONE', 'CANCELLED')
                         order by o.ordered_on desc, o.created_at desc) as rn
                 from sales_order o) o
         join customer c on c.id = o.customer_id
        /* 진행 중인 주문은 모두, 끝난 주문은 최근 50건 (수주 검토 M9 - 300건에서 잘라 진행 중이 빠지던 것) */
        where so_status(o.id) in ('OPEN', 'PARTIAL') or o.rn <= 50
        order by o.ordered_on desc, o.created_at desc`),
    customers: await db.rows<CustomerOpt>(
      `select id, name, biz_no, contact_name, contact_phone, contact_email, address, note, is_active
         from customer order by is_active desc, name`),
    models: await db.rows<ModelOpt>(
      /* 쓰지 않음으로 바꾼 형명도 재고가 남았으면 주문받는다 - 출고 검토도 받는다 (0168) */
      `select id, code, name || case when is_active then '' else ' (쓰지 않음)' end as name, udi_di as udi
         from item
        where type = 'FIN'
          and (is_active or exists (select 1 from product_lot pl where pl.item_id = item.id and pl.qty_available > 0))
        order by is_active desc, code`),
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
  }));

  const open = d.orders.filter((o) => o.status === 'OPEN' || o.status === 'PARTIAL');
  const closed = d.orders.filter((o) => o.status === 'DONE' || o.status === 'CANCELLED').slice(0, 50);

  return (
    <PageShell
      section="출하"
      title="수주"
      lede="고객 주문을 형명 줄로 적습니다. 출고는 출고 화면에서 이 주문 줄을 골라서 합니다."
      nav={<SubNav items={SHIPPING_NAV} />}
    >
      {!viewer && (
        <Panel title="주문 등록" note="형명 · UDI 칸에 형명 코드나 라벨 바코드를 넣으면 형명을 고릅니다">
          <NewOrderForm customers={d.customers} models={d.models} today={d.today ?? ''} />
        </Panel>
      )}

      <Panel title="진행 중인 주문" note="출고 마감일 · 납품요청일이 이른 것부터">
        {open.length === 0 ? (
          <Empty hint="위에서 거래처 · 고객 발주번호 · 형명 줄을 적어 등록합니다.">진행 중인 주문이 없습니다.</Empty>
        ) : (
          <div className="space-y-4">
            {[...open].sort((a, b) => (a.ship_by ?? '9999').localeCompare(b.ship_by ?? '9999')
                                       || (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999'))
              .map((o) => <OrderCard key={o.id} o={o} viewer={viewer} models={d.models} />)}
          </div>
        )}
      </Panel>

      {closed.length > 0 && (
        <Panel title="끝난 주문" note="출고 완료 · 취소, 최근 것부터">
          <div className="space-y-4">
            {closed.map((o) => <OrderCard key={o.id} o={o} viewer={viewer} models={d.models} />)}
          </div>
        </Panel>
      )}

      <Panel title="거래처" action={viewer ? undefined : <CustomerButton label="거래처 등록" />}>
        {d.customers.length === 0 ? (
          <Empty hint="주문 등록에서 새 거래처를 고르거나 거래처 등록으로 넣습니다.">등록된 거래처가 없습니다.</Empty>
        ) : (
          <div className="qd-table-scroll">
            <table className="qd-table qd-table--hangul" data-grow="5">
              <thead>
                <tr>
                  <th className="th">상호</th>
                  <th className="th">사업자등록번호</th>
                  <th className="th">담당자</th>
                  <th className="th">연락처</th>
                  <th className="th">주소</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {d.customers.map((c) => (
                  <tr key={c.id} className={c.is_active ? '' : 'text-faint'}>
                    <td className="td text-sm">
                      {c.name}{!c.is_active && <span className="ml-2"><Tag tone="faint">쓰지 않음</Tag></span>}
                    </td>
                    <td className="td font-mono text-sm">{c.biz_no ?? ''}</td>
                    <td className="td text-sm">{c.contact_name ?? ''}</td>
                    <td className="td text-sm">{[c.contact_phone, c.contact_email].filter(Boolean).join(' · ')}</td>
                    <td className="td text-sm">{c.address ?? ''}</td>
                    <td className="td text-right">{!viewer && <CustomerButton customer={c} label="고치기" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}

function OrderCard({ o, viewer, models }: { o: OrderRow; viewer: boolean; models: ModelOpt[] }) {
  const st = STATUS[o.status] ?? { label: o.status, tone: 'quiet' };
  const live = o.status !== 'CANCELLED';
  return (
    <div className="rounded-md border border-line">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-canvas px-4 py-2.5">
        <span className="font-mono font-semibold">{o.customer_po_no}</span>
        <span className="text-sm">{o.customer_name}{o.ship_to ? ` → ${o.ship_to}` : ''}</span>
        <span className="text-xs text-muted">발주 {fmtDate(o.ordered_on)}</span>
        {o.due_on && <span className="text-xs text-muted">납품요청 {fmtDate(o.due_on)}</span>}
        {o.ship_by && <span className="text-xs font-semibold text-ink">출고 마감 {fmtDate(o.ship_by)}</span>}
        <Tag tone={st.tone}>{st.label}</Tag>
        {!viewer && live && (
          <span className="ml-auto flex gap-3">
            <EditOrder order={o} lines={o.lines} models={models} />
            <CancelOrderButton id={o.id} po={o.customer_po_no} />
          </span>
        )}
      </div>
      {(o.note || o.cancel_reason) && (
        <p className="px-4 pt-2 text-xs text-muted">
          {o.note}{o.cancel_reason ? `${o.note ? ' · ' : ''}취소 사유: ${o.cancel_reason}` : ''}
        </p>
      )}
      <div className="qd-table-scroll">
        <table className="qd-table qd-table--hangul">
          <thead>
            <tr>
              <th className="th">형명</th>
              <th className="th text-right">주문</th>
              <th className="th text-right">출고</th>
              <th className="th text-right">남음</th>
              <th className="th">배치</th>
              <th className="th">출고 내역</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l) => (
              <tr key={l.id} className={l.cancelled ? 'text-faint' : ''}>
                <td className="td">
                  <div className="font-mono text-sm">{l.code}</div>
                  <div className="text-xs text-faint">{l.name}</div>
                </td>
                <td className="td tnum text-right">{l.qty.toLocaleString()}</td>
                <td className="td tnum text-right">{l.shipped.toLocaleString()}</td>
                <td className={`td tnum text-right font-semibold ${l.left < 0 ? 'text-warn' : ''}`}>
                  {l.cancelled ? '취소' : l.left.toLocaleString()}
                </td>
                <td className="td font-mono text-xs">{l.batches ?? <span className="text-faint">-</span>}</td>
                <td className="td text-xs">
                  {l.shipments.length === 0 ? <span className="text-faint">-</span> : (
                    <details>
                      <summary className="cursor-pointer">{l.shipments.length}건</summary>
                      <ul className="mt-1 space-y-0.5">
                        {l.shipments.map((s, i) => (
                          <li key={i} className="tnum">
                            {fmtDate(s.shipped_at)} · <span className="font-mono">{s.lot_no}</span> · {s.qty.toLocaleString()}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="td text-right">
                  {!viewer && live && !l.cancelled && l.shipped === 0 && o.lines.filter((x) => !x.cancelled).length > 1 && (
                    <CancelLineButton id={l.id} code={l.code} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
