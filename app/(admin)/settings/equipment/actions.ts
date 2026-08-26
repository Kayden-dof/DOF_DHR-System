'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   설비 기준정보

   설비는 지우지 않는다. 내려도 이미 적힌 기록의 코드는 그대로 남는다 - 그 기록은
   그때 그 설비로 작업한 사실이다. 내리면 현장 화면 타일에서만 빠진다.
--------------------------------------------------------------------------- */

async function admin() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) throw new Error('시스템관리자만 설비를 관리할 수 있습니다');
  return user;
}

const txt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function saveEquipment(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = txt(form.get('id'));
    const name = txt(form.get('name'));
    const note = txt(form.get('note'));

    await withActor(me.id, async (db) => {
      if (id) {
        await db.rows(
          `update equipment set name = $2, note = $3, is_active = $4 where id = $1`,
          [id, name, note, form.get('is_active') === 'on']);
      } else {
        await db.rows(
          `insert into equipment (code, name, note) values ($1, $2, $3)`,
          [txt(form.get('code')), name, note]);
      }
    });

    revalidatePath('/settings/equipment');
    return { ok: true, message: id ? '설비를 고쳤습니다.' : '설비를 등록했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 공정에 설비를 걸거나 뗀다.
 *
 * 떼도 지우지 않는다 (§10). 앞으로 그 공정 화면에 그 타일이 나오지 않을 뿐이고,
 * 뗀 사실은 감사추적에 남는다. 이미 적힌 기록의 설비 코드는 건드리지 않는다 -
 * 그 기록은 그때 그 설비로 작업한 사실이다.
 */
export async function linkOperation(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const eq = String(form.get('equipment_id') ?? '');
    const op = String(form.get('operation_id') ?? '');
    const on = form.get('on') === '1';

    await withActor(me.id, (db) =>
      db.rows(
        `insert into operation_equipment (operation_id, equipment_id, is_active)
         values ($1, $2, $3)
         on conflict (operation_id, equipment_id)
           do update set is_active = excluded.is_active`, [op, eq, on]));

    revalidatePath('/settings/equipment');
    return { ok: true, message: on ? '공정에 걸었습니다.' : '공정에서 뗐습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
