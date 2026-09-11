'use server';

import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';

export interface RequirementRow {
  operation_code: string;
  operation_name: string;
  item_code: string;
  item_name: string;
  usage_uom: string;
  basis: string;
  required: string | null;
  /* ------------------------------------------------------------------------
     발행 전에 "있느냐" 를 함께 본다 (사용자 지시 2026-09-11)

     전에는 소요량만 보여 주었다. 그래서 시약이 모자란 것을 **3일차 아침에
     현장이** 알았다 - 발행할 때 알았으면 그날 발주했을 일이다. 같은 숫자를
     현장 준비 카드는 이미 보여 주고 있었는데 발행 화면에만 없었다.

     막지 않는다 (§2 "경고만"). 모자라도 발행은 된다 - 오늘 들어올 수도 있고,
     시스템이 재고를 판정할 자리가 아니다.
     ------------------------------------------------------------------------ */
  /** 지금 쓸 수 있는 재고 (사용 단위 합계) */
  on_hand: string;
  /** 그중 가장 이른 유효기한. 없으면 null */
  soonest: string | null;
  /**
   * 이 공정에 닿을 무렵. 오늘 + (보통 n일차 - 1).
   *
   * 재고 수량만으로는 "2통 있음" 이 안심을 준다. 그 2통이 6일차 전에 만료되면
   * 없는 것과 같은데 숫자로는 보이지 않는다.
   */
  use_by: string;
}

export interface IssuePreview {
  warnings?: { kind: string; detail: string }[];
  requirements?: RequirementRow[];
  error?: string;
}

/**
 * 발행 전 미리보기. 경고와 소요량을 함께 돌려준다.
 * 경고는 표시만 하고 발행을 막지 않는다 (§2 "경고만").
 * 소요량은 자재 구성표를 그대로 해석한 값이며 지시서에 인쇄된다.
 *
 * units 는 예정 형명 수량의 합이다. 포장재처럼 제품 개수에 비례하는 자재는
 * 이 값이 있어야 미리 계산된다. 0 이면 "재단 후 확정"으로 남는다.
 */
export async function previewIssue(
  deviceMasterId: string, materialLotId: string, sheets: number, units = 0,
): Promise<IssuePreview> {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) return { error: '권한이 없습니다' };
  if (!deviceMasterId || !materialLotId) return {};

  try {
    return await withActor(user.id, async (db) => ({
      /*
       * 자재 경고에 설비 경고를 잇는다. 이 배치의 공정에 걸린 설비 중
       * 오늘 기준 밸리데이션이 없거나 지난 것을 발행 전에 미리 알린다
       * (사용자 지시 - 작업 들어가서 작업자가 알기 전에). 표시만 하고
       * 발행을 막지 않는다 (§2).
       */
      warnings: await db.rows<{ kind: string; detail: string }>(
        `select kind, detail from work_order_warnings($1, $2, $3)
         union all
         select '설비'::text,
                format('%s %s (%s): %s', e.code, e.name, o.name,
                  case when v.valid_until is null then '밸리데이션 기록 없음'
                       else '밸리데이션 기한 경과 (만료 ' || to_char(v.valid_until, 'YYYY-MM-DD') || ')'
                  end)
           from dmr_operation o
           join operation_equipment oe on oe.operation_id = o.id and oe.is_active
           join equipment e on e.id = oe.equipment_id and e.is_active
           /*
            * 종류마다 따로 세고 그중 가장 이른 만료를 본다 (GMP 점검 F4).
            * 섞어서 max 를 잡으면 **저울 교정 하나가 만료된 밸리데이션을 덮는다.**
            * 이력이 아예 없으면 null 이 되어 아래 조건이 잡는다.
            */
           left join lateral (
             select min(m.valid_until) as valid_until
               from (select kind, max(valid_until) as valid_until
                       from equipment_validation
                      where equipment_id = e.id
                      group by kind) m
           ) v on true
          where o.device_master_id = $3
            and (v.valid_until is null
                 or v.valid_until < (timezone('Asia/Seoul', now()))::date)`,
        [materialLotId, sheets, deviceMasterId]),
      requirements: await db.rows<RequirementRow>(
        `select o.code as operation_code, o.name as operation_name,
                r.item_code, r.item_name, r.usage_uom, r.basis::text as basis, r.required,
                st.on_hand::text as on_hand, st.soonest::text as soonest,
                ((timezone('Asia/Seoul', now()))::date
                   + (coalesce(o.typical_day, 1) - 1))::text as use_by
           from dmr_operation o
           cross join lateral operation_requirements(o.id, $2, $3) r
           left join lateral (
             /* 품목 코드로 잇는다 - operation_requirements 가 코드를 돌려준다 */
             select coalesce(sum(ml.qty_available), 0) as on_hand,
                    min(ml.expiry_date)               as soonest
               from material_lot ml
               join item i on i.id = ml.item_id
              where i.code = r.item_code
                and ml.status = 'AVAILABLE' and ml.qty_available > 0
           ) st on true
          where o.device_master_id = $1
          order by o.seq, r.item_code`,
        [deviceMasterId, sheets, units]),
    }));
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
