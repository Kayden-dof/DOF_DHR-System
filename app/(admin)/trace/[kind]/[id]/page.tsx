import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import Denied from '@/components/denied';
import { Panel, Empty, Tag, Field } from '@/components/ui';

export const dynamic = 'force-dynamic';

interface GenRow {
  material_lot_no: string; item_code: string; item_name: string; item_type: string;
  qty: string; issued_at: Date; operation_code: string; operation_name: string;
  after_cutting: boolean; product_lot_id: string | null;
}

interface MaterialLot {
  lot_no: string; item_code: string; item_name: string; item_type: string;
  usage_uom: string; qty_received: string; qty_available: string;
  coa_no: string; coa_date: string; supplier_name: string; supplier_lot_no: string;
  received_at: Date; expiry_date: string | null; thickness_band: string | null;
}
interface BatchHead {
  id: string; batch_no: string; wo_no: string; sheet_count: number; status: string;
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
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="조회" need="생산관리자 또는 시스템관리자" />;
  }
  const { kind, id } = await params;

  if (kind === 'material') return <MaterialView userId={user.id} id={id} />;
  if (kind === 'product' || kind === 'batch') {
    return <BatchView userId={user.id} kind={kind} id={id} />;
  }
  notFound();
}

/* ---- 자재 로트 기준 (정추적) --------------------------------------------- */

