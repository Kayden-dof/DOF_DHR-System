import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, hasRole } from '@/lib/session';
import { withUser } from '@/lib/db';
import type { RoleCode } from '@/lib/roles';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import Denied from '@/components/denied';
import { Panel, Empty, Tag, Field } from '@/components/ui';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../../nav';
import { TRACE_NAV } from '../../../sections';
import SolutionCorrectForm, { type RawLotOpt } from '../../../material/solution-correct-form';

export const dynamic = 'force-dynamic';

/**
 * 누가 언제 무엇을 했는가 (사용자 요청 2026-09-01).
 *
 * 제품 불만이 들어오면 되짚는 것이 셋이다 - 언제 만들었는가, 누가 작업했는가,
 * 언제 누구에게 나갔는가. 앞뒤 둘은 이미 이 화면에 있었는데 가운데가 없었다.
 */
interface WorkRow {
  day_no: number;
  work_date: string;
  operation_code: string;
  operation_name: string;
  attempt: number;
  worker_name: string;
  rotation_name: string | null;
  equipment_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  product_lot_no: string | null;
}

interface GenRow {
  material_lot_no: string; item_code: string; item_name: string; item_type: string;
  qty: string; issued_at: Date; operation_code: string; operation_name: string;
  after_cutting: boolean; product_lot_id: string | null;
}

interface MaterialLot {
  lot_no: string; item_code: string; item_name: string; item_type: string;
  usage_uom: string; qty_received: string; qty_available: string;
  /* 사내 제조 원액은 이 넷이 비어 있다. 제조일(made_on)이 있으면 원액이다 */
  coa_no: string | null; coa_date: string | null;
  supplier_name: string | null; supplier_lot_no: string | null; made_on: string | null;
  received_at: Date; expiry_date: string | null; thickness_band: string | null;
}
/** 원액 로트가 어느 원료 로트에서 얼마 만들어졌는가 (v_solution_input) */
interface SolutionInput {
  material_lot_id: string; material_lot_no: string; item_code: string; item_name: string;
  usage_uom: string; qty: string;
}
/** 이 로트가 원료로 들어간 원액이 어디에 다시 투입되었는가 */
interface ViaSolution {
  solution_id: string; solution_lot_no: string; drawn: string; drawn_uom: string;
  solution_uom: string; lot_no: string | null; batch_no: string | null;
  qty: string | null; operation_name: string | null;
}
interface BatchHead {
  id: string; batch_no: string; wo_no: string; sheet_count: number; status: string;
  /* 화면의 낱말이 제품에서 나온다 (0101) */
  split_op: string | null; load_unit: string | null;
  dmr_revision: string; issued_at: Date; item_code: string; item_name: string;
  raw_lot_id: string; raw_lot_no: string; raw_item_code: string;
  thickness_band: string | null; supplier_name: string; coa_no: string; coa_date: string;
  prod_name: string; qa_name: string;
}
interface ProductLotRow {
  id: string; lot_no: string; item_code: string; item_name: string;
  qty_produced: number; qty_sample: number; qty_available: number;
  manufactured_on: string; expiry_date: string; status: string;
  shipped: number; customers: string | null;
}

export default async function TraceDetail({ params }: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR', 'VIEWER', 'QP')) {
    return <Denied what="조회" need="생산관리자 또는 시스템관리자" />;
  }
  const { kind, id } = await params;

  if (kind === 'material') return <MaterialView me={user} id={id} />;
  if (kind === 'product' || kind === 'batch') {
    return <BatchView me={user} kind={kind} id={id} />;
  }
  notFound();
}

/* ---- 자재 로트 기준 (정추적) --------------------------------------------- */

type Me = { id: string; roles: RoleCode[] };

