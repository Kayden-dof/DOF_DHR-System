'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

async function mgr() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    throw new Error('생산관리자 또는 시스템관리자만 자재를 관리할 수 있습니다');
  }
  return user;
}

const txt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const bump = () => {
  revalidatePath('/material');
  revalidatePath('/material/stock');
  revalidatePath('/material/orders');
  revalidatePath('/');
};

/* ---------------------------------------------------------------------------
   자재 입고 (수입검사 등록)

   S01  로트번호는 채번 규칙으로 만든다. 응용에서 조합하지 않는다
   S02  성적서 번호는 필수다. 공란도 공백 문자열도 저장되지 않는다

   구매 단위로 받은 수량을 환산 계수로 사용 단위에 맞춰 넣는다 (§4.2).
   재고 · 불출 · 단가는 전부 사용 단위 기준이다.
--------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
   숫자로 읽되, 숫자가 아니면 숫자가 아니라고 한다 (4차 감사 G3)

   Number('') 은 0 이고 Number('abc') 는 NaN 이다. 그 NaN 이 pg 로 가면
   'NaN' 문자열이 되고, **PostgreSQL numeric 은 NaN 을 받는다.**
   qty > 0 같은 검사는 NaN 에서 참이 아니므로 대개 걸리지만, 검사가 없는
   칸(단가 등)에는 그대로 들어간다. 그 뒤 합계가 전부 NaN 이 된다.

   여기서 막는다. 빈 값과 잘못된 값을 가려 말한다.
--------------------------------------------------------------------------- */
function num(v: FormDataEntryValue | null, label: string): number {
  const raw = String(v ?? '').trim().replace(/,/g, '');
  if (raw === '') throw new Error(`${label}을(를) 입력하십시오`);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${label}은(는) 숫자로 적으십시오`);
  return n;
}

/** 비워도 되는 숫자. 비면 null */
function numOrNull(v: FormDataEntryValue | null, label: string): number | null {
  const raw = String(v ?? '').trim();
  if (raw === '') return null;
  return num(v, label);
}

export async function receiveMaterial(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const itemId = String(form.get('item_id') ?? '');
    const purchaseQty = num(form.get('purchase_qty'), '구매 수량');

    const result = await withActor(me.id, async (db) => {
      const item = await db.one<{ code: string; name: string; conversion: string; usage_uom: string }>(
        `select code, name, conversion, usage_uom from item where id = $1`, [itemId]);
      if (!item) throw new Error('품목을 찾을 수 없습니다');

      const usageQty = purchaseQty * Number(item.conversion);
      const lotNo = await db.val<string>(`select next_number('MATERIAL_LOT', $1)`, [itemId]);

      await db.rows(
        `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no,
           purchase_order_id, coa_no, coa_date, received_at, registered_by,
           qty_received, qty_available, unit_price, expiry_date, location, thickness_band)
         values ($1,$2,$3,$4,$5,$6,$7::date,$8::timestamptz,$9,$10,$10,$11,$12::date,$13,$14)`,
        [itemId, lotNo,
         String(form.get('supplier_id') ?? ''),
         String(form.get('supplier_lot_no') ?? '').trim(),
         txt(form.get('purchase_order_id')),
         String(form.get('coa_no') ?? '').trim(),
         String(form.get('coa_date') ?? ''),
         String(form.get('received_at') ?? '') + 'T00:00:00+09:00',
         me.id, usageQty,
         numOrNull(form.get('unit_price'), '단가'),
         txt(form.get('expiry_date')),
         txt(form.get('location')),
         txt(form.get('thickness_band'))]);

      const po = txt(form.get('purchase_order_id'));
      if (po) {
        await db.rows(`update purchase_order set status = 'RECEIVED' where id = $1`, [po]);
      }
      return { lotNo, usageQty, uom: item.usage_uom, code: item.code };
    });

    bump();
    return {
      ok: true,
      message: `${result.code} 로트 ${result.lotNo} 등록. ` +
               `재고에 ${result.usageQty} ${result.uom} 들어갔습니다.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function createOrder(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const poNo = String(form.get('po_no') ?? '').trim();
    await withActor(me.id, (db) =>
      db.rows(
        `insert into purchase_order (po_no, item_id, supplier_id, qty, unit_price,
           ordered_at, expected_at, ordered_by)
         values ($1,$2,$3,$4,$5,$6::date,$7::date,$8)`,
        [poNo, String(form.get('item_id') ?? ''), String(form.get('supplier_id') ?? ''),
         num(form.get('qty'), '수량'),
         numOrNull(form.get('unit_price'), '단가'),
         String(form.get('ordered_at') ?? ''), txt(form.get('expected_at')), me.id]));
    bump();
    return { ok: true, message: `발주 ${poNo}를 등록했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function cancelOrder(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    await withActor(me.id, (db) =>
      db.rows(`update purchase_order set status='CANCELLED' where id=$1`,
              [String(form.get('id') ?? '')]));
    bump();
    return { ok: true, message: '발주를 취소했습니다. 기록은 남습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* 재고 증감. 반납 · 폐기 · 조정 (§4.7) */
export async function moveStock(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const type = String(form.get('type') ?? '');
    const raw = num(form.get('qty'), '수량');
    const qty = type === 'RETURN' ? Math.abs(raw)
              : type === 'ADJUSTMENT' ? raw
              : -Math.abs(raw);

    await withActor(me.id, (db) =>
      db.rows(
        `insert into stock_movement (material_lot_id, type, qty, work_order_id,
           reason_code, reason_detail, registered_by)
         values ($1,$2::movement_type,$3,$4,$5,$6,$7)`,
        [String(form.get('material_lot_id') ?? ''), type, qty,
         txt(form.get('work_order_id')),
         String(form.get('reason_code') ?? '기타'),
         txt(form.get('reason_detail')), me.id]));
    bump();
    return { ok: true, message: '재고 증감을 기록했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* 용액 제조. 원료 여러 종이 한 번에 차감된다 (§4.7) */
export async function makeSolution(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const lots: string[] = [];
    const qtys: number[] = [];
    for (const [k, v] of form.entries()) {
      const m = k.match(/^lot_(\d+)$/);
      if (!m || !String(v)) continue;
      const q = num(form.get(`qty_${m[1]}`), '수량');
      if (!q) continue;
      lots.push(String(v));
      qtys.push(q);
    }
    if (lots.length === 0) return { error: '차감할 원료와 수량을 한 줄 이상 입력하십시오' };

    const n = await withActor(me.id, (db) =>
      db.val<number>(`select make_solution($1::uuid[], $2::numeric[], $3, $4)`,
        [lots, qtys, String(form.get('name') ?? '').trim(), txt(form.get('note'))]));
    bump();
    return {
      ok: true,
      message: `용액 제조를 기록했습니다. 원료 ${n}종이 차감되었습니다. ` +
               `당일 제조 · 당일 폐기이므로 로트는 만들지 않습니다.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function suggestMinStock(): Promise<FormState> {
  try {
    const me = await mgr();
    const n = await withActor(me.id, (db) => db.val<number>(`select suggest_min_stock(90)`));
    revalidatePath('/material/stock');
    revalidatePath('/settings/items');
    return {
      ok: true,
      message: `${n}개 품목에 제안값을 계산했습니다. 최소 재고선은 덮어쓰지 않았습니다. ` +
               `품목 화면에서 근거를 보고 직접 입력하십시오.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function runExpiry(): Promise<FormState> {
  try {
    const me = await mgr();
    const n = await withActor(me.id, (db) => db.val<number>(`select expire_material_lots()`));
    bump();
    return { ok: true, message: `유효기한이 지난 자재 ${n}건을 기한 경과로 넘겼습니다. 수량은 그대로입니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