async function MaterialView({ userId, id }: { userId: string; id: string }) {
  const d = await withActor(userId, async (db) => {
    const lot = await db.one<MaterialLot>(
      `select ml.lot_no, i.code as item_code, i.name as item_name, i.type::text as item_type,
              i.usage_uom, ml.qty_received, ml.qty_available, ml.coa_no, ml.coa_date,
              s.name as supplier_name, ml.supplier_lot_no, ml.received_at,
              ml.expiry_date, ml.thickness_band
         from material_lot ml join item i on i.id = ml.item_id
         join supplier s on s.id = ml.supplier_id
        where ml.id = $1`, [id]);
    if (!lot) return null;

    return {
      lot,
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
      <div className="space-y-5">
        <Link href="/trace" className="text-xs font-semibold text-muted hover:text-ink">
          조회로
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
            <span className="font-mono">{lot.lot_no}</span>
            <Tag tone="info">자재 로트</Tag>
          </h1>
          <p className="mt-1 text-sm text-muted">{lot.item_name} · {lot.item_code}</p>
        </div>

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

        {d.batches.length > 0 && (
          <Panel title="이 원재료로 만든 배치" note="원재료는 작업 지시에 직접 붙는다">
            <div className="overflow-x-auto">
              <table className="w-full">
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
                      <td className="td font-mono text-xs font-semibold">{b.batch_no}</td>
                      <td className="td tnum text-right">{b.sheet_count}장</td>
                      <td className="td text-xs">{b.status}</td>
                      <td className="td text-right">
                        <Link href={`/trace/batch/${b.id}`} className="btn-ghost h-8 px-3 text-xs">
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
          note="공정 기록을 경유한 계보. 재단 후 공정은 제품 로트별로 갈린다"
        >
          {d.products.length === 0 ? (
            <Empty>아직 공정에 투입되지 않았습니다.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
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
                      <td className="td font-mono text-xs">{p.batch_no}</td>
                      <td className="td text-sm">{p.operation_name}</td>
                      <td className="td font-mono text-xs font-semibold">
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
      </div>
  );
}

/* ---- 배치 · 제품 로트 기준 (역추적) --------------------------------------- */

async function BatchView({ userId, kind, id }: {
  userId: string; kind: 'product' | 'batch'; id: string;
}) {
  const d = await withActor(userId, async (db) => {
    const woId = kind === 'product'
      ? await db.val<string>(`select work_order_id::text from product_lot where id = $1`, [id])
      : id;
    if (!woId) return null;

    const wo = await db.one<BatchHead>(
      `select wo.id, wo.batch_no, wo.wo_no, wo.sheet_count, wo.status::text as status,
              wo.dmr_revision, wo.issued_at, i.code as item_code, i.name as item_name,
              ml.id as raw_lot_id, ml.lot_no as raw_lot_no, ri.code as raw_item_code,
              ml.thickness_band, s.name as supplier_name, ml.coa_no, ml.coa_date,
              up.full_name as prod_name, uq.full_name as qa_name
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
      genealogy: await db.rows<GenRow>(
        `select material_lot_no, item_code, item_name, item_type::text as item_type,
                qty, issued_at, operation_code, operation_name, after_cutting, product_lot_id
           from v_lot_genealogy where work_order_id = $1
          order by after_cutting, item_code`, [woId]),
    };
  });

  if (!d) notFound();
  const { wo, lots, genealogy, focusLot } = d;
  const pre = genealogy.filter((g) => !g.after_cutting);
  const post = genealogy.filter((g) => g.after_cutting);

  return (
    <div className="space-y-5">
      <Link href="/trace" className="text-xs font-semibold text-muted hover:text-ink">조회로</Link>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
          <span className="font-mono">{wo.batch_no}</span>
          <Tag tone="quiet">배치</Tag>
        </h1>
        <p className="mt-1 text-sm text-muted">{wo.item_name} · {wo.dmr_revision}</p>
      </div>

      <Panel title="원재료" note="배치당 하나. 여기서 계보가 시작된다">
        <div className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="원재료 로트">
            <Link href={`/trace/material/${wo.raw_lot_id}`}
                  className="font-mono font-semibold text-brand hover:underline">
              {wo.raw_lot_no}
            </Link>
          </Field>
          <Field label="품목"><span className="font-mono">{wo.raw_item_code}</span></Field>
          <Field label="두께 구간">{wo.thickness_band ?? ''}</Field>
          <Field label="장입"><span className="tnum">{wo.sheet_count}장</span></Field>
          <Field label="공급자">{wo.supplier_name}</Field>
          <Field label="성적서">
            <span className="font-mono">{wo.coa_no}</span>
            <span className="ml-2 tnum text-xs text-muted">{fmtDate(wo.coa_date)}</span>
          </Field>
          <Field label="발행"><span className="tnum">{fmtDate(wo.issued_at)}</span></Field>
          <Field label="발행자">{wo.prod_name} · {wo.qa_name}</Field>
        </div>
      </Panel>

      <Panel title="생성된 제품 로트">
        {lots.length === 0 ? (
          <Empty>재단하지 않았습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
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
                    <td className="td font-mono text-xs font-semibold">{l.lot_no}</td>
                    <td className="td text-sm">{l.item_name}</td>
                    <td className="td tnum text-right">{l.qty_produced}</td>
                    <td className="td tnum text-right text-muted">{l.qty_sample || ''}</td>
                    <td className="td tnum text-right">{l.qty_available}</td>
                    <td className="td tnum text-right text-muted">{l.shipped || ''}</td>
                    <td className="td text-xs text-muted">{l.customers ?? ''}</td>
                    <td className="td tnum text-xs">{fmtDate(l.expiry_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="재단 전 투입 자재" note="배치 전체에 걸린다">
        {pre.length === 0 ? <Empty>기록이 없습니다.</Empty> : <GenTable rows={pre} />}
      </Panel>

      <Panel title="재단 후 투입 자재" note="제품 로트별로 갈린다">
        {post.length === 0 ? <Empty>기록이 없습니다.</Empty> : (
          <GenTable rows={post} lots={lots} />
        )}
      </Panel>
    </div>
  );
}

function GenTable({ rows, lots }: {
  rows: GenRow[];
  lots?: { id: string; lot_no: string }[];
}) {
  const lotNo = (id: string | null) => lots?.find((l) => l.id === id)?.lot_no ?? '';
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
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
              <td className="td font-mono text-xs font-semibold">{g.material_lot_no}</td>
              <td className="td tnum text-right">{Number(g.qty)}</td>
              <td className="td text-xs">{g.operation_name}</td>
              {lots && (
                <td className="td font-mono text-xs">{lotNo(g.product_lot_id)}</td>
              )}
              <td className="td tnum text-xs text-muted">{fmtDateTime(g.issued_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