async function MaterialView({ me, id }: { me: Me; id: string }) {
  /* 원액의 원료 줄을 바로잡는 자리는 자재를 관리하는 사람에게만 낸다 (액션의 mgr 과 같다) */
  const canCorrect = me.roles.includes('SYS_ADMIN') || me.roles.includes('PROD_MGR');

  const d = await withUser(me, async (db) => {
    const lot = await db.one<MaterialLot>(
      `select ml.lot_no, i.code as item_code, i.name as item_name, i.type::text as item_type,
              i.usage_uom, ml.qty_received, ml.qty_available, ml.coa_no, ml.coa_date,
              s.name as supplier_name, ml.supplier_lot_no, ml.made_on, ml.received_at,
              ml.expiry_date, ml.thickness_band
         from material_lot ml join item i on i.id = ml.item_id
         left join supplier s on s.id = ml.supplier_id
        where ml.id = $1`, [id]);
    if (!lot) return null;

    return {
      lot,
      /*
       * 원액이면 무엇으로 만들었는가. 원료 줄과 그 반납 줄을 합한 순량이다
       * (v_solution_input) - 되돌려 순량이 0 이 된 원료는 이 표에서 빠진다.
       */
      inputs: lot.made_on
        ? await db.rows<SolutionInput>(
            `select material_lot_id, material_lot_no, item_code, item_name, usage_uom, qty
               from v_solution_input where solution_lot_id = $1
              order by item_code, material_lot_no`, [id])
        : [],
      /*
       * 원료 줄 더하기에서 고를 로트. 잔여가 있는 것이면 되고, 그 사이 기한이
       * 지난 로트도 넣는다 - 원액을 만든 날 쓴 로트가 오늘 기한 경과일 수 있다.
       * 원액 자신은 뺀다.
       */
      rawLots: lot.made_on && canCorrect
        ? await db.rows<RawLotOpt>(
            `select ml.id, ml.lot_no, i.name as item_name, i.usage_uom, ml.qty_available
               from material_lot ml join item i on i.id = ml.item_id
              where ml.qty_available > 0
                and ml.status in ('AVAILABLE','EXPIRED')
                and ml.id <> $1
              order by i.code, ml.lot_no`, [id])
        : [],
      /*
       * 이 로트가 원액의 원료였다면, 그 원액이 간 곳까지 이어 준다. 원액은
       * 투입 기록이 있는 자재 로트이므로 (material_issue) 지금 표와 같은 길로
       * 배치 · 제품 로트에 닿는다. 원액이 아직 어디에도 투입되지 않았으면
       * 원액 로트만 남고 나머지 칸이 빈다.
       */
      viaSolution: await db.rows<ViaSolution>(
        `select vi.solution_lot_id as solution_id, vi.solution_lot_no,
                vi.qty as drawn, vi.usage_uom as drawn_uom, si.usage_uom as solution_uom,
                pl.lot_no, wo.batch_no, mi.qty, o.name as operation_name
           from v_solution_input vi
           join material_lot sl on sl.id = vi.solution_lot_id
           join item si on si.id = sl.item_id
           left join material_issue mi on mi.material_lot_id = vi.solution_lot_id
           left join process_record pr on pr.id = mi.process_record_id
           left join work_order wo on wo.id = pr.work_order_id
           left join dmr_operation o on o.id = pr.operation_id
           left join product_lot pl on pl.id = pr.product_lot_id
          where vi.material_lot_id = $1
          order by vi.solution_lot_no, mi.issued_at`, [id]),
      // 원재료는 작업 지시에 직접 붙는다
      batches: await db.rows<{ id: string; batch_no: string; sheet_count: number; status: string }>(
        `select id, batch_no, sheet_count, status::text as status
           from work_order where material_lot_id = $1 order by issued_at desc`, [id]),
      // 시약·포장재는 공정 기록을 경유한다
      products: await db.rows<{
        id: string; lot_no: string; item_name: string; batch_no: string;
        qty: string; operation_name: string;
      }>(
        `select coalesce(pl.id::text, '') as id, coalesce(pl.lot_no, '') as lot_no,
                coalesce(pi.name, '') as item_name, wo.batch_no, mi.qty, o.name as operation_name
           from material_issue mi
           join process_record pr on pr.id = mi.process_record_id
           join work_order wo on wo.id = pr.work_order_id
           join dmr_operation o on o.id = pr.operation_id
           left join product_lot pl on pl.id = pr.product_lot_id
           left join item pi on pi.id = pl.item_id
          where mi.material_lot_id = $1
          order by mi.issued_at`, [id]),
    };
  });

  if (!d) notFound();
  const { lot } = d;

  /* ---- 자재 로트 기준 (정추적) ------------------------------------------ */
  return (
      <PageShell
        section="조회"
        title={lot.lot_no}
        lede={<>{lot.item_name} · {lot.item_code}</>}
        nav={<SubNav items={TRACE_NAV} />}
      >

        {lot.made_on ? (
          <>
            {/* 사내에서 만든 원액이다. 입고한 것이 아니므로 공급자 · 성적서 칸이 없다 */}
            <Panel title="제조 정보">
              <div className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="제조일"><span className="tnum">{fmtDate(lot.made_on)}</span></Field>
                <Field label="제조량">
                  <span className="tnum">{Number(lot.qty_received)} {lot.usage_uom}</span>
                </Field>
                <Field label="잔여">
                  <span className="tnum font-semibold">{Number(lot.qty_available)}</span>
                </Field>
                <Field label="유효기한"><span className="tnum">{fmtDate(lot.expiry_date)}</span></Field>
              </div>
            </Panel>

            <Panel title="원료" note="이 원액을 만드는 데 쓴 로트입니다">
              {d.inputs.length === 0 ? (
                <Empty hint="원료 줄을 되돌려 순량이 0 이 되면 이 표에서 빠집니다. 줄 자체는 재고 증감에 남아 있습니다.">
                  원료로 남은 로트가 없습니다.
                </Empty>
              ) : (
                <div className="qd-table-scroll">
                  <table className="qd-table qd-table--hangul" data-grow="2">
                    <thead>
                      <tr>
                        <th className="th">원료 로트</th>
                        <th className="th">품목</th>
                        <th className="th text-right">사용량</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.inputs.map((x) => (
                        <tr key={x.material_lot_id}>
                          <td className="td font-mono text-xs font-semibold">
                            <Link href={`/trace/material/${x.material_lot_id}`}
                                  className="text-brand hover:underline">
                              {x.material_lot_no}
                            </Link>
                          </td>
                          <td className="td">
                            <div className="text-sm">{x.item_name}</div>
                            <div className="font-mono text-xs text-faint">{x.item_code}</div>
                          </td>
                          <td className="td tnum text-right">
                            {`${Number(x.qty)} ${x.usage_uom}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {canCorrect && (
                <SolutionCorrectForm solutionId={id} inputs={d.inputs} lots={d.rawLots}
                                     used={d.products.length > 0} />
              )}
            </Panel>
          </>
        ) : (
          <Panel title="입고 정보">
            <div className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="공급자">{lot.supplier_name}</Field>
              <Field label="공급자 로트"><span className="font-mono">{lot.supplier_lot_no}</span></Field>
              <Field label="성적서">
                <span className="font-mono">{lot.coa_no}</span>
                <span className="ml-2 tnum text-xs text-muted">{fmtDate(lot.coa_date)}</span>
              </Field>
              <Field label="입고일"><span className="tnum">{fmtDate(lot.received_at)}</span></Field>
              <Field label="입고 수량">
                <span className="tnum">{Number(lot.qty_received)} {lot.usage_uom}</span>
              </Field>
              <Field label="잔여">
                <span className="tnum font-semibold">{Number(lot.qty_available)}</span>
              </Field>
              <Field label="유효기한"><span className="tnum">{fmtDate(lot.expiry_date)}</span></Field>
              {lot.thickness_band && <Field label="두께 구간">{lot.thickness_band}</Field>}
            </div>
          </Panel>
        )}

        {d.batches.length > 0 && (
          <Panel title="이 원재료로 만든 배치">
            <div className="qd-table-scroll">
              <table className="qd-table qd-table--hangul">
                <thead>
                  <tr>
                    <th className="th">배치번호</th>
                    <th className="th text-right">장입</th>
                    <th className="th">상태</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody>
                  {d.batches.map((b) => (
                    <tr key={b.id}>
                      <td className="td font-mono font-semibold">{b.batch_no}</td>
                      <td className="td tnum text-right">{b.sheet_count}</td>
                      <td className="td ">{b.status}</td>
                      <td className="td text-right">
                        <Link href={`/trace/batch/${b.id}`} className="btn-ghost">
                          계보
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        <Panel
          title="이 자재가 들어간 곳"
          note="공정 기록을 경유한 계보입니다"
        >
          {d.products.length === 0 ? (
            /*
             * 직접 투입이 없다는 말이다. 이 로트로 만든 원액이 있으면 그 원액이 간
             * 곳이 아래에 따로 선다 - 같은 화면에서 "투입되지 않았다" 고 하면서 그
             * 아래에 배치를 늘어놓으면 영향 범위를 보러 온 사람이 위의 말을 믿는다.
             */
            d.viaSolution.length > 0 ? (
              <Empty hint="이 로트로 만든 원액이 어디에 들어갔는지는 아래 표에 있습니다.">
                직접 투입된 기록이 없습니다.
              </Empty>
            ) : (
              <Empty hint="현장 화면에서 이 로트를 투입 자재로 적으면 계보가 이어집니다.">
                아직 공정에 투입되지 않았습니다.
              </Empty>
            )
          ) : (
            <div className="qd-table-scroll">
              <table className="qd-table qd-table--hangul" data-grow="0">
                <thead>
                  <tr>
                    <th className="th">배치</th>
                    <th className="th">공정</th>
                    <th className="th">제품 로트</th>
                    <th className="th text-right">투입량</th>
                  </tr>
                </thead>
                <tbody>
                  {d.products.map((p, i) => (
                    <tr key={i}>
                      <td className="td font-mono ">{p.batch_no}</td>
                      <td className="td text-sm">{p.operation_name}</td>
                      <td className="td font-mono font-semibold">
                        {p.lot_no || <span className="font-sans text-muted">배치 전체</span>}
                      </td>
                      <td className="td tnum text-right">{Number(p.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {d.viaSolution.length > 0 && (
          <Panel
            title="원액을 거쳐 들어간 곳"
            note="이 로트를 원료로 만든 원액이 투입된 자리입니다"
          >
            <div className="qd-table-scroll">
              <table className="qd-table qd-table--hangul" data-grow="3">
                <thead>
                  <tr>
                    <th className="th">원액 로트</th>
                    <th className="th">배치</th>
                    <th className="th">공정</th>
                    <th className="th">제품 로트</th>
                    <th className="th text-right">투입량</th>
                  </tr>
                </thead>
                <tbody>
                  {d.viaSolution.map((v, i) => (
                    <tr key={i}>
                      <td className="td">
                        <Link href={`/trace/material/${v.solution_id}`}
                              className="font-mono text-xs font-semibold text-brand hover:underline">
                          {v.solution_lot_no}
                        </Link>
                        <div className="text-xs text-faint">
                          {`이 로트 ${Number(v.drawn)} ${v.drawn_uom}`}
                        </div>
                      </td>
                      {v.batch_no ? (
                        <>
                          <td className="td font-mono text-xs">{v.batch_no}</td>
                          <td className="td text-sm">{v.operation_name}</td>
                          <td className="td font-mono text-xs font-semibold">
                            {v.lot_no || <span className="font-sans text-muted">배치 전체</span>}
                          </td>
                          <td className="td tnum text-right">
                            {`${Number(v.qty)} ${v.solution_uom}`}
                          </td>
                        </>
                      ) : (
                        <td className="td text-sm text-muted" colSpan={4}>
                          아직 공정에 투입되지 않았습니다.
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </PageShell>
  );
}

/* ---- 배치 · 제품 로트 기준 (역추적) --------------------------------------- */

async function BatchView({ me, kind, id }: {
  me: Me; kind: 'product' | 'batch'; id: string;
}) {
  const d = await withUser(me, async (db) => {
    const woId = kind === 'product'
      ? await db.val<string>(`select work_order_id::text from product_lot where id = $1`, [id])
      : id;
    if (!woId) return null;

    const wo = await db.one<BatchHead>(
      `select wo.id, wo.batch_no, wo.wo_no, wo.sheet_count, wo.status::text as status,
              wo.dmr_revision, wo.issued_at, i.code as item_code, i.name as item_name,
              ml.id as raw_lot_id, ml.lot_no as raw_lot_no, ri.code as raw_item_code,
              ml.thickness_band, s.name as supplier_name, ml.coa_no, ml.coa_date,
              up.full_name as prod_name, uq.full_name as qa_name,
              split_op_name(dm.id) as split_op, dm.load_unit
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
         join material_lot ml on ml.id = wo.material_lot_id
         join item ri on ri.id = ml.item_id
         join supplier s on s.id = ml.supplier_id
         join app_user up on up.id = wo.issued_by_prod
         join app_user uq on uq.id = wo.issued_by_qa
        where wo.id = $1`, [woId]);
    if (!wo) return null;

    return {
      wo,
      focusLot: kind === 'product' ? id : null,
      focusLotNo: kind === 'product'
        ? await db.val<string>(`select lot_no from product_lot where id = $1`, [id])
        : null,
      lots: await db.rows<ProductLotRow>(
        `select pl.id, pl.lot_no, i.code as item_code, i.name as item_name,
                pl.qty_produced, pl.qty_sample, pl.qty_available,
                pl.manufactured_on, pl.expiry_date, pl.status::text as status,
                coalesce((select sum(sh.qty)::int from shipment sh
                           where sh.product_lot_id = pl.id), 0) as shipped,
                (select string_agg(distinct sh.customer_name, ', ') from shipment sh
                  where sh.product_lot_id = pl.id) as customers
           from product_lot pl join item i on i.id = pl.item_id
          where pl.work_order_id = $1 order by i.code`, [woId]),
      /*
       * 공정 기록. 시각은 to_char 로 글자로 받는다 - 화면이 Date 를 받아 자르면
       * 보는 사람의 시간대로 그려진다 (lib/db.ts · §10).
       */
      work: await db.rows<WorkRow>(
        `select pr.day_no, pr.work_date::text as work_date,
                o.code as operation_code, o.name as operation_name, pr.attempt,
                u.full_name as worker_name,
                r.full_name as rotation_name,
                pr.equipment_id,
                to_char(timezone('Asia/Seoul', pr.started_at), 'HH24:MI') as started_at,
                to_char(timezone('Asia/Seoul', pr.ended_at),   'HH24:MI') as ended_at,
                pl.lot_no as product_lot_no
           from process_record pr
           join dmr_operation o on o.id = pr.operation_id
           join app_user u on u.id = pr.worker_id
           left join app_user r on r.id = pr.rotation_worker_id
           left join product_lot pl on pl.id = pr.product_lot_id
          where pr.work_order_id = $1
          order by pr.day_no, o.seq, pr.attempt`, [woId]),
      genealogy: await db.rows<GenRow>(
        `select material_lot_no, item_code, item_name, item_type::text as item_type,
                qty, issued_at, operation_code, operation_name, after_cutting, product_lot_id
           from v_lot_genealogy where work_order_id = $1
          order by after_cutting, item_code`, [woId]),
    };
  });

  if (!d) notFound();
  const { wo, lots, genealogy, focusLot, focusLotNo } = d;
  const pre = genealogy.filter((g) => !g.after_cutting);
  const post = genealogy.filter((g) => g.after_cutting);

  /*
   * 제조번호로 들어왔는데 화면 제목이 배치번호였다. 찾은 번호는 P2608-0001 인데
   * 화면은 B2608-0001 이라고 말하니, 잘못 눌렀나 싶어 되돌아가게 된다.
   *
   * 찾아 온 번호를 제목에 둔다. 계보는 배치를 거쳐야 원재료까지 닿으므로 아래
   * 내용은 그대로 배치 전체를 보여 주고, 그 사실을 설명에 적는다.
   */
  return (
    <PageShell
      section="조회"
      title={focusLotNo ?? wo.batch_no}
      lede={focusLotNo
        ? <>배치 <b className="font-mono text-ink">{wo.batch_no}</b> 에서 나왔습니다.
            계보는 배치를 거쳐 원재료까지 닿습니다.</>
        : <>{wo.item_name} · {wo.dmr_revision}</>}
      nav={<SubNav items={TRACE_NAV} />}
    >

      <Panel title="원재료" note="배치당 하나. 계보의 시작점입니다">
        <div className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="원재료 로트">
            <Link href={`/trace/material/${wo.raw_lot_id}`}
                  className="font-mono font-semibold text-brand hover:underline">
              {wo.raw_lot_no}
            </Link>
          </Field>
          <Field label="품목"><span className="font-mono">{wo.raw_item_code}</span></Field>
          <Field label="두께 구간">{wo.thickness_band ?? ''}</Field>
          <Field label="장입">
            <span className="tnum">{wo.sheet_count}{wo.load_unit ?? ''}</span>
          </Field>
          <Field label="공급자">{wo.supplier_name}</Field>
          <Field label="성적서">
            <span className="font-mono">{wo.coa_no}</span>
            <span className="ml-2 tnum text-xs text-muted">{fmtDate(wo.coa_date)}</span>
          </Field>
          <Field label="발행"><span className="tnum">{fmtDate(wo.issued_at)}</span></Field>
          <Field label="서명란">{wo.prod_name} · {wo.qa_name}</Field>
        </div>
      </Panel>

      <Panel title="생성된 제품 로트">
        {lots.length === 0 ? (
          <Empty hint="현장 화면에서 재단 공정을 적으면 형명별로 제조번호가 나뉩니다.">
            제조번호가 붙지 않았습니다.
          </Empty>
        ) : (
          <div className="qd-table-scroll">
            <table className="qd-table qd-table--hangul" data-grow="2">
              <thead>
                <tr>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th text-right">생산</th>
                  <th className="th text-right">샘플</th>
                  <th className="th text-right">잔여</th>
                  <th className="th text-right">출고</th>
                  <th className="th">거래처</th>
                  <th className="th">유효기한</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.id}
                      className={l.id === focusLot ? 'bg-brand-soft' : undefined}>
                    <td className="td font-mono font-semibold">{l.lot_no}</td>
                    <td className="td text-sm">{l.item_name}</td>
                    <td className="td tnum text-right">{l.qty_produced}</td>
                    <td className="td tnum text-right text-muted">{l.qty_sample || ''}</td>
                    <td className="td tnum text-right">{l.qty_available}</td>
                    <td className="td tnum text-right text-muted">{l.shipped || ''}</td>
                    <td className="td text-muted">{l.customers ?? ''}</td>
                    <td className="td tnum ">{fmtDate(l.expiry_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/*
        * 누가 언제 무엇을 했는가. 불만이 들어왔을 때 되짚는 자리다.
        *
        * 순환자는 이름만 적는다 - 서명하지 않고, 얼마나 있었는지도 기록에 없다
        * (§11). 없는 것을 지어내지 않는다.
        */}
      <Panel title="공정 기록" note="누가 언제 무엇을 했는가">
        {d.work.length === 0 ? (
          <Empty hint="현장 화면에서 이 배치의 공정을 시작하면 여기 쌓입니다.">
            기록된 공정이 없습니다.
          </Empty>
        ) : (
          <div className="qd-table-scroll">
            <table className="qd-table qd-table--hangul" data-grow="0">
              <thead>
                <tr>
                  <th className="th">일차</th>
                  <th className="th">작업일</th>
                  <th className="th">공정</th>
                  <th className="th">작업자</th>
                  <th className="th">설비</th>
                  <th className="th">시각</th>
                  <th className="th">제조번호</th>
                </tr>
              </thead>
              <tbody>
                {d.work.map((w, i) => (
                  <tr key={i}>
                    <td className="td tnum text-muted">
                      {w.day_no}일차
                      {w.attempt > 1 && (
                        <span className="ml-1 text-warn">{w.attempt}회차</span>
                      )}
                    </td>
                    <td className="td tnum text-muted">{w.work_date}</td>
                    <td className="td">
                      <div className="text-sm">{w.operation_name}</div>
                      <div className="font-mono text-xs text-faint">{w.operation_code}</div>
                    </td>
                    <td className="td text-sm">
                      {w.worker_name}
                      {w.rotation_name && (
                        <span className="ml-1.5 text-xs text-muted">
                          순환 {w.rotation_name}
                        </span>
                      )}
                    </td>
                    <td className="td font-mono text-muted">{w.equipment_id}</td>
                    <td className="td tnum text-muted whitespace-nowrap">
                      {w.started_at && w.ended_at
                        ? `${w.started_at} ~ ${w.ended_at}`
                        : <span className="text-faint">시각 없음</span>}
                    </td>
                    <td className="td font-mono text-muted">{w.product_lot_no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="배치 단위 투입 자재">
        {pre.length === 0 ? (
          <Empty hint="재단 이전 공정에서 적은 자재가 여기 모입니다.">기록이 없습니다.</Empty>
        ) : <GenTable rows={pre} />}
      </Panel>

      <Panel title="제품 로트 단위 투입 자재">
        {post.length === 0 ? (
          <Empty hint="재단 이후 공정에서 적은 자재가 여기 모입니다.">기록이 없습니다.</Empty>
        ) : (
          <GenTable rows={post} lots={lots} />
        )}
      </Panel>
    </PageShell>
  );
}

function GenTable({ rows, lots }: {
  rows: GenRow[];
  lots?: { id: string; lot_no: string }[];
}) {
  const lotNo = (id: string | null) => lots?.find((l) => l.id === id)?.lot_no ?? '';
  return (
    <div className="qd-table-scroll">
      <table className="qd-table qd-table--hangul">
        <thead>
          <tr>
            <th className="th">자재</th>
            <th className="th">로트번호</th>
            <th className="th text-right">투입량</th>
            <th className="th">공정</th>
            {lots && <th className="th">제품 로트</th>}
            <th className="th">투입 일시</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g, i) => (
            <tr key={i}>
              <td className="td">
                <div className="text-sm">{g.item_name}</div>
                <div className="font-mono text-xs text-faint">{g.item_code}</div>
              </td>
              <td className="td font-mono font-semibold">{g.material_lot_no}</td>
              <td className="td tnum text-right">{Number(g.qty)}</td>
              <td className="td ">{g.operation_name}</td>
              {lots && (
                <td className="td font-mono ">{lotNo(g.product_lot_id)}</td>
              )}
              <td className="td tnum text-muted">{fmtDateTime(g.issued_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
