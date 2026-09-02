'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

async function admin() {
  const user = await requireUser();
  // 생산 품목 셋업은 생산관리자의 일이다 (사용자 지시 2026-08-27).
  // 계정 · 채번 · 공급자는 여전히 시스템관리자만 만진다.
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) throw new Error('생산관리자 또는 시스템관리자만 기준정보를 관리할 수 있습니다');
  return user;
}

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : Number(s);
};

export async function createItem(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const code = String(form.get('code') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();

    await withActor(me.id, (db) =>
      db.rows(
        `insert into item (code, name, type, purchase_uom, usage_uom, conversion,
                           min_stock, lead_days, shelf_life_months)
         values ($1,$2,$3::item_type,$4,$5,$6,$7,$8,$9)`,
        [code, name,
         String(form.get('type') ?? 'REAGENT'),
         String(form.get('purchase_uom') ?? '').trim(),
         String(form.get('usage_uom') ?? '').trim(),
         num(form.get('conversion')) ?? 1,
         num(form.get('min_stock')),
         num(form.get('lead_days')),
         num(form.get('shelf_life_months'))],
      ),
    );
    revalidatePath('/settings/items');
    return { ok: true, message: `${code} ${name} 품목을 등록했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function updateItem(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = String(form.get('id') ?? '');
    await withActor(me.id, (db) =>
      db.rows(
        `update item set name = $2, min_stock = $3, lead_days = $4,
                         shelf_life_months = $5, is_active = $6
          where id = $1`,
        [id, String(form.get('name') ?? '').trim(),
         num(form.get('min_stock')), num(form.get('lead_days')),
         num(form.get('shelf_life_months')), form.get('is_active') === 'on'],
      ),
    );
    revalidatePath('/settings/items');
    return { ok: true, message: '품목을 수정했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   완제품 형명 생성 (§4.2)

   "62개를 손으로 등록하지 말 것." 크기와 두께 구간을 받아 조합으로 만든다.
   크기·두께 목록은 제품표준서에서 오는 값이라 코드에 박지 않는다.
--------------------------------------------------------------------------- */
export interface GenResult extends FormState {
  rows?: { item_code: string; item_name: string; was_created: boolean }[];
}

const codes = (v: FormDataEntryValue | null) =>
  String(v ?? '')
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export async function generateFinished(_p: GenResult, form: FormData): Promise<GenResult> {
  try {
    const me = await admin();
    const sizes = codes(form.get('sizes'));
    const bands = codes(form.get('bands'));
    const exclude = codes(form.get('exclude'));

    if (sizes.length === 0 || bands.length === 0) {
      return { error: '크기와 두께 구간을 각각 하나 이상 입력하십시오' };
    }

    /*
     * 앞머리에 기본값을 두지 않는다 (5차 감사 B4). DX2401 은 이 제조소의
     * 품목 코드이지 프로그램의 성질이 아니다 (§2.0).
     */
    const prefix = String(form.get('prefix') ?? '').trim();
    if (!prefix) return { error: '이름 앞머리를 적으십시오' };

    const scheme = String(form.get('scheme_id') ?? '').trim();
    if (!scheme) return { error: '어느 형명 체계로 만들지 고르십시오' };

    const rows = await withActor(me.id, (db) =>
      db.rows<{ item_code: string; item_name: string; was_created: boolean }>(
        `select * from generate_finished_items($1::text[], $2::text[], $3::text[], $4, $5, $6)`,
        [sizes, bands, exclude, prefix,
         Number(form.get('shelf_months') ?? 12) || 12, scheme],
      ),
    );

    const made = rows.filter((r) => r.was_created).length;
    revalidatePath('/settings/items');
    return {
      ok: true,
      rows,
      message: `조합 ${rows.length}종 중 ${made}종을 새로 등록했습니다. ` +
               `나머지 ${rows.length - made}종은 이미 있어 건드리지 않았습니다.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
