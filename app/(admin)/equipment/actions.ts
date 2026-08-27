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
  // 생산 품목 셋업은 생산관리자의 일이다 (사용자 지시 2026-08-27).
  // 계정 · 채번 · 공급자는 여전히 시스템관리자만 만진다.
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) throw new Error('생산관리자 또는 시스템관리자만 설비를 관리할 수 있습니다');
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

    revalidatePath('/equipment');
    return { ok: true, message: id ? '설비를 고쳤습니다.' : '설비를 등록했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 밸리데이션 이력 등록.
 *
 * 서면 보고서가 근거다. 보고서 번호 없이는 등록되지 않는다 - 사용기간 이력이
 * 안정성 시험 보고서 번호를 요구하는 것과 같은 방식이다 (§4.2).
 * 이력은 고치거나 지우지 않는다. 잘못 넣었으면 바른 값을 다시 등록한다.
 */
export async function saveValidation(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const performedOn = String(form.get('performed_on') ?? '');
    const validUntil = String(form.get('valid_until') ?? '');
    const reportNo = txt(form.get('report_no'));
    if (!reportNo) return { error: '밸리데이션 보고서 번호를 입력하십시오' };

    await withActor(me.id, (db) =>
      db.rows(
        `insert into equipment_validation
           (equipment_id, performed_on, valid_until, report_no, note, registered_by)
         values ($1,$2::date,$3::date,$4,$5,$6)`,
        [String(form.get('equipment_id') ?? ''), performedOn, validUntil,
         reportNo, txt(form.get('note')), me.id]));

    revalidatePath('/equipment');
    return { ok: true, message: `밸리데이션을 등록했습니다. 만료 ${validUntil}` };
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

    revalidatePath('/equipment');
    // 같은 연결을 제품표준서 작업대 두 화면도 보여 준다
    revalidatePath('/production/setup');
    revalidatePath('/settings/dmr');
    return { ok: true, message: on ? '공정에 걸었습니다.' : '공정에서 뗐습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
