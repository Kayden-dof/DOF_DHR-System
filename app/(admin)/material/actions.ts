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

/* ---------------------------------------------------------------------------
   자재 로트의 오기를 고친다 (5차 감사 A1 · 사용자 결정 2026-09-02)

   입고 등록이 유일한 입구였고 출구가 없었다. `material_lot_coa_once` 가 여덟
   열을 잠그고 화면에도 고치는 자리가 없어, 한 글자를 틀리면 영구히 되돌릴 수
   없었다. 현장의 유일한 대처는 같은 자재를 다른 로트번호로 다시 등록하는
   것이었고, 그러면 재고가 둘로 갈라진다.

   여기서 손대지 않는 것 - 사내 로트번호 · 품목 · 공급자 · 입고 수량.
   DB 도 같은 넷을 막는다 (0090). 응용에서만 막은 건 검증이 아니다 (§1-2).

   판정하지 않는다. 무엇이 옳은 값인지 정하지 않고 고쳐 쓸 자리를 낼 뿐이며,
   왜 고쳤는지와 이전 값은 감사추적에 남는다 (§5 · audit_log.reason).
--------------------------------------------------------------------------- */
export async function amendMaterialLot(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    const coa = String(form.get('coa_no') ?? '').trim();
    const coaDate = String(form.get('coa_date') ?? '').trim();
    const supplierLot = String(form.get('supplier_lot_no') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim();

    if (!id) return { error: '어느 로트인지 알 수 없습니다' };
    if (!coa) return { error: '성적서 번호는 비울 수 없습니다 (S02)' };
    if (!coaDate) return { error: '성적서 일자를 입력하십시오' };
    if (!supplierLot) return { error: '공급자 로트번호를 입력하십시오' };
    if (!reason) return { error: '왜 고치는지 적으십시오' };

    const lotNo = await withActor(me.id, async (db) => {
      await db.rows(
        /*
         * 합격판정일자도 고칠 수 있게 둔다. 로트번호는 이미 굳어 있어
         * (material_lot_coa_once) 고쳐도 번호는 그대로다 - 그래도 **적힌
         * 날짜는 참이어야 한다.** 틀린 채로 두면 종이와 시스템이 갈라진다.
         * 바뀐 사실과 이전 값은 감사추적에 남는다 (§1).
         */
        `update material_lot
            set coa_no = $2, coa_date = $3::date, supplier_lot_no = $4,
                thickness_band = $5, expiry_date = $6::date,
                location = $7, unit_price = $8, qc_passed_on = $9::date
          where id = $1`,
        [id, coa, coaDate, supplierLot,
         txt(form.get('thickness_band')),
         txt(form.get('expiry_date')),
         txt(form.get('location')),
         numOrNull(form.get('unit_price'), '단가'),
         txt(form.get('qc_passed_on'))]);
      return db.val<string>(`select lot_no from material_lot where id = $1`, [id]);
    }, { reason: `자재 로트 정정 · ${reason}` });

    bump();
    return {
      ok: true,
      message: `${lotNo} 을(를) 고쳤습니다. 이미 인쇄된 자재 라벨은 바뀌지 않습니다.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
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

      /*
       * 로트번호는 **합격판정일자**로 만든다 (0097 · 사용자 결정 2026-09-07).
       * 사내 번호 체계가 `R{YYMMDD}-{일련}` 이고 그 날짜가 서면 합격 판정의
       * 날짜다. 등록하는 날이 아니다 - 판정 서류가 며칠 늦게 와도 번호는
       * 판정일로 서야 한다.
       *
       * 시스템이 판정하지 않는다 (§1). 품질팀이 서면으로 받은 결과의 날짜를
       * 옮겨 적을 뿐이고, 그 값이 번호에 쓰인다.
       */
      const qcOn = String(form.get('qc_passed_on') ?? '').trim();
      if (!qcOn) throw new Error('합격판정일자를 입력하십시오. 로트번호가 이 날짜로 만들어집니다');

      const lotNo = await db.val<string>(
        `select next_number('MATERIAL_LOT', $1, $2::date)`, [itemId, qcOn]);

      await db.rows(
        `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no,
           purchase_order_id, coa_no, coa_date, received_at, registered_by,
           qty_received, qty_available, unit_price, expiry_date, location, thickness_band,
           qc_passed_on)
         values ($1,$2,$3,$4,$5,$6,$7::date,$8::timestamptz,$9,$10,$10,$11,$12::date,$13,$14,
                 $15::date)`,
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
         txt(form.get('thickness_band')),
         qcOn]);

      /*
       * 발주 상태는 여기서 안 건드린다 (0102).
       *
       * 전에는 수량과 상관없이 RECEIVED 로 넘겼다. 300개 발주에 100개만
       * 들어와도 발주가 통째로 닫혀, 두 번째 입고를 그 발주에 못 붙이고
       * 최소 재고선 알림도 남은 미입고분을 못 셌다.
       *
       * 이제 `material_lot` 트리거가 입고 누계로 정한다. 같은 것을 두 곳에서
       * 정하면 갈라진다 (§10).
       */
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

/* ---------------------------------------------------------------------------
   원액 제조 (§4.7 · 0119)

   원료 로트 여러 개에서 꺼내 원액 로트 하나를 세운다. 로트번호는 채번 규칙이
   제조일로 만들고(0097), 유효기간과 단가는 함수가 정한다 - 응용에서 조합하지
   않는다.

   판정하지 않는다 (§1). 처방이 맞는지 묻지 않고, 적힌 원료와 수량을 이어 둘 뿐이다.

   로트도 수량도 비어 있는 원료 줄은 건너뛴다(쓰지 않은 줄). 한쪽만 차 있으면
   어느 줄인지 말하고 거부한다 - 적었다고 믿은 원료가 말없이 기록에서 빠지기
   때문이다.

     로트를 골랐는데 수량이 0 이하   그 줄의 수량을 고치라고 한다
     수량을 적었는데 로트가 없음     그 줄의 로트를 고르라고 한다
--------------------------------------------------------------------------- */
export async function makeSolutionLot(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const itemId = String(form.get('item_id') ?? '').trim();
    if (!itemId) return { error: '제조할 원액 품목을 고르십시오' };
    const madeOn = String(form.get('made_on') ?? '').trim();
    if (!madeOn) return { error: '제조일을 입력하십시오' };
    const qty = num(form.get('qty'), '제조량');
    if (qty <= 0) return { error: '제조량은 0보다 커야 합니다' };

    /*
     * 줄 번호는 로트 칸과 수량 칸 양쪽에서 모은다. 로트 칸만 훑으면 로트 칸이
     * 없이 수량만 온 줄은 보지도 못하고 지나간다.
     */
    const rows = [...new Set(
      [...form.keys()]
        .map((k) => k.match(/^(?:lot|qty)_(\d+)$/)?.[1])
        .filter((n): n is string => n !== undefined),
    )].sort((a, b) => Number(a) - Number(b));

    const lots: string[] = [];
    const qtys: number[] = [];
    for (const n of rows) {
      const row = `원료 ${Number(n) + 1}번째 줄`;
      const lot = String(form.get(`lot_${n}`) ?? '').trim();
      const rawQty = String(form.get(`qty_${n}`) ?? '').trim();
      if (!lot && !rawQty) continue;
      if (!lot) return { error: `${row}에 수량이 있는데 원료 로트를 고르지 않았습니다` };
      const q = num(form.get(`qty_${n}`), `${row}의 수량`);
      if (q <= 0) return { error: `${row}의 수량은 0보다 커야 합니다` };
      lots.push(lot);
      qtys.push(q);
    }
    if (lots.length === 0) return { error: '차감할 원료와 수량을 한 줄 이상 입력하십시오' };

    const made = await withActor(me.id, async (db) => {
      const id = await db.val<string>(
        `select make_solution_lot($1::uuid, $2::date, $3::numeric, $4::uuid[], $5::numeric[], $6::text)`,
        [itemId, madeOn, qty, lots, qtys, txt(form.get('note'))]);
      /* 날짜는 글자로 받는다. Date 로 건너가면 한국 자정이 하루 밀린다 (lib/kst) */
      const lot = await db.one<{
        lot_no: string; expiry_date: string | null; unit_price: string | null; usage_uom: string;
      }>(
        `select ml.lot_no, ml.expiry_date::text as expiry_date, ml.unit_price, i.usage_uom
           from material_lot ml join item i on i.id = ml.item_id
          where ml.id = $1`, [id]);
      return { id, lot };
    });
    bump();

    const lot = made.lot;
    /* 비어 있는 것은 비었다고 적는다. 지어내지 않는다 (§8.5) */
    const expiry = lot?.expiry_date
      ? `유효기간 ${lot.expiry_date}.`
      : '사용기간이 설정되지 않아 유효기간이 비었습니다.';
    const price = lot?.unit_price !== null && lot?.unit_price !== undefined
      ? `단가 ${Number(lot.unit_price)} / ${lot.usage_uom}.`
      : '단가 없는 원료가 있어 단가가 비었습니다.';
    return {
      ok: true,
      message: `원액 로트 ${lot?.lot_no ?? ''} 등록. 제조량 ${qty} ${lot?.usage_uom ?? ''}, ` +
               `원료 ${lots.length}종이 차감되었습니다. ${expiry} ${price}`,
      href: `/print/label/${made.id}`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   원액의 원료 줄을 바로잡는다 (§2.1 · 0121)

   원료 줄은 고쳐 쓰지 않는다 (0119). 틀리게 적었으면 같은 원액을 가리키는 줄을
   더한다 - 되돌리기는 반납 줄, 더하기는 원료 줄. 원래 줄과 정정 줄이 다 남고
   원액 추적 화면의 원료 표는 그 합을 보여 준다.

   재고 증감 화면의 반납은 원액을 가리키지 않는다. 그 길로 되돌리면 원료 재고는
   돌아오는데 원액은 그 로트로 만들어졌다고 계속 말한다. 그래서 이 길이 따로 있다.

   한도는 DB 가 지킨다 - 들어간 원료를 꺼낸 만큼까지만 되돌리고, 원액이 아닌
   로트는 가리키지 못하고, 잔여를 넘어 차감하지 못한다. 응용에서만 막은 건 검증이
   아니다 (§1-2). 사유는 그 줄에 남고, 원료 로트의 재고 변경에는 감사추적의 사유로
   남는다.

   원액 단가는 다시 셈하지 않는다. 만들 때 정한 값 그대로다.
--------------------------------------------------------------------------- */
async function correctSolutionInput(
  form: FormData,
  mode: 'return' | 'add',
): Promise<FormState> {
  try {
    const me = await mgr();
    const verb = mode === 'return' ? '되돌릴' : '더할';
    const solId = String(form.get('solution_lot_id') ?? '').trim();
    const rawId = String(form.get(mode === 'return' ? 'return_lot_id' : 'add_lot_id') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim();

    if (!solId) return { error: '어느 원액인지 알 수 없습니다' };
    if (!rawId) return { error: `${verb} 원료 로트를 고르십시오` };
    const qty = num(form.get('qty'), `${verb} 수량`);
    if (qty <= 0) return { error: `${verb} 수량은 0보다 커야 합니다` };
    if (!reason) {
      return { error: mode === 'return' ? '왜 되돌리는지 적으십시오' : '왜 더하는지 적으십시오' };
    }

    const raw = await withActor(me.id, async (db) => {
      await db.val(
        mode === 'return'
          ? `select return_solution_input($1::uuid, $2::uuid, $3::numeric, $4::text)`
          : `select add_solution_input($1::uuid, $2::uuid, $3::numeric, $4::text)`,
        [solId, rawId, qty, reason]);
      return db.one<{ lot_no: string; usage_uom: string }>(
        `select ml.lot_no, i.usage_uom
           from material_lot ml join item i on i.id = ml.item_id
          where ml.id = $1`, [rawId]);
    }, {
      reason: `${mode === 'return' ? '원액 원료 되돌리기' : '원액 원료 더하기'} · ${reason}`,
    });

    bump();
    revalidatePath('/material/movement');
    revalidatePath(`/trace/material/${solId}`);
    revalidatePath(`/trace/material/${rawId}`);

    const what = `원료 로트 ${raw?.lot_no ?? ''} ${qty} ${raw?.usage_uom ?? ''}`;
    return {
      ok: true,
      message: mode === 'return'
        ? `${what} 을(를) 되돌렸습니다. 원래 원료 줄은 그대로 남고 되돌린 줄이 더해졌습니다.`
        : `${what} 을(를) 이 원액의 원료로 더했습니다. 원액 단가는 그대로입니다.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/** 원료 줄 되돌리기. 잘못 고른 원료나 많이 적은 수량 */
export async function returnSolutionInput(_p: FormState, form: FormData): Promise<FormState> {
  return correctSolutionInput(form, 'return');
}

/** 원료 줄 더하기. 실제로 썼는데 빠뜨린 원료 */
export async function addSolutionInput(_p: FormState, form: FormData): Promise<FormState> {
  return correctSolutionInput(form, 'add');
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
