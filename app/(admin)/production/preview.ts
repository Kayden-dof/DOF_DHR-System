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
      warnings: await db.rows<{ kind: string; detail: string }>(
        `select kind, detail from work_order_warnings($1, $2)`, [materialLotId, sheets]),
      requirements: await db.rows<RequirementRow>(
        `select o.code as operation_code, o.name as operation_name,
                r.item_code, r.item_name, r.usage_uom, r.basis::text as basis, r.required
           from dmr_operation o
           cross join lateral operation_requirements(o.id, $2, $3) r
          where o.device_master_id = $1
          order by o.seq, r.item_code`,
        [deviceMasterId, sheets, units]),
    }));
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
