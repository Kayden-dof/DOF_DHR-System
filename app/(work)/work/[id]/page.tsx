import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { Tag } from '@/components/ui';
import WorkPanel, {
  type Op, type Rec, type LotOpt, type PersonOpt, type PlOpt,
} from './work-panel';

export const dynamic = 'force-dynamic';

interface Wo {
  id: string; batch_no: string; wo_no: string; sheet_count: number; status: string;
  item_name: string; item_code: string; dmr_revision: string;
  raw_lot_no: string; thickness_band: string | null; device_master_id: string;
}

export default async function WorkBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const d = await withActor(user.id, async (db) => {
    const wo = await db.one<Wo>(
      `select wo.id, wo.batch_no, wo.wo_no, wo.sheet_count, wo.status::text as status,
              wo.dmr_revision, wo.device_master_id,
              i.name as item_name, i.code as item_code,
              ml.lot_no as raw_lot_no, ml.thickness_band
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
         join material_lot ml on ml.id = wo.material_lot_id
        where wo.id = $1`, [id]);
    if (!wo) return null;

    return {
      wo,
      ops: await db.rows<Op>(
        `select o.id, o.seq, o.code, o.name, o.after_cutting,
                coalesce((
                  select json_agg(json_build_object(
                    'item_id', b.component_item_id, 'item_code', ci.code,
                    'item_name', ci.name, 'usage_uom', ci.usage_uom,
                    'basis', b.basis::text,
                    'required', required_qty(o.id, b.component_item_id, $2, 0))
                    order by ci.code)
                    from dmr_bom b join item ci on ci.id = b.component_item_id
                   where b.operation_id = o.id), '[]'::json) as bom,
                -- 이 공정에 걸린 설비. 없으면 현장 화면에 칸 자체가 나오지 않는다
                coalesce((
                  select json_agg(json_build_object(
                    'id', q.id, 'code', q.code, 'name', q.name,
                    'valid_until', q.valid_until::text) order by q.code)
                    from operation_equipment_list(o.id) q), '[]'::json) as equipment
           from dmr_operation o
          where o.device_master_id = $1 order by o.seq`,
        [wo.device_master_id, wo.sheet_count]),
      records: await db.rows<Rec>(
        `select pr.id, pr.operation_id, pr.day_no, pr.attempt, pr.product_lot_id,
                pl.lot_no as product_lot_no, pr.started_at, pr.ended_at,
                pr.equipment_id, pr.rework_qty, pr.no_material_reason, pr.worker_id,
                u.full_name as worker_name,
                coalesce((
                  select json_agg(json_build_object(
                    'item_id', i.id, 'item_code', i.code, 'item_name', i.name,
                    'lot_no', ml.lot_no, 'qty', mi.qty, 'usage_uom', i.usage_uom)
                    order by mi.issued_at)
                    from material_issue mi
                    join material_lot ml on ml.id = mi.material_lot_id
                    join item i on i.id = ml.item_id
                   where mi.process_record_id = pr.id), '[]'::json) as issues
           from process_record pr
           join app_user u on u.id = pr.worker_id
           left join product_lot pl on pl.id = pr.product_lot_id
          where pr.work_order_id = $1
          order by pr.day_no, pr.attempt`, [id]),
      lots: await db.rows<LotOpt>(
        `select ml.id, ml.lot_no, i.id as item_id, i.code as item_code, i.name as item_name,
                i.usage_uom, ml.qty_available, ml.expiry_date
           from material_lot ml join item i on i.id = ml.item_id
          where ml.status = 'AVAILABLE' and ml.qty_available > 0 and i.type <> 'RAW'
          order by i.code, ml.expiry_date nulls last, ml.lot_no`),
      people: await db.rows<PersonOpt>(
        `select u.id, u.full_name from app_user u
           join user_role r on r.user_id = u.id and r.role = 'WORKER'
          where u.is_active and u.id <> $1 order by u.full_name`, [user.id]),
      productLots: await db.rows<PlOpt>(
        `select pl.id, pl.lot_no, i.code as item_code, i.name as item_name
           from product_lot pl join item i on i.id = pl.item_id
          where pl.work_order_id = $1 order by i.code`, [id]),
      lockedDays: await db.rows<{ day_no: number }>(
        `select day_no from day_lock where work_order_id = $1 and worker_id = $2`,
        [id, user.id]),
    };
  });

  if (!d) notFound();
  const { wo } = d;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/work" className="text-sm font-semibold text-on-dark-mute transition-colors hover:text-white">
          배치 목록으로
        </Link>
        <div className="mt-2 card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-2xl font-bold text-ink">{wo.batch_no}</span>
            <Tag tone="brand">{wo.item_name}</Tag>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
            <span>지시서 <span className="font-mono text-ink">{wo.wo_no}</span></span>
            <span>장입 <b className="tnum text-ink">{wo.sheet_count}</b>장</span>
            <span>원재료 <span className="font-mono text-ink">{wo.raw_lot_no}</span></span>
            {wo.thickness_band && <span>두께 <b className="text-ink">{wo.thickness_band}</b></span>}
            <span>개정 <span className="font-mono text-ink">{wo.dmr_revision}</span></span>
          </div>
        </div>
      </div>

      <WorkPanel
        woId={wo.id}
        batchNo={wo.batch_no}
        sheets={wo.sheet_count}
        ops={d.ops}
        records={d.records}
        lots={d.lots}
        people={d.people}
        productLots={d.productLots}
        meId={user.id}
        lockedDays={d.lockedDays.map((r) => r.day_no)}
      />
    </div>
  );
}
