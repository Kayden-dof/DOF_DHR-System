import Link from 'next/link';
import { requireUser, blocksScreen } from '@/lib/session';
import { fixAt } from '@/lib/unblock';
import { Unblock } from '@/components/unblock';
import Denied from '@/components/denied';
import { isViewerOnly } from '@/lib/roles';
import { withActor } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { SHIPPING_NAV } from '../../sections';
import { fmtDate } from '@/lib/fmt';
import { PL_STATUS_LABEL } from '@/lib/forms';
import { Panel, Empty, Tag } from '@/components/ui';
import { shipReview } from '@/lib/ship-review';
import { specMessage, type CutRowCell } from '@/lib/ship-check';
import {
  ShipList, RelinkShipment, SkipSterilReport, CancelSterilSkip,
  type PlOpt, type ShipLine, type ShipLot, type RelinkOpt,
} from '../shipping-forms';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '출고' };

/* ---------------------------------------------------------------------------
   출고 (0159 · 0160 · 사용자 2026-11-25)

   «출고할때 발주 업체리스트에서 선택하고, 발주 형명이 맞는지 작업지시서 및 제조기록서 일괄
   검토해서 출고시 오규격이 나가지 않도록». 발주 업체 → 그 업체의 열린 주문 줄 → 그 형명의
   출고 가능 로트(멸균 보고서가 적힌 것) 차례로 고른다. 고른 것은 주소(?c= · ?l=)에 남는다.
--------------------------------------------------------------------------- */

interface ShipRow {
  id: string; customer_name: string; qty: number; shipped_at: string;
  lot_no: string; item_code: string; item_name: string; item_id: string;
  batch_no: string; shipped_by_name: string;
  /** 그 로트의 멸균 보고서 번호 (0160) */
  report: string | null;
  /** 보고서 없이 내보낸 사유 (0166) */
  skip: string | null;
  /** 나간 주문 (고객 발주번호) · 그 줄 */
  po: string | null; line_id: string | null;
}
interface OpenLine extends ShipLine { item_id: string; due_on: string | null }
/** 멸균 보고서를 생략한 로트 (0166) */
interface SkipRow extends PlOpt { skip: string; skipped_by_name: string; skipped_at: string }

