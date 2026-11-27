/* ---------------------------------------------------------------------------
   배치 제안에 넣을 판의 값 읽기 (정밀 점검 E · 2026-11-27). 서버만 부른다.

   «주문에서 계획» (생산 › 일정) · 계획 올리기 (addPlansFromOrder) · 출고 마감일 제안
   (estimateShipBy) 이 같은 판에서 같은 값을 읽어 lib/order-plan.ts proposeBatches 에 넣는다.
   전에는 셋이 따로 읽어 출고 마감일 제안만 시료 구간을 형명이 하나일 때만 읽고, 시간표 없는 판의
   배치 간격 기본값을 몰라 같은 주문에 다른 배치 수 · 날짜를 냈다.

     tiers      판의 시료 구간 (sample_plan)
     steps      판의 공정 시간표 (없으면 null)
     startMin   첫 단계 시각
     defaultGap 시간표 없는 판의 배치 간격 기본값 - 그 제품 가장 최근 종료 지시의 첫 ~ 마지막 기록일 근무일 수
     sized      판에 유효 크기가 적혀 있는가
--------------------------------------------------------------------------- */
import type { Db } from './db';
import { tidySteps } from './timeline-db';
import { addDays, isOff, type Step, type WorkCalendar } from './timeline';
import { firstStepMin, type SampleTier } from './order-plan';

export interface DmPlanInputs {
  sized: boolean;
  tiers: SampleTier[];
  steps: Step[] | null;
  startMin: number;
  defaultGap: number | null;
}

export async function loadDmPlanInputs(db: Db, dmIds: string[], cal: WorkCalendar): Promise<Map<string, DmPlanInputs>> {
  const ids = [...new Set(dmIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db.rows<{
    dm: string; sized: boolean; tiers: { min: number; max: number | null; samples: number }[];
    gap_from: string | null; gap_to: string | null; steps: Step[] | null;
  }>(
    `select dm.id::text as dm, dm.usable_w is not null as sized,
            coalesce((select json_agg(json_build_object('min', sp.min_qty, 'max', sp.max_qty, 'samples', sp.sample_qty)
                                      order by sp.min_qty)
                        from sample_plan sp where sp.device_master_id = dm.id), '[]'::json) as tiers,
            to_char(g.f, 'YYYY-MM-DD') as gap_from, to_char(g.l, 'YYYY-MM-DD') as gap_to,
            (select t.steps from dmr_timeline t where t.device_master_id = dm.id) as steps
       from device_master dm
       left join lateral (
         select min(pr.work_date) as f, max(pr.work_date) as l from process_record pr
          where pr.work_order_id = (select wo.id from work_order wo
                                     where wo.status = 'DONE'
                                       and wo.device_master_id in (select d2.id from device_master d2 where d2.item_id = dm.item_id)
                                     order by wo.issued_at desc limit 1)) g on true
      where dm.id = any($1::uuid[])`, [ids]);
  const out = new Map<string, DmPlanInputs>();
  for (const r of rows) {
    const steps = r.steps?.length ? tidySteps(r.steps) : null;
    let defaultGap: number | null = null;
    if (r.gap_from && r.gap_to) {
      defaultGap = 0;
      for (let day = r.gap_from; day <= r.gap_to; day = addDays(day, 1)) if (!isOff(day, cal)) defaultGap++;
    }
    out.set(r.dm, { sized: r.sized, tiers: r.tiers, steps, startMin: firstStepMin(steps), defaultGap });
  }
  return out;
}
