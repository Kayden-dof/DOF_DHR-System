'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

async function admin() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) throw new Error('시스템관리자만 공급자를 관리할 수 있습니다');
  return user;
}

const txt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function saveSupplier(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = txt(form.get('id'));
    const fields = [
      txt(form.get('name')), String(form.get('status') ?? 'PENDING'),
      txt(form.get('approved_until')), txt(form.get('contact_name')),
      txt(form.get('contact_phone')), txt(form.get('contact_email')),
      txt(form.get('biz_no')), txt(form.get('address')),
      txt(form.get('payment_terms')), txt(form.get('note')),
    ];

    if (id) {
      await withActor(me.id, (db) =>
        db.rows(
          `update supplier set name=$2, status=$3, approved_until=$4::date, contact_name=$5,
                  contact_phone=$6, contact_email=$7, biz_no=$8, address=$9,
                  payment_terms=$10, note=$11
            where id=$1`, [id, ...fields]));
      revalidatePath('/settings/suppliers');
      return { ok: true, message: '공급자 정보를 수정했습니다.' };
    }

    const code = String(form.get('code') ?? '').trim();
    await withActor(me.id, (db) =>
      db.rows(
        `insert into supplier (code, name, status, approved_until, contact_name, contact_phone,
                contact_email, biz_no, address, payment_terms, note)
         values ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11)`, [code, ...fields]));
    revalidatePath('/settings/suppliers');
    return { ok: true, message: `${code} 공급자를 등록했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function savePrice(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const item = String(form.get('item_id') ?? '');
    const supplier = String(form.get('supplier_id') ?? '');
    const price = Number(form.get('price') ?? 0);
    const from = String(form.get('effective_from') ?? '');

    await withActor(me.id, async (db) => {
      await db.rows(
        `insert into price_history (item_id, supplier_id, price, effective_from, registered_by)
         values ($1,$2,$3,$4::date,$5)`, [item, supplier, price, from, me.id]);
      await db.rows(
        `insert into item_supplier (item_id, supplier_id, current_price)
         values ($1,$2,$3)
         on conflict (item_id, supplier_id) do update set current_price = excluded.current_price`,
        [item, supplier, price]);
    });

    revalidatePath('/settings/suppliers');
    return {
      ok: true,
      message: '단가를 등록했습니다. 이전 단가는 이력으로 남고 지워지지 않습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function saveShelfLife(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    await withActor(me.id, (db) =>
      db.rows(
        `insert into shelf_life_history (item_id, months, effective_from, study_report_no,
                study_date, approved_by)
         values ($1,$2,$3::date,$4,$5::date,$6)`,
        [String(form.get('item_id') ?? ''), Number(form.get('months') ?? 0),
         String(form.get('effective_from') ?? ''),
         String(form.get('study_report_no') ?? '').trim(),
         txt(form.get('study_date')), me.id]));
    revalidatePath('/settings/suppliers');
    return {
      ok: true,
      message: '사용기간을 등록했습니다. 이미 만들어진 제품 로트의 유효기한은 바뀌지 않습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