type Search = Promise<{ c?: string; l?: string; done?: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOTS = `
  select pl.id, pl.lot_no, i.code as item_code, i.name as item_name,
         pl.qty_available, pl.qty_sample, wo.batch_no, wo.id as wo_id, pl.status::text as status,
         pl.expiry_date, pl.manufactured_on,
         pl.release_approved_by, pl.release_approved_on::text as release_approved_on,
         coalesce((select sum(sh.qty)::int from shipment sh where sh.product_lot_id = pl.id), 0) as shipped,
         lot_steril_report(pl.id) as report, lot_steril_skip(pl.id) as skip
    from product_lot pl
    join item i on i.id = pl.item_id
    join work_order wo on wo.id = pl.work_order_id
   where pl.qty_available > 0
     and pl.status in ('PACKED','STERILIZING','TESTED','RELEASE_APPROVED')`;

export default async function ShipPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  /* 열람자에게 열어 둔 화면이 아니다. 주소를 직접 쳐도 들어가지 못한다 */
  if (blocksScreen(user, '/shipping/ship')) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;
  const viewer = isViewerOnly(user.roles);
  const sp = await searchParams;
  const cId = sp.c ?? '';
  const lId = sp.l ?? '';

  const d = await withActor(user.id, async (db) => {
    const customers = await db.rows<{ id: string; name: string; lines: number }>(
      `select c.id, c.name, count(*)::int as lines
         from customer c
         join sales_order o on o.customer_id = c.id and o.cancelled_at is null
         join sales_order_line l on l.sales_order_id = o.id and l.cancelled_at is null
        where so_line_left(l.id) > 0
        group by c.id, c.name order by c.name`);
    /* 열린 주문 줄 전부 - 업체의 줄 목록과 출고 이력의 «주문 바꾸기» 가 함께 쓴다 */
    const open = await db.rows<OpenLine & { customer_id: string }>(
      `select l.id, o.customer_po_no, c.name as customer_name, c.id as customer_id, i.code, i.name, l.item_id,
              l.qty, so_line_shipped(l.id) as shipped, so_line_left(l.id) as left, o.due_on::text as due_on
         from sales_order_line l
         join sales_order o on o.id = l.sales_order_id
         join customer c on c.id = o.customer_id
         join item i on i.id = l.item_id
        where o.cancelled_at is null and l.cancelled_at is null
        order by o.due_on nulls last, o.customer_po_no, l.seq`);
    const lines = open.filter((x) => x.customer_id === cId && x.left > 0);
    /* 남은 줄이 하나뿐이면 고를 것이 없다 - 바로 그 줄의 로트를 연다 (사용자 2026-11-26 «출고 버튼 어디있어») */
    const line = lines.find((x) => x.id === lId) ?? (lines.length === 1 ? lines[0] : null);

    /* 고른 줄의 형명으로 나갈 수 있는 로트와 그 검토 */
    let lots: ShipLot[] = [];
    if (line) {
      const cache = new Map<string, CutRowCell[][]>();
      /*
       * 이 주문 줄에 걸린 배치(작업 지시)의 로트를 먼저 (0159 · 사용자 «작업지시서를 주문줄에 걸고»). 다른 주문에
       * 걸린 배치의 로트도 재고가 있으면 내보낸다 («꼭 작업지시서에 엮인 주문줄이 아니어도 나갈수있도록») - 표시만 한다.
       */
      const base = await db.rows<PlOpt & { for_line: boolean; other_orders: string | null }>(
        `select x.*, k.for_line, k.other_orders from (
           ${LOTS} and pl.item_id = $1 and lot_steril_ok(pl.id)
         ) x
         cross join lateral (
           select exists (select 1 from work_order_so_line w
                           where w.work_order_id = x.wo_id and w.sales_order_line_id = $2
                             and w.unlinked_at is null) as for_line,
                  (select string_agg(distinct o.customer_po_no, ', ')
                     from work_order_so_line w
                     join sales_order_line sl on sl.id = w.sales_order_line_id
                     join sales_order o on o.id = sl.sales_order_id
                    where w.work_order_id = x.wo_id and w.unlinked_at is null
                      and w.sales_order_line_id <> $2
                      and sl.cancelled_at is null and o.cancelled_at is null) as other_orders
         ) k
         order by k.for_line desc, x.expiry_date, x.lot_no`, [line.item_id, line.id]);
      for (const l of base) {
        const review = await shipReview(db, l.id, line.id, cache);
        const bad = review.find((r) => r.ok === false);
        lots.push({ ...l, review, blocked: bad ? specMessage(bad) : null });
      }
    }

    return {
      customers, open, lines, line, lots,
      waiting: await db.rows<PlOpt>(
        `${LOTS} and not lot_steril_ok(pl.id) order by pl.expiry_date, pl.lot_no`),
      /* 보고서 없이 사유와 함께 생략한 로트 - 남은 수량이 있는 동안 보인다 (0166) */
      skipped: await db.rows<SkipRow>(
        `select x.*, u.full_name as skipped_by_name,
                to_char(timezone('Asia/Seoul', s.skipped_at), 'YYYY-MM-DD') as skipped_at
           from (${LOTS} and lot_steril_report(pl.id) is null) x
           join steril_report_skip s on s.product_lot_id = x.id
           join app_user u on u.id = s.skipped_by
          order by s.skipped_at desc`),
      shipments: await db.rows<ShipRow>(
        `select lot_steril_report(sh.product_lot_id) as report, lot_steril_skip(sh.product_lot_id) as skip,
                sh.id, sh.customer_name, sh.qty,
                sh.shipped_at::text as shipped_at,
                pl.lot_no, i.code as item_code, i.name as item_name, pl.item_id,
                wo.batch_no, u.full_name as shipped_by_name,
                o.customer_po_no as po, sh.sales_order_line_id as line_id
           from shipment sh
           join product_lot pl on pl.id = sh.product_lot_id
           join item i on i.id = pl.item_id
           join work_order wo on wo.id = pl.work_order_id
           join app_user u on u.id = sh.shipped_by
           left join sales_order_line sl on sl.id = sh.sales_order_line_id
           left join sales_order o on o.id = sl.sales_order_id
          order by sh.shipped_at desc, sh.id desc limit 100`),
      today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
      /*
       * 방금 기록한 출고 (?done=). 기본 수량대로 나가면 그 주문 줄이 닫히거나 로트가 바닥나 출고 폼이
       * 사라지므로, 결과를 폼 대신 화면 머리에 둔다 (수주 검토 M3 · 2026-11-26).
       */
      justShipped: sp.done && UUID.test(sp.done)
        ? await db.one<{ lot_no: string; qty: number; customer_name: string; po: string | null; left: number | null }>(
            `select pl.lot_no, sh.qty, sh.customer_name, o.customer_po_no as po,
                    so_line_left(sh.sales_order_line_id) as left
               from shipment sh
               join product_lot pl on pl.id = sh.product_lot_id
               left join sales_order_line sl on sl.id = sh.sales_order_line_id
               left join sales_order o on o.id = sl.sales_order_id
              where sh.id = $1`, [sp.done])
        : undefined,
    };
  });

  const relinkFor = (s: ShipRow): RelinkOpt[] => d.open
    .filter((x) => x.item_id === s.item_id && x.id !== s.line_id)
    .map((x) => ({ id: x.id, label: `${x.customer_po_no} · ${x.customer_name} · 남음 ${x.left.toLocaleString()}` }));

  return (
    <PageShell
      section="출하"
      title="출고"
      lede="발주 업체와 주문 줄을 고르고, 로트의 «출고» 를 눌러 수량과 출고일을 적습니다. 형명 검토가 다른 로트는 출고하지 않습니다."
      nav={<SubNav items={SHIPPING_NAV} />}
    >
      {d.justShipped && (
        <p role="status" className="rounded-md border border-line bg-surface-sub px-4 py-2.5 text-sm">
          <span className="font-semibold text-ok">출고를 기록했습니다.</span>{' '}
          <span className="font-mono">{d.justShipped.lot_no}</span> {d.justShipped.qty.toLocaleString()}개 →{' '}
          {d.justShipped.customer_name}
          {d.justShipped.po && <> · 주문 <span className="font-mono">{d.justShipped.po}</span>
            {d.justShipped.left !== null && <> 남음 {d.justShipped.left.toLocaleString()}</>}</>}
        </p>
      )}
      <Panel title="발주 업체" note="출고할 주문이 남은 거래처">
        {d.customers.length === 0 ? (
          <Empty hint="수주에서 고객 주문을 먼저 적으면 여기 나옵니다."
                 action={<Unblock fix={fixAt(user, '/shipping/orders')} todo="수주 보기" />}>
            출고할 주문이 없습니다.
          </Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {d.customers.map((c) => (
              <Link key={c.id} href={`/shipping/ship?c=${c.id}`}
                    className={c.id === cId ? 'btn-primary' : 'btn-ghost'}>
                {c.name} <span className="ml-1 tnum text-xs opacity-80">{c.lines}줄</span>
              </Link>
            ))}
          </div>
        )}
      </Panel>

      {cId && (
        <Panel title="주문 줄" note="고르면 그 형명의 출고 가능 로트가 아래에 나옵니다">
          {d.lines.length === 0 ? (
            <Empty>이 거래처에 출고할 주문 줄이 없습니다.</Empty>
          ) : (
            <div className="qd-table-scroll">
              <table className="qd-table qd-table--hangul">
                <thead>
                  <tr>
                    <th className="th">고객 발주번호</th>
                    <th className="th">형명</th>
                    <th className="th text-right">주문</th>
                    <th className="th text-right">출고</th>
                    <th className="th text-right">남음</th>
                    <th className="th">납품요청일</th>
                    <th className="th w-0"><span className="sr-only">고르기</span></th>
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((x) => {
                    const href = `/shipping/ship?c=${cId}&l=${x.id}`;
                    const on = x.id === d.line?.id;
                    return (
                      <tr key={x.id} className={on ? 'bg-brand-soft/60' : ''}>
                        <td className="td font-mono font-semibold"><Link href={href}>{x.customer_po_no}</Link></td>
                        <td className="td">
                          <Link href={href}>
                            <div className="font-mono text-sm">{x.code}</div>
                            <div className="text-xs text-faint">{x.name}</div>
                          </Link>
                        </td>
                        <td className="td tnum text-right">{x.qty.toLocaleString()}</td>
                        <td className="td tnum text-right text-muted">{x.shipped.toLocaleString()}</td>
                        <td className="td tnum text-right font-semibold">{x.left.toLocaleString()}</td>
                        <td className="td tnum">{x.due_on ? fmtDate(x.due_on) : ''}</td>
                        <td className="td text-right">
                          {on
                            ? <Tag tone="info">보는 중</Tag>
                            : <Link href={href} className="btn-ghost">고르기</Link>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {d.line && (
        <Panel title={`출고 가능 로트 · ${d.line.code}`}
               note="멸균 보고서가 적혔거나 생략한 로트 · 유효기한이 이른 것부터. 검토 칸에 마우스를 올리면 주문과 실제 값이 보입니다">
          {d.lots.length === 0 ? (
            <Empty hint="멸균 위탁에서 회수일과 멸균 보고서 번호를 적으면 여기 나옵니다."
                   action={<Unblock fix={fixAt(user, '/shipping/steril')} todo="멸균 위탁 보기" />}>
              이 형명으로 출고할 수 있는 로트가 없습니다.
            </Empty>
          ) : viewer ? (
            <Empty>열람 계정은 출고를 기록하지 않습니다.</Empty>
          ) : (
            <ShipList lots={d.lots} line={d.line} today={d.today ?? ''} />
          )}
        </Panel>
      )}

      {d.waiting.length > 0 && (
        <Panel title="멸균 보고서 대기"
               note="멸균 위탁에서 회수일과 멸균 보고서 번호를 적으면 출고할 수 있습니다. 보고서 없이 내보내는 로트(멸균 선량 샘플 등)는 «생략» 에 사유를 적습니다">
          <div className="qd-table-scroll">
            <table className="qd-table qd-table--hangul" data-grow="2">
              <thead>
                <tr>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th">배치</th>
                  <th className="th text-right">출하 가능</th>
                  <th className="th">상태</th>
                  {!viewer && <th className="th w-0" />}
                </tr>
              </thead>
              <tbody>
                {d.waiting.map((l) => (
                  <tr key={l.id}>
                    <td className="td font-mono font-semibold">{l.lot_no}</td>
                    <td className="td">
                      <div className="text-sm">{l.item_name}</div>
                      <div className="font-mono text-xs text-faint">{l.item_code}</div>
                    </td>
                    <td className="td font-mono text-muted">{l.batch_no}</td>
                    <td className="td tnum text-right">{l.qty_available}</td>
                    <td className="td">
                      <Tag tone="quiet">{PL_STATUS_LABEL[l.status] ?? l.status}</Tag>
                    </td>
                    {!viewer && <td className="td text-right"><SkipSterilReport id={l.id} lotNo={l.lot_no} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {d.skipped.length > 0 && (
        <Panel title="멸균 보고서 생략" note="보고서 없이 출고하는 로트 · 한 개도 출고하기 전이면 생략을 취소할 수 있습니다">
          <div className="qd-table-scroll">
            <table className="qd-table qd-table--hangul" data-grow="2">
              <thead>
                <tr>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th">생략 사유</th>
                  <th className="th">기록</th>
                  <th className="th text-right">출하 가능</th>
                  {!viewer && <th className="th w-0" />}
                </tr>
              </thead>
              <tbody>
                {d.skipped.map((l) => (
                  <tr key={l.id}>
                    <td className="td font-mono font-semibold">{l.lot_no}</td>
                    <td className="td">
                      <div className="text-sm">{l.item_name}</div>
                      <div className="font-mono text-xs text-faint">{l.item_code}</div>
                    </td>
                    <td className="td text-sm">{l.skip}</td>
                    <td className="td text-sm text-muted">
                      {l.skipped_by_name} · <span className="tnum">{fmtDate(l.skipped_at)}</span>
                    </td>
                    <td className="td tnum text-right">{l.qty_available}</td>
                    {!viewer && (
                      <td className="td text-right">
                        {l.shipped === 0
                          ? <CancelSterilSkip id={l.id} lotNo={l.lot_no} />
                          : <span className="text-xs text-faint">출고 {l.shipped}개</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="출고 이력">
        {d.shipments.length === 0 ? (
          <Empty hint="위에서 발주 업체 · 주문 줄 · 로트를 골라 출고하면 여기 남습니다.">
            출고 기록이 없습니다.
          </Empty>
        ) : (
          <div className="qd-table-scroll">
            <table className="qd-table qd-table--hangul" data-grow="4">
              <thead>
                <tr>
                  <th className="th">출고일</th>
                  <th className="th">거래처</th>
                  <th className="th">주문</th>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th">배치</th>
                  <th className="th">멸균 보고서</th>
                  <th className="th text-right">수량</th>
                  <th className="th">기록자</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {d.shipments.map((s) => (
                  <tr key={s.id}>
                    <td className="td tnum ">{fmtDate(s.shipped_at)}</td>
                    <td className="td text-sm">{s.customer_name}</td>
                    <td className="td font-mono text-sm">{s.po ?? <span className="text-faint">-</span>}</td>
                    <td className="td font-mono font-semibold">{s.lot_no}</td>
                    <td className="td text-sm">{s.item_name}</td>
                    <td className="td font-mono text-muted">{s.batch_no}</td>
                    <td className="td font-mono ">
                      {s.report ?? (s.skip
                        ? <span title={s.skip}><Tag tone="warn">생략</Tag></span>
                        : <span className="text-faint">-</span>)}
                    </td>
                    <td className="td tnum text-right font-semibold">{s.qty}</td>
                    <td className="td text-muted">{s.shipped_by_name}</td>
                    <td className="td text-right">
                      {!viewer && s.line_id && (
                        <RelinkShipment id={s.id} current={s.po ?? '-'} options={relinkFor(s)} />
                      )}
                    </td>
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
