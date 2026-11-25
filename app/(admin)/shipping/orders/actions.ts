'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage, type Db } from '@/lib/db';
import { requireRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   수주 (0159 · 사용자 2026-11-25 «DHR 은 주문 장부와 출고 연결에만 집중하면 됨.»)

   거래처 · 주문서 · 형명 줄을 적는다. 남은 수량 · 상태는 저장하지 않고 출고에서 센다
   (so_line_left · so_status). 지우지 않는다 - 잘못 받은 주문은 사유와 함께 취소한다.
--------------------------------------------------------------------------- */

const mgr = () => requireRole(['SYS_ADMIN', 'PROD_MGR'], '생산관리자 또는 시스템관리자만 수주를 다룰 수 있습니다');

const txt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const bump = () => {
  revalidatePath('/shipping/orders');
  revalidatePath('/shipping/ship');
};

/** 폼의 새 형명 줄 (line_item_<n> · line_qty_<n>). 형명을 고르지 않은 줄은 건너뛴다 */
function newLines(form: FormData): { item: string; qty: number }[] {
  const out: { item: string; qty: number }[] = [];
  for (const [k, v] of form.entries()) {
    const m = k.match(/^line_item_(\d+)$/);
    if (!m || String(v) === '') continue;
    const qty = Number(form.get(`line_qty_${m[1]}`) ?? 0);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('형명 줄의 수량은 1 이상의 정수로 적으십시오');
    out.push({ item: String(v), qty });
  }
  return out;
}

async function addLines(db: Db, orderId: string, lines: { item: string; qty: number }[]) {
  let seq = await db.val<number>(
    `select coalesce(max(seq), 0)::int from sales_order_line where sales_order_id = $1`, [orderId]) ?? 0;
  for (const l of lines) {
    seq += 1;
    await db.rows(
      `insert into sales_order_line (sales_order_id, item_id, qty, seq) values ($1,$2,$3,$4)`,
      [orderId, l.item, l.qty, seq]);
  }
}

export async function createOrder(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const po = String(form.get('customer_po_no') ?? '').trim();
    if (!po) return { error: '고객 발주번호를 적으십시오' };
    const lines = newLines(form);
    if (lines.length === 0) return { error: '형명 줄을 하나 이상 적으십시오' };
    let customerId = String(form.get('customer_id') ?? '');
    const newName = txt(form.get('new_customer_name'));
    if (customerId === 'new' && !newName) return { error: '새 거래처의 상호를 적으십시오' };
    if (!customerId) return { error: '거래처를 고르십시오' };

    await withActor(me.id, async (db) => {
      if (customerId === 'new') {
        customerId = (await db.val<string>(
          `insert into customer (name, biz_no, created_by) values ($1,$2,$3) returning id`,
          [newName, txt(form.get('new_biz_no')), me.id]))!;
      }
      const id = await db.val<string>(
        `insert into sales_order (customer_id, customer_po_no, ordered_on, ship_to, due_on, note, created_by)
         values ($1,$2,$3::date,$4,$5::date,$6,$7) returning id`,
        [customerId, po, String(form.get('ordered_on') ?? ''), txt(form.get('ship_to')),
         txt(form.get('due_on')), String(form.get('note') ?? '').trim(), me.id]);
      await addLines(db, id!, lines);
    });
    bump();
    return { ok: true, message: `주문 ${po}를 등록했습니다 (형명 ${lines.length}줄).` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function updateOrder(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    const po = String(form.get('customer_po_no') ?? '').trim();
    if (!po) return { error: '고객 발주번호를 적으십시오' };
    const lines = newLines(form);
    await withActor(me.id, async (db) => {
      const n = await db.rows(
        `update sales_order set customer_po_no = $2, ordered_on = $3::date, ship_to = $4, due_on = $5::date, note = $6
          where id = $1 and cancelled_at is null returning id`,
        [id, po, String(form.get('ordered_on') ?? ''), txt(form.get('ship_to')),
         txt(form.get('due_on')), String(form.get('note') ?? '').trim()]);
      if (n.length === 0) throw new Error('취소된 주문은 고칠 수 없습니다');
      for (const [k, v] of form.entries()) {
        const m = k.match(/^qty_(.+)$/);
        if (!m) continue;
        const qty = Number(v);
        if (!Number.isInteger(qty) || qty <= 0) throw new Error('주문 수량은 1 이상의 정수로 적으십시오');
        await db.rows(
          `update sales_order_line set qty = $3
            where id = $1 and sales_order_id = $2 and qty <> $3 and cancelled_at is null`, [m[1], id, qty]);
      }
      await addLines(db, id, lines);
    });
    bump();
    return { ok: true, message: `주문 ${po}를 고쳤습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function cancelOrder(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const reason = String(form.get('reason') ?? '').trim();
    if (!reason) return { error: '취소 사유를 적으십시오' };
    await withActor(me.id, (db) => db.rows(
      `update sales_order set cancelled_at = now(), cancelled_by = $2, cancel_reason = $3
        where id = $1 and cancelled_at is null`,
      [String(form.get('id') ?? ''), me.id, reason]), { reason });
    bump();
    return { ok: true, message: '주문을 취소했습니다. 이미 나간 출고는 그대로 남습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function cancelLine(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const reason = String(form.get('reason') ?? '').trim();
    if (!reason) return { error: '취소 사유를 적으십시오' };
    await withActor(me.id, (db) => db.rows(
      `update sales_order_line set cancelled_at = now(), cancel_reason = $2
        where id = $1 and cancelled_at is null`,
      [String(form.get('id') ?? ''), reason]), { reason });
    bump();
    return { ok: true, message: '형명 줄을 취소했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function saveCustomer(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const name = String(form.get('name') ?? '').trim();
    if (!name) return { error: '상호를 적으십시오' };
    const id = txt(form.get('id'));
    const vals = [name, txt(form.get('biz_no')), txt(form.get('contact_name')), txt(form.get('contact_phone')),
                  txt(form.get('contact_email')), txt(form.get('address')), String(form.get('note') ?? '').trim()];
    await withActor(me.id, (db) => id
      ? db.rows(
          `update customer set name = $2, biz_no = $3, contact_name = $4, contact_phone = $5,
                  contact_email = $6, address = $7, note = $8, is_active = $9
            where id = $1`, [id, ...vals, form.get('is_active') === 'on'])
      : db.rows(
          `insert into customer (name, biz_no, contact_name, contact_phone, contact_email, address, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`, [...vals, me.id]));
    bump();
    return { ok: true, message: id ? `거래처 ${name}을(를) 고쳤습니다.` : `거래처 ${name}을(를) 등록했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   작업 지시에 주문 줄 걸기 · 떼기 (0159 · 사용자 2026-11-25 «작업지시서를 주문줄에 걸고 … 권고»)

   발행 때 고르지 않았거나 나중에 주문이 들어온 배치를 배치 화면에서 잇는다. 형명 · 취소 여부는 DB 가
   본다 (trg_wo_so_line_rules). 떼기는 사유를 적고 되돌리지 않는다.
--------------------------------------------------------------------------- */
export async function linkWorkOrderLine(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const wo = String(form.get('work_order_id') ?? '');
    const line = String(form.get('sales_order_line_id') ?? '');
    if (!line) return { error: '걸 주문 줄을 고르십시오' };
    await withActor(me.id, (db) => db.rows(
      `insert into work_order_so_line (work_order_id, sales_order_line_id, linked_by) values ($1,$2,$3)`,
      [wo, line, me.id]));
    revalidatePath(`/production/${wo}`);
    bump();
    return { ok: true, message: '주문 줄을 걸었습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function unlinkWorkOrderLine(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const reason = String(form.get('reason') ?? '').trim();
    if (!reason) return { error: '떼는 사유를 적으십시오' };
    const wo = String(form.get('work_order_id') ?? '');
    await withActor(me.id, (db) => db.rows(
      `update work_order_so_line set unlinked_at = now(), unlinked_by = $2, unlink_reason = $3
        where id = $1 and unlinked_at is null`,
      [String(form.get('id') ?? ''), me.id, reason]), { reason });
    revalidatePath(`/production/${wo}`);
    bump();
    return { ok: true, message: '주문 줄을 뗐습니다. 이미 나간 출고는 그대로입니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
