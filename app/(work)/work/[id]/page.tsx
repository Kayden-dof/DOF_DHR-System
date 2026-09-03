import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayKST } from '@/lib/kst';
import { requireUser} from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { Tag } from '@/components/ui';
import { WO_STATUS_LABEL } from '@/lib/forms';
import WorkPanel, {
  type Op, type Rec, type LotOpt, type PersonOpt, type PlOpt, type FinOpt,
  type SampleTier,
} from './work-panel';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목에 배치번호를 넣는다. 배치 둘을 나란히 놓고 견주려면 탭 이름만 보고
 * 어느 쪽이 어느 배치인지 알아야 한다 (사용자 요청). 자료를 못 읽으면 조용히
 * 기본 제목으로 떨어진다 - 제목 때문에 화면이 죽으면 안 된다.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const b = await withActor(user.id, (db) =>
      db.val<string>(`select batch_no from work_order where id = $1`, [id]));
    return b ? { title: `${b} 현장` } : {};
  } catch {
    return {};
  }
}


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
        `select o.id, o.seq, o.code, o.name, o.after_cutting, o.typical_day,
                o.takes_rework,
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
                pr.work_date::text as work_date,
                pl.lot_no as product_lot_no, pr.started_at, pr.ended_at,
                pr.equipment_id, pr.rework_qty, pr.no_material_reason, pr.worker_id,
                u.full_name as worker_name,
                coalesce((
                  select json_agg(json_build_object(
                    'id', mi.id,
                    'item_id', i.id, 'item_code', i.code, 'item_name', i.name,
                    'lot_no', ml.lot_no, 'qty', mi.qty, 'usage_uom', i.usage_uom,
                    'amend_reason', mi.amend_reason,
                    /* 이 배치에서 이 로트로 돌아간 양. 정정 사실을 줄 옆에 적는다 */
                    'returned', (select sum(sm.qty) from stock_movement sm
                                  where sm.type = 'RETURN'
                                    and sm.material_lot_id = mi.material_lot_id
                                    and sm.work_order_id = pr.work_order_id))
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
        `select pl.id, pl.lot_no, i.code as item_code, i.name as item_name,
                pl.qty_produced, pl.qty_sample
           from product_lot pl join item i on i.id = pl.item_id
          where pl.work_order_id = $1 order by i.code`, [id]),
      /*
       * 재단은 현장에서 일어난다. 잘라 낸 사람이 그 자리에서 형명별 수량을
       * 적을 수 있으려면 고를 형명과 뽑을 샘플 수가 화면에 있어야 한다.
       */
      cutOpId: await db.val<string | null>(
        `select cut_operation_id($1)`, [wo.device_master_id]),
      /* 생산 수량 구간별 시료 수. 근거 문구도 함께 내보낸다 (§6) */
      sampleTiers: await db.rows<SampleTier>(
        `select min_qty, max_qty, sample_qty from sample_plan
          where device_master_id = $1 order by min_qty`, [wo.device_master_id]),
      sampleBasis: await db.val<string | null>(
        `select sample_basis from device_master where id = $1`, [wo.device_master_id]),
      /* 두께는 원재료가 정하므로 이 배치에서 나올 형명은 그 두께의 것뿐이다 (§3 ③) */
      finished: await db.rows<FinOpt>(
        `select i.id, i.code, i.name from item i
          where i.type = 'FIN' and i.is_active
            and ($1::text is null or right(i.code, 4) = $1)
          order by i.code`, [wo.thickness_band]),
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
            {/* 이 화면의 제목은 배치번호다. h1 로 적어 두면 읽어 주는 도구와
                점검 도구가 그것을 제목으로 안다 */}
            <h1 className="font-mono text-2xl font-bold text-ink">{wo.batch_no}</h1>
            <Tag tone="brand">{wo.item_name}</Tag>
            {/*
              * 배치 상태를 말한다 (4차 감사 E4).
              *
              * status 를 조회해 놓고 그리지 않았다. app/(work) 전체에
              * CANCELLED 를 다루는 곳이 없어서, **취소된 배치가 살아 있는 것과
              * 똑같이 보였다.** 목록은 상태로 거르는데 상세는 주소로 그대로
              * 열리므로 (뒤로가기 · 열어 둔 탭) 하루치를 기록하고 인쇄해 잠그는
              * 일이 가능했다.
              *
              * 막지 않는다 - 차단은 다섯 개뿐이다 (§1). 알려 주지 않은 것이
              * 문제였다.
              */}
            {wo.status !== 'IN_PROCESS' && wo.status !== 'ISSUED' && (
              <Tag tone={wo.status === 'CANCELLED' ? 'danger' : 'quiet'}>
                {WO_STATUS_LABEL[wo.status] ?? wo.status}
              </Tag>
            )}
          </div>

          {wo.status === 'CANCELLED' && (
            <p className="mt-3 rounded-md border border-danger/40 bg-danger-bg px-3 py-2
                          text-sm leading-relaxed text-ink">
              <b>이 배치는 취소되었습니다.</b> 여기에 적은 기록도 그대로 남고 지울 수
              없습니다. 취소된 배치에 기록할 일이 아니면 배치 목록으로 돌아가십시오.
            </p>
          )}
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
        cutOpId={d.cutOpId ?? null}
        finished={d.finished}
        sampleTiers={d.sampleTiers}
        sampleBasis={d.sampleBasis ?? null}
        band={wo.thickness_band}
        meId={user.id}
        lockedDays={d.lockedDays.map((r) => r.day_no)}
            today={todayKST()}
    />
    </div>
  );
}
