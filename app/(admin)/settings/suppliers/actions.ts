'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

const admin = () => requireRole(['SYS_ADMIN'], '시스템관리자만 공급자를 관리할 수 있습니다');

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
            where id=$1`, [id, ...fields]),
        /*
         * 왜 바꿨는가를 함께 싣는다 (0061 · 3차 검수 결함 7).
         *
         * 공급자 상태와 승인기한은 아래로 흐르는 값이다 - 미승인 공급자는
         * 작업 지시 발행 화면에 경고로 뜬다. 나중에 "이 배치는 왜 미승인
         * 공급자 자재로 나갔나" 를 물었을 때, 언제 무엇이 바뀌었는지만으로는
         * 답이 안 된다.
         *
         * 등록에는 묻지 않는다. 만든 것 자체가 사유다.
         */
        { reason: String(form.get('change_reason') ?? '').trim() || undefined });
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

/*
 * 목록에서 바로 승인 (사용자 2026-11-25 «발주업체 승인하는 버튼 어디있는데.. 왤케 찾기가 힘드냐..» ·
 * «승인 단추는 두는데, 승인을 생산 관리자도 할수 있게 열어줘»). 전에는 줄의 «수정» → 창 안의 «승인 상태» 를
 * 골라 저장해야 했고, 시스템관리자만 됐다. 승인만 바꾸고 다른 칸은 그대로 둔다. 되돌리기(미승인 · 정지)는
 * 지금처럼 «수정» 에서 시스템관리자가 한다.
 */
export async function approveSupplier(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await requireRole(['SYS_ADMIN', 'PROD_MGR'], '공급자 승인은 생산관리자 또는 시스템관리자가 합니다');
    const id = String(form.get('id') ?? '');
    const name = await withActor(me.id, (db) =>
      db.val<string>(
        `update supplier set status = 'APPROVED' where id = $1 and status <> 'APPROVED' returning name`, [id]),
      { reason: '공급자 승인 (목록에서)' });
    revalidatePath('/settings/suppliers');
    revalidatePath('/material/orders');
    revalidatePath('/material');
    return name ? { ok: true, message: `${name} 를 승인했습니다.` } : { error: '이미 승인된 공급자입니다' };
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
