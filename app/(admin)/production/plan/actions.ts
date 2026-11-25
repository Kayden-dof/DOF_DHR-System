'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   생산 > 일정의 저장 (0137). 배치 계획과 근무 달력은 계획이라 기록이 아니다 -
   고치고 지울 수 있고, 고친 것은 감사추적에 남는다.
--------------------------------------------------------------------------- */

const planner = () => requireRole(['SYS_ADMIN', 'PROD_MGR'], '생산관리자 또는 시스템관리자만 일정을 고칠 수 있습니다');

const done = () => { revalidatePath('/production/plan'); revalidatePath('/production'); };
const minOf = (v: FormDataEntryValue | null) => {
  const [h, m] = String(v ?? '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : NaN;
};

export async function savePlan(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await planner();
    const id = String(form.get('id') ?? '');
    const label = String(form.get('label') ?? '').trim();
    const dm = String(form.get('dm') ?? '');
    const startOn = String(form.get('start_on') ?? '');
    const startMin = minOf(form.get('start_time'));
    const wo = String(form.get('wo') ?? '') || null;
    const note = String(form.get('note') ?? '').trim().slice(0, 200);
    if (!label) return { error: '배치번호(예정)를 입력하십시오' };
    if (!dm) return { error: '제품표준서 판을 고르십시오' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startOn)) return { error: '시작일을 입력하십시오' };
    if (!(startMin >= 0 && startMin < 1440)) return { error: '시작 시각을 입력하십시오' };

    const newId = await withActor(user.id, async (db) => {
      if (id) {
        await db.rows(
          `update batch_plan set label = $2, device_master_id = $3::uuid, start_on = $4::date, start_min = $5,
                                 work_order_id = $6::uuid, note = $7
            where id = $1::uuid`, [id, label, dm, startOn, startMin, wo, note]);
        return id;
      }
      return db.val<string>(
        `insert into batch_plan (label, device_master_id, start_on, start_min, work_order_id, note, created_by)
         values ($1, $2::uuid, $3::date, $4, $5::uuid, $6, $7) returning id`,
        [label, dm, startOn, startMin, wo, note, user.id]);
    });
    done();
    return { ok: true, message: id ? '계획을 고쳤습니다' : '계획을 넣었습니다', href: `/production/plan?id=${newId}` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function deletePlan(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await planner();
    const id = String(form.get('id') ?? '');
    await withActor(user.id, (db) => db.rows(`delete from batch_plan where id = $1::uuid`, [id]));
    done();
    return { ok: true, message: '계획을 지웠습니다', href: '/production/plan' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function saveCalendar(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await planner();
    const workdays = form.getAll('wd').map(Number).filter((n) => n >= 0 && n <= 6);
    const ds = minOf(form.get('day_start')), de = minOf(form.get('day_end'));
    const holidays = String(form.get('holidays') ?? '').split(/[,\s]+/).filter(Boolean);
    if (!workdays.length) return { error: '근무 요일을 하나 이상 고르십시오' };
    if (!(ds >= 0 && de > ds && de <= 1440)) return { error: '근무 시각을 확인하십시오 (시작 < 끝)' };
    const badDay = holidays.find((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h));
    if (badDay) return { error: `공휴일은 2026-12-25 꼴로 적습니다 (${badDay})` };
    await withActor(user.id, (db) => db.rows(
      `update work_calendar set workdays = $1::int[], day_start = $2, day_end = $3, lunch = $4,
                                skip_off = $5, holidays = $6::date[], updated_by = $7, updated_at = now()`,
      [workdays, ds, de, form.get('lunch') === 'on', form.get('skip_off') === 'on', holidays, user.id]));
    done();
    revalidatePath('/settings/dmr/timeline');
    return { ok: true, message: '근무 달력을 저장했습니다' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
