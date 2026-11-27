import Link from 'next/link';
import { requireUser, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { withUser } from '@/lib/db';
import { canOpen } from '@/lib/access';
import { fmtDate, num } from '@/lib/fmt';
import PrintBar from '../docs-check/print-bar';

export const dynamic = 'force-dynamic';
export const metadata = { title: '제조번호 추적 보고서' };

/* ---------------------------------------------------------------------------
   제조번호 추적 보고서 (사용자 2026-11-27)

   «내가 왜 제조번호를 찾는지. 그걸 먼저 생각해봐. 제조번호를 쳤을때 레포트가 나와야 하고 한장짜리 A4
    리포트안에 자세하진 않아도 추적이 될수있는 정보들이 다 나왔으면해»

   제조번호를 찾는 것은 불만 · 회수 · 감사 때다. «이 번호의 제품이 무엇으로, 언제, 누가 만들었고, 어디로
   나갔는가» 를 한 장에 답한다. 자세한 것은 제조기록서 · 계보 화면이 갖는다 - 여기는 그 길잡이다.

     제품 · 배치      형명 · UDI-DI · 제조일 · 유효기한 · 수량 · 제품표준서 판
     원재료           로트 · 공급자 · 공급자 로트 · 입고일 · 성적서 · 발주
     투입 자재        배치 공통 + 이 제조번호에만 든 것. 원액은 그 원료 로트까지 한 줄로
     공정             공정마다 작업일 · 작업자 · 설비 (작업일은 제조기록서의 날 · 옮겨 적은 시각을 쓰지 않는다)
     멸균             위탁 배치 · 업체 · 발송 · 회수 · 보고서 번호, 또는 생략 사유
     부적합           있을 때만 (§8.5)
     수주 · 출고      고객 발주 · 출고일 · 거래처 · 수량 · 개체 범위
     비용             원가 화면을 여는 사람에게만

   기록이 아니다. 인쇄 대장에 남지 않고 아무것도 잠그지 않는다 (print-bar 와 같은 갈래). 몇 번을 뽑아도
   바뀌는 것이 없다.

   찾기: 적힌 그대로(빈칸 지움 · 대문자) 제조번호로 - 뒤의 -숫자는 개체 순번 (find_unit). 없으면 배치번호로.
   배치에 제조번호가 여럿이면 고르게 한다.
--------------------------------------------------------------------------- */

interface Head {
  lot_id: string; lot_no: string; item_code: string; item_name: string; udi: string | null;
  product_code: string | null; product_name: string;
  manufactured_on: string | null; expiry_date: string | null;
  qty_produced: number; qty_sample: number; qty_available: number;
  wo_id: string; batch_no: string; wo_no: string; dmr_revision: string | null;
  issued_on: string | null; sheet_count: number; prod_name: string | null;
  raw_lot: string; raw_code: string; raw_name: string; supplier: string | null; supplier_lot_no: string | null;
  received_on: string | null; coa_no: string | null; thickness_band: string | null; raw_po: string | null;
  lot_cost: string | null;
}
interface Input {
  lot_id: string; code: string; name: string; type: string; lot_no: string; qty: string; uom: string | null;
  ops: string; shared: boolean; sub: string | null;
}
interface Op { seq: number; name: string; first_on: string | null; last_on: string | null; workers: string | null; equip: string | null }
interface Steril { batch_no: string; vendor: string | null; request_no: string | null; shipped_at: string | null; received_at: string | null; cert_no: string | null; qty: number }
interface Nc { what: string; qty: number; unit: string; outcome: string; reason: string; doc: string | null; on: string | null }
interface Ship {
  shipped_at: string; customer: string; ship_to: string | null; qty: number;
  unit_from: number | null; unit_to: number | null; customer_po_no: string | null; unit_price: string | null;
}

const OUTCOME: Record<string, string> = { REWORK: '재작업', CONCESSION: '특채', SCRAP: '불량' };
const day = (v: string | null | undefined) => (v ? fmtDate(v) : '-');
const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`;
const pad = (n: number) => String(n).padStart(3, '0');

export default async function TraceReport({ searchParams }: { searchParams: Promise<{ sn?: string }> }) {
  const user = await requireUser();
  if (blocksScreen(user, '/trace')) return <Denied what="추적 보고서" need="생산관리자 · 시스템관리자 · 경영열람" />;
  const query = String((await searchParams).sn ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 60);
  const showCost = canOpen('/board/cost', user.seat, user.screens);

  const d = await withUser(user, async (db) => {
    if (!query) return { hits: [] as { id: string; lot_no: string; seq: number | null; standing: string | null }[] };
    let hits = await db.rows<{ id: string; lot_no: string; seq: number | null; standing: string | null }>(
      `select product_lot_id::text as id, lot_no, seq, standing from find_unit($1)`, [query]);
    let byBatch = false;
    if (hits.length === 0) {
      byBatch = true;
      hits = await db.rows(
        `select pl.id::text as id, pl.lot_no, null::int as seq, null::text as standing
           from product_lot pl join work_order wo on wo.id = pl.work_order_id
          where upper(wo.batch_no) = $1 order by pl.lot_no limit 30`, [query]);
    }
    if (hits.length !== 1) return { hits, byBatch };
    const id = hits[0].id;

    const head = await db.one<Head>(
      `select pl.id::text as lot_id, pl.lot_no, i.code as item_code, i.name as item_name, i.udi_di as udi,
              dm.product_code, coalesce(dm.product_name, i.name) as product_name,
              pl.manufactured_on::text as manufactured_on, pl.expiry_date::text as expiry_date,
              pl.qty_produced, pl.qty_sample, pl.qty_available,
              wo.id::text as wo_id, wo.batch_no, wo.wo_no, wo.dmr_revision::text as dmr_revision,
              (timezone('Asia/Seoul', wo.issued_at))::date::text as issued_on, wo.sheet_count,
              up.full_name as prod_name,
              ml.lot_no as raw_lot, ri.code as raw_code, ri.name as raw_name, s.name as supplier, ml.supplier_lot_no,
              (timezone('Asia/Seoul', ml.received_at))::date::text as received_on,
              ml.coa_no, ml.thickness_band::text as thickness_band, po.po_no as raw_po,
              ${showCost
                ? `(select (c.shared_cost + c.own_cost + c.shared_conv_cost + c.own_conv_cost)::text
                      from v_product_lot_cost c where c.product_lot_id = pl.id)`
                : 'null::text'} as lot_cost
         from product_lot pl
         join item i on i.id = pl.item_id
         join work_order wo on wo.id = pl.work_order_id
         join device_master dm on dm.id = wo.device_master_id
         join material_lot ml on ml.id = wo.material_lot_id
         join item ri on ri.id = ml.item_id
         left join supplier s on s.id = ml.supplier_id
         left join purchase_order po on po.id = ml.purchase_order_id
         left join app_user up on up.id = wo.issued_by_prod
        where pl.id = $1::uuid`, [id]);
    if (!head) return { hits, byBatch };

    /* 투입 자재. 배치 공통(재단 전)과 이 제조번호 몫(재단 후). 원액이면 그 원료 로트를 한 줄로 */
    const inputs = await db.rows<Input>(
      `select g.material_lot_id::text as lot_id, g.item_code as code, g.item_name as name, g.item_type::text as type,
              g.material_lot_no as lot_no, sum(g.qty)::text as qty, i.usage_uom as uom,
              string_agg(distinct g.operation_name, ' · ') as ops,
              bool_and(g.product_lot_id is null) as shared,
              (select string_agg(ri.name || ' ' || rl.lot_no, ' · ' order by ri.name)
                 from stock_movement sm
                 join material_lot rl on rl.id = sm.material_lot_id
                 join item ri on ri.id = rl.item_id
                where sm.solution_lot_id = g.material_lot_id and sm.type = 'SOLUTION') as sub
         from v_lot_genealogy g
         join material_lot ml on ml.id = g.material_lot_id
         join item i on i.id = ml.item_id
        where g.work_order_id = $1::uuid and (g.product_lot_id is null or g.product_lot_id = $2::uuid)
        group by g.material_lot_id, g.item_code, g.item_name, g.item_type, g.material_lot_no, i.usage_uom
        order by bool_and(g.product_lot_id is null) desc, g.item_code, g.material_lot_no`, [head.wo_id, id]);

    /* 공정. 작업일은 제조기록서의 날이다 (옮겨 적은 시각을 쓰지 않는다 · 사용자 2026-11-27) */
    const ops = await db.rows<Op>(
      `select o.seq, o.name,
              min(pr.work_date)::text as first_on, max(pr.work_date)::text as last_on,
              (select string_agg(distinct u.full_name, ' · ')
                 from process_record p2 join app_user u on u.id in (p2.worker_id, p2.rotation_worker_id)
                where p2.work_order_id = $1::uuid and p2.operation_id = o.id
                  and (p2.product_lot_id is null or p2.product_lot_id = $2::uuid)) as workers,
              (select string_agg(distinct e, ' · ')
                 from process_record p3, unnest(array[p3.equipment_id] || coalesce(p3.extra_equipment_ids, '{}')) e
                where p3.work_order_id = $1::uuid and p3.operation_id = o.id and e is not null and e <> ''
                  and (p3.product_lot_id is null or p3.product_lot_id = $2::uuid)) as equip
         from process_record pr
         join dmr_operation o on o.id = pr.operation_id
        where pr.work_order_id = $1::uuid and (pr.product_lot_id is null or pr.product_lot_id = $2::uuid)
        group by o.id, o.seq, o.name
        order by o.seq`, [head.wo_id, id]);

    const steril = await db.rows<Steril>(
      `select sb.batch_no, sb.vendor_name as vendor, sb.request_no,
              sb.shipped_at::date::text as shipped_at, sb.received_at::text as received_at, sb.cert_no, sl.qty
         from steril_batch_lot sl join steril_batch sb on sb.id = sl.steril_batch_id
        where sl.product_lot_id = $1::uuid order by sb.shipped_at`, [id]);
    const skip = await db.val<string>(
      `select string_agg(reason, ' · ') from steril_report_skip where product_lot_id = $1::uuid`, [id]);

    const nc = await db.rows<Nc>(
      `select '제품' as what, n.qty, '개' as unit, n.outcome::text as outcome,
              n.reason_code || coalesce(' · ' || n.reason_detail, '') as reason,
              n.concession_doc_no as doc, n.found_at::text as on
         from product_nonconformity n where n.product_lot_id = $1::uuid
       union all
       select '반제품 · ' || o.name, w.sheets, '장', w.outcome::text,
              w.reason_code || coalesce(' · ' || w.reason_detail, ''), w.concession_doc_no, w.found_at::text
         from wip_nonconformity w join dmr_operation o on o.id = w.operation_id
        where w.work_order_id = $2::uuid
        order by 7`, [id, head.wo_id]);

    const ships = await db.rows<Ship>(
      `select sh.shipped_at::text as shipped_at, sh.customer_name as customer, o.ship_to, sh.qty,
              sh.unit_from, sh.unit_to, o.customer_po_no, l.unit_price::text as unit_price
         from shipment sh
         left join sales_order_line l on l.id = sh.sales_order_line_id
         left join sales_order o on o.id = l.sales_order_id
        where sh.product_lot_id = $1::uuid
        order by sh.shipped_at, sh.unit_from nulls last`, [id]);

    const orders = await db.val<string>(
      `select string_agg(distinct o.customer_po_no || ' · ' || c.name, ' / ')
         from work_order_so_line w
         join sales_order_line l on l.id = w.sales_order_line_id
         join sales_order o on o.id = l.sales_order_id
         join customer c on c.id = o.customer_id
        where w.work_order_id = $1::uuid and w.unlinked_at is null`, [head.wo_id]);

    const printedAt = await db.val<string>(`select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD HH24:MI')`);
    return { hits, byBatch, head, inputs, ops, steril, skip, nc, ships, orders, printedAt };
  });

  /* --- 찾지 못함 · 여럿 ------------------------------------------------------ */
  if (!('head' in d) || !d.head) {
    return (
      <div className="mx-auto w-[210mm] max-w-full p-6">
        <PrintBar back="/trace" title="제조번호 추적 보고서" />
        {!query ? (
          <p className="text-sm text-muted">제조번호를 적으십시오.</p>
        ) : d.hits.length === 0 ? (
          <p className="text-sm text-muted">
            <span className="font-mono text-ink">{query}</span> 에 맞는 제조번호 · 배치번호가 없습니다.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              {d.byBatch ? <>배치 <span className="font-mono text-ink">{query}</span> 의 제조번호입니다.</> : '맞는 제조번호가 여럿입니다.'} 하나를 고르십시오.
            </p>
            <ul className="space-y-1">
              {d.hits.map((h) => (
                <li key={h.id}>
                  <Link href={`/print/trace?sn=${encodeURIComponent(h.lot_no)}`} className="font-mono text-brand hover:underline">
                    {h.lot_no}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  const { head: h, inputs, ops, steril, skip, nc, ships, orders, printedAt } = d;
  const hit = d.hits[0];
  const cost = h.lot_cost == null ? null : Number(h.lot_cost);
  const unitCost = cost != null && h.qty_produced > 0 ? cost / h.qty_produced : null;
  const price = ships.find((s) => s.unit_price != null)?.unit_price;
  const shipped = ships.reduce((a, s) => a + s.qty, 0);
  /* 개체 범위 없이 통째로 나간 로트는 find_unit 이 개체를 «재고» 로 본다. 남은 수량이 0 이고 출고가 있으면 나간 것이다 */
  const standing = hit.seq == null ? null
    : hit.standing === '재고' && h.qty_available === 0 && ships.length > 0 ? '출고됨' : hit.standing;

  return (
    <>
      <PrintBar back="/trace" title="제조번호 추적 보고서" />
      {/* 한 장에 들게 표 글씨 · 칸 여백을 줄인다 (인쇄 CSS 의 9pt · 3pt 를 이 종이에서만 덮는다) */}
      <div className="sheet text-[10.5px] leading-snug text-black [&_td]:!px-[3px] [&_td]:!py-[1.5px] [&_td]:!text-[9.5px]
                      [&_th]:!px-[3px] [&_th]:!py-[1.5px] [&_th]:!text-[9.5px]">
        <header className="mb-2 flex items-end justify-between border-b-2 border-black pb-1.5">
          <div>
            <h1 className="text-[16px] font-bold">제조번호 추적 보고서</h1>
            <p className="mt-0.5 text-[12px]">
              <span className="font-mono text-[14px] font-bold">{h.lot_no}{hit.seq != null && ` - ${pad(hit.seq)}`}</span>
              {standing && <span className="ml-2 border border-black px-1 text-[10px]">개체 {pad(hit.seq!)} · {standing}</span>}
            </p>
          </div>
          <div className="text-right text-[10px]">
            <div>{h.product_name}</div>
            <div className="font-mono">{h.item_code}{h.udi ? ` · UDI-DI ${h.udi}` : ''}</div>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-x-4">
          <Block title="제품 · 배치">
            <Kv k="배치번호"><span className="font-mono">{h.batch_no}</span> <span className="text-[10px]">({h.wo_no})</span></Kv>
            <Kv k="제품표준서">{h.product_code ?? h.item_code}{h.dmr_revision ? ` · ${h.dmr_revision}` : ''}</Kv>
            <Kv k="지시 발행">{day(h.issued_on)}{h.prod_name ? ` · ${h.prod_name}` : ''}</Kv>
            <Kv k="제조일 · 유효기한">{day(h.manufactured_on)} · {day(h.expiry_date)}</Kv>
            <Kv k="수량">생산 {num(h.qty_produced)} · 시료 {num(h.qty_sample)} · 출고 {num(shipped)} · 남음 {num(h.qty_available)}</Kv>
            <Kv k="수주">{orders ?? '-'}</Kv>
          </Block>
          <Block title="원재료">
            <Kv k="품목 · 로트">{h.raw_name} <span className="font-mono">{h.raw_lot}</span></Kv>
            <Kv k="공급자">{h.supplier ?? '-'}</Kv>
            <Kv k="공급자 로트"><span className="font-mono">{h.supplier_lot_no ?? '-'}</span></Kv>
            <Kv k="입고일 · 장입">{day(h.received_on)} · {num(h.sheet_count)}장{h.thickness_band ? ` · ${h.thickness_band}` : ''}</Kv>
            <Kv k="성적서"><span className="font-mono">{h.coa_no ?? '-'}</span></Kv>
            <Kv k="발주"><span className="font-mono">{h.raw_po ?? '-'}</span></Kv>
          </Block>
        </div>

        <Title>투입 자재</Title>
        {inputs.length === 0 ? <p className="text-[10px]">-</p> : (
          <table className="print-table w-full">
            <thead>
              <tr><th className="w-[30%]">품목</th><th className="w-[17%]">로트</th><th className="w-[10%] text-right">수량</th><th>공정 · 원료 로트</th></tr>
            </thead>
            <tbody>
              {inputs.map((x) => (
                <tr key={x.lot_id}>
                  <td><span className="font-mono text-[9px]">{x.code}</span> {x.name}{!x.shared && <span className="text-[9px]"> (이 제조번호)</span>}</td>
                  <td className="font-mono">{x.lot_no}</td>
                  <td className="text-right tnum">{num(x.qty)}{x.uom ? ` ${x.uom}` : ''}</td>
                  <td>{x.ops}{x.sub && <> · 원료 {x.sub}</>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <Title>공정 · 작업자 · 설비 <span className="font-normal text-[9px]">작업일은 제조기록서의 날</span></Title>
        {ops.length === 0 ? <p className="text-[10px]">-</p> : ops.length <= 6 ? <OpsTable ops={ops} /> : (
          /* 공정이 많으면 두 단으로 접는다 - 한 장에 들게 */
          <div className="grid grid-cols-2 gap-x-2">
            <OpsTable ops={ops.slice(0, Math.ceil(ops.length / 2))} />
            <OpsTable ops={ops.slice(Math.ceil(ops.length / 2))} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-4">
          <div>
            <Title>멸균</Title>
            {steril.length === 0 ? (
              <p className="text-[10px]">{skip ? `보고서 생략 · ${skip}` : '-'}</p>
            ) : steril.map((s, i) => (
              <p key={i} className="text-[10px]">
                <span className="font-mono">{s.batch_no}</span> · {s.vendor ?? '-'} · 발송 {day(s.shipped_at)} · 회수 {day(s.received_at)}
                <br />보고서 <span className="font-mono">{s.cert_no ?? '-'}</span>{s.request_no && <> · 의뢰 <span className="font-mono">{s.request_no}</span></>} · {num(s.qty)}개
              </p>
            ))}
          </div>
          {showCost && (
            <div>
              <Title>비용 <span className="font-normal text-[9px]">원 · VAT 별도</span></Title>
              <p className="text-[10px]">
                로트 원가 {cost == null ? '-' : won(cost)} · 개당 {unitCost == null ? '-' : won(unitCost)}
                {price != null && (
                  <>
                    <br />판매 단가 {won(Number(price))}
                    {unitCost != null && Number(price) > 0 && ` · 원가율 ${(unitCost / Number(price) * 100).toFixed(1)}%`}
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        {nc.length > 0 && (
          <>
            <Title>부적합 · 특채</Title>
            <table className="print-table w-full">
              <thead><tr><th className="w-[22%]">구분</th><th className="w-[12%]">발견일</th><th className="w-[12%]">결과</th><th className="w-[10%] text-right">수량</th><th>사유 · 문서</th></tr></thead>
              <tbody>
                {nc.map((n, i) => (
                  <tr key={i}>
                    <td>{n.what}</td><td className="tnum">{day(n.on)}</td><td>{OUTCOME[n.outcome] ?? n.outcome}</td>
                    <td className="text-right tnum">{num(n.qty)}{n.unit}</td>
                    <td>{n.reason}{n.doc && <span className="font-mono"> · {n.doc}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <Title>출고</Title>
        {ships.length === 0 ? <p className="text-[10px]">-</p> : (
          <table className="print-table w-full">
            <thead><tr><th className="w-[12%]">출고일</th><th className="w-[30%]">거래처 · 납품처</th><th className="w-[18%]">고객 발주</th><th className="w-[10%] text-right">수량</th><th>개체 범위</th></tr></thead>
            <tbody>
              {ships.map((s, i) => (
                <tr key={i}>
                  <td className="tnum">{day(s.shipped_at)}</td>
                  <td>{s.customer}{s.ship_to ? ` → ${s.ship_to}` : ''}</td>
                  <td className="font-mono">{s.customer_po_no ?? '-'}</td>
                  <td className="text-right tnum">{num(s.qty)}</td>
                  <td className="font-mono">{s.unit_from != null ? `${pad(s.unit_from)} ~ ${pad(s.unit_to ?? s.unit_from)}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <footer className="mt-3 flex justify-between border-t border-black pt-1 text-[9px]">
          <span>조회용 출력 · 정본은 제조기록서 · 배치 {h.batch_no}</span>
          <span>{user.full_name} · {printedAt}</span>
        </footer>
      </div>
    </>
  );
}

function OpsTable({ ops }: { ops: Op[] }) {
  return (
    <table className="print-table w-full self-start">
      <thead>
        <tr><th className="w-[8%] text-center">순</th><th className="w-[30%]">공정</th><th className="w-[22%]">작업일</th><th>작업자 · 설비</th></tr>
      </thead>
      <tbody>
        {ops.map((o) => (
          <tr key={o.seq}>
            <td className="text-center tnum">{o.seq}</td>
            <td>{o.name}</td>
            <td className="tnum">{day(o.first_on).slice(2)}{o.last_on && o.last_on !== o.first_on ? `~${day(o.last_on).slice(5)}` : ''}</td>
            <td>{o.workers ?? '-'}{o.equip && <span className="font-mono"> · {o.equip}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1 mt-2 border-b border-black pb-0.5 text-[11.5px] font-bold">{children}</h2>;
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <Title>{title}</Title>
      <dl>{children}</dl>
    </section>
  );
}
function Kv({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[24mm_1fr] gap-1 py-[1px]">
      <dt className="text-[10px] text-[#444]">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}
