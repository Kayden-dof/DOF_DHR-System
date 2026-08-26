'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

async function admin() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) throw new Error('시스템관리자만 제품표준서를 관리할 수 있습니다');
  return user;
}

const path = (dm?: string) => {
  revalidatePath('/settings/dmr');
  if (dm) revalidatePath(`/settings/dmr/${dm}`);
};

export async function createDeviceMaster(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const revision = String(form.get('revision') ?? '').trim();
    await withActor(me.id, (db) =>
      db.rows(
        `insert into device_master (item_id, revision, status, effective_from)
         values ($1,$2,'DRAFT',$3::date)`,
        [String(form.get('item_id') ?? ''), revision,
         String(form.get('effective_from') ?? '') || null]));
    path();
    return { ok: true, message: `${revision} 개정을 만들었습니다. 공정과 자재 구성표를 넣으십시오.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 구조화 입력분을 서면 제품표준서와 대조했다는 확인.
 * 판정이 아니라 "옮겨 적은 것이 맞다"는 기록이다 (§4.3 verified_by).
 */
export async function verifyDeviceMaster(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = String(form.get('id') ?? '');
    await withActor(me.id, (db) =>
      db.rows(
        `update device_master set verified_by = $2, verified_at = now(), status = 'ACTIVE'
          where id = $1`, [id, me.id]));
    path(id);
    return {
      ok: true,
      message: '서면 대조를 확인했습니다. 이제 작업지시 발행에서 고를 수 있습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function addOperation(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('device_master_id') ?? '');
    const code = String(form.get('code') ?? '').trim();
    await withActor(me.id, (db) =>
      db.rows(
        `insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
         values ($1,$2,$3,$4,$5)`,
        [dm, Number(form.get('seq') ?? 0), code,
         String(form.get('name') ?? '').trim(),
         form.get('after_cutting') === 'on']));
    path(dm);
    return { ok: true, message: `${code} 공정을 추가했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function addBom(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('device_master_id') ?? '');
    const basis = String(form.get('basis') ?? 'SHEET_TIER');
    const per = String(form.get('qty_per_unit') ?? '').trim();

    if (basis === 'PER_UNIT' && per === '') {
      return { error: '제품 개수 기준은 1개당 소요량이 필요합니다' };
    }

    await withActor(me.id, (db) =>
      db.rows(
        `insert into dmr_bom (operation_id, component_item_id, basis, qty_per_unit)
         values ($1,$2,$3::qty_basis,$4)`,
        [String(form.get('operation_id') ?? ''), String(form.get('component_item_id') ?? ''),
         basis, basis === 'PER_UNIT' ? Number(per) : null]));
    path(dm);
    return {
      ok: true,
      message: basis === 'SHEET_TIER'
        ? '자재를 추가했습니다. 장입 구간별 소요량을 이어서 넣으십시오.'
        : '자재를 추가했습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function addTier(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const dm = String(form.get('device_master_id') ?? '');
    const max = String(form.get('max_sheets') ?? '').trim();
    await withActor(me.id, (db) =>
      db.rows(
        `insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
         values ($1,$2,$3,$4)`,
        [String(form.get('dmr_bom_id') ?? ''), Number(form.get('min_sheets') ?? 1),
         max === '' ? null : Number(max), Number(form.get('qty') ?? 1)]));
    path(dm);
    return { ok: true, message: '장입 구간을 추가했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
