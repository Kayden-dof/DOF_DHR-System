'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import { cleanSteps } from '@/lib/timeline';
import type { FormState } from '@/lib/forms';

/**
 * 공정 시간표 저장 (0137).
 *
 * 화면이 들고 있던 한 벌을 통째로 바꾼다 - 막대를 끌고 늘리는 동안은 화면 안에서만
 * 바뀌고, «저장» 을 눌러야 DB 에 간다. 고친 것은 감사추적에 이전 값과 함께 남는다.
 * 계획이라 서면 대조 확인은 풀리지 않는다.
 */
export async function saveTimeline(input: { dm: string; steps: unknown; basis: string }): Promise<FormState> {
  try {
    const user = await requireUser();
    if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
      return { error: '생산관리자 또는 시스템관리자만 공정 시간표를 고칠 수 있습니다' };
    }
    const saved = await withActor(user.id, async (db) => {
      const seqs = (await db.rows<{ seq: string }>(
        `select lpad(seq::text, 2, '0') as seq from dmr_operation where device_master_id::text = $1`,
        [input.dm])).map((r) => r.seq);
      if (!seqs.length) return { error: '공정이 없는 제품표준서입니다' } as FormState;
      const c = cleanSteps(input.steps, seqs);
      if ('error' in c) return { error: c.error } as FormState;
      await db.rows(
        `insert into dmr_timeline (device_master_id, steps, basis, updated_by, updated_at)
         values ($1::uuid, $2::jsonb, $3, $4, now())
         on conflict (device_master_id) do update
           set steps = excluded.steps, basis = excluded.basis,
               updated_by = excluded.updated_by, updated_at = now()`,
        [input.dm, JSON.stringify(c.steps), input.basis.trim().slice(0, 200), user.id]);
      return { ok: true, message: `저장했습니다 (작업 ${c.steps.length}개)` } as FormState;
    });
    revalidatePath('/settings/dmr/timeline');
    revalidatePath('/production/plan');
    return saved;
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
