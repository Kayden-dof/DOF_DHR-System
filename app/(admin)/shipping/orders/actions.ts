'use server';

import { revalidatePath } from 'next/cache';
import { withActor, withUser, dbMessage, type Db } from '@/lib/db';
import { requireRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';
import { loadCalendar } from '@/lib/timeline-db';
import { loadDmPlanInputs } from '@/lib/order-plan-db';
import { proposeBatches, firstStepMin } from '@/lib/order-plan';
import { num } from '@/lib/fmt';

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

/*
 * 판매 단가 (0178 · 사용자 2026-11-27). 개당 · 원 · VAT 별도. 비워 둘 수 있다 - 비면 출고 금액에 들지 않는다.
 * 쉼표를 지우고 읽는다 (금액을 1,000 처럼 적는 일이 잦다).
 */
function price(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error('단가는 0 이상의 숫자로 적으십시오 (원 · VAT 별도)');
  return n;
}

type NewLine = { item: string; qty: number; price: number | null };

/** 폼의 새 형명 줄 (line_item_<n> · line_qty_<n> · line_price_<n>). 형명을 고르지 않은 줄은 건너뛴다 */
function newLines(form: FormData): NewLine[] {
  const out: NewLine[] = [];
  for (const [k, v] of form.entries()) {
    const m = k.match(/^line_item_(\d+)$/);
    if (!m) continue;
    if (String(v) === '') {
      /* 수량만 적고 형명이 빈 줄은 조용히 빼지 않는다 - 찾기 글이 맞지 않아 비워졌을 수 있다 */
      if (String(form.get(`line_qty_${m[1]}`) ?? '').trim()) {
        throw new Error('형명을 고르지 않은 줄이 있습니다. 형명을 고르거나 그 줄을 빼십시오');
      }
      continue;
    }
    const qty = Number(form.get(`line_qty_${m[1]}`) ?? 0);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('형명 줄의 수량은 1 이상의 정수로 적으십시오');
    out.push({ item: String(v), qty, price: price(form.get(`line_price_${m[1]}`)) });
  }
  return out;
}

async function addLines(db: Db, orderId: string, lines: NewLine[]) {
  let seq = await db.val<number>(
    `select coalesce(max(seq), 0)::int from sales_order_line where sales_order_id = $1`, [orderId]) ?? 0;
  for (const l of lines) {
    seq += 1;
    await db.rows(
      `insert into sales_order_line (sales_order_id, item_id, qty, seq, unit_price) values ($1,$2,$3,$4,$5)`,
      [orderId, l.item, l.qty, seq, l.price]);
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
        `insert into sales_order (customer_id, customer_po_no, ordered_on, ship_to, due_on, ship_by, note, created_by)
         values ($1,$2,$3::date,$4,$5::date,$6::date,$7,$8) returning id`,
        [customerId, po, String(form.get('ordered_on') ?? ''), txt(form.get('ship_to')),
         txt(form.get('due_on')), txt(form.get('ship_by')), String(form.get('note') ?? '').trim(), me.id]);
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
        `update sales_order set customer_po_no = $2, ordered_on = $3::date, ship_to = $4, due_on = $5::date, note = $6,
                ship_by = $7::date
          where id = $1 and cancelled_at is null returning id`,
        [id, po, String(form.get('ordered_on') ?? ''), txt(form.get('ship_to')),
         txt(form.get('due_on')), String(form.get('note') ?? '').trim(), txt(form.get('ship_by'))]);
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
      /* 줄 단가 (0178). 바뀐 줄만 고친다 - 감사추적에 손댄 줄만 남게 */
      for (const [k, v] of form.entries()) {
        const m = k.match(/^price_(.+)$/);
        if (!m) continue;
        await db.rows(
          `update sales_order_line set unit_price = $3
            where id = $1 and sales_order_id = $2 and unit_price is distinct from $3::numeric and cancelled_at is null`,
          [m[1], id, price(v)]);
      }
      await addLines(db, id, lines);
    });
    bump();
    return { ok: true, message: `주문 ${po}를 고쳤습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   출고 마감일 제안 (0173 · 사용자 2026-11-26 «주문 수량 기준으로 대략 계산해서 잡아 줄 수 있도록»)

   주문 등록 · 고치기 창이 형명 · 수량을 넘기면 «주문에서 계획» 과 같은 셈(lib/order-plan.ts)으로
   마지막 배치가 끝나는 날을 돌려준다. 저장하지 않는다 - 창이 출고 마감일 칸을 채우고 사람이 고친다.

     · 형명마다 그 형명이 드는 시행 중인 판 (order_plan_lines 와 같은 고르기)
     · 형명마다 따로, 그 개수 · 장당 개수 · 시료 구간 · 시간표 없는 판의 간격 기본값으로 - «주문에서 계획» 이
       그 줄에 내놓는 제안과 같다 (정밀 점검 E · 2026-11-27). 판의 값은 lib/order-plan-db 한 곳에서 읽는다.
       전에는 한 판에 형명이 여럿이면 장수를 더해 «장당 1개 · 시료 없음» 으로 한 번에 나눠 배치 수 · 날짜가 달랐다.
     · 오늘(다음 근무일) 착수, 판의 공정 시간표와 근무 달력으로 배치를 잇는다. 다른 계획 · 다른 형명은 보지 않는다 - 대략
     · 형명이 여럿이면 가장 늦은 날
   고치기 창의 기존 줄은 남은 수량(주문 - 출고)으로 센다.
--------------------------------------------------------------------------- */
export interface ShipByEstimate { on: string | null; note: string }

export async function estimateShipBy(input: {
  lines: { item?: string; line?: string; qty: number }[];
}): Promise<ShipByEstimate> {
  try {
    const me = await mgr();
    const asked = (Array.isArray(input?.lines) ? input.lines : [])
      .filter((l) => Number.isInteger(l?.qty) && l.qty > 0 && l.qty <= 10_000_000)
      .slice(0, 50);
    if (asked.length === 0) return { on: null, note: '' };

    return await withUser(me, async (db) => {
      /* 형명별 개수 */
      const units = new Map<string, number>();
      const add = (item: string, n: number) => { if (n > 0) units.set(item, (units.get(item) ?? 0) + n); };
      const lineIds = asked.filter((l) => l.line).map((l) => String(l.line));
      const known = lineIds.length === 0 ? [] : await db.rows<{ id: string; item_id: string; shipped: number }>(
        `select id::text, item_id::text, so_line_shipped(id) as shipped
           from sales_order_line where id = any($1::uuid[]) and cancelled_at is null`, [lineIds]);
      for (const l of asked) {
        if (l.item) add(String(l.item), l.qty);
        else if (l.line) {
          const k = known.find((x) => x.id === l.line);
          if (k) add(k.item_id, l.qty - k.shipped);
        }
      }
      if (units.size === 0) return { on: null, note: '' };

      /* 형명마다 판 */
      const picks = await db.rows<{
        item_id: string; code: string; dm: string | null; dm_label: string | null;
        per_sheet: number | null; sheet_min: number | null; sheet_max: number | null;
      }>(
        `select i.id::text as item_id, i.code, d.id::text as dm,
                coalesce(d.product_code, di.code) || ' ' || d.revision as dm_label,
                model_per_sheet(d.id, i.id) as per_sheet, d.sheet_min, d.sheet_max
           from item i
           left join lateral (
             select dm.* from device_master dm
              where dm_effective(dm.id) and exists (select 1 from dm_models(dm.id) m where m.id = i.id)
              order by dm.effective_from desc, (model_per_sheet(dm.id, i.id) is not null) desc, dm.id
              limit 1) d on true
           left join item di on di.id = d.item_id
          where i.id = any($1::uuid[])
          order by i.code`, [[...units.keys()]]);

      const calendar = await loadCalendar(db);
      const today = (await db.val<string>(`select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD')`)) ?? '';
      const notes: string[] = [];
      let on: string | null = null;

      for (const p of picks.filter((x) => !x.dm)) notes.push(`${p.code} 은 시행 중인 판이 없어 셀 수 없습니다`);
      for (const p of picks.filter((x) => x.dm && !x.per_sheet)) notes.push(`${p.code} 은 장당 개수를 셀 수 없습니다`);

      const ok = picks.filter((x) => x.dm && x.per_sheet);
      const inputs = await loadDmPlanInputs(db, ok.map((x) => x.dm!), calendar);
      for (const p of ok) {
        const info = inputs.get(p.dm!);
        const n = units.get(p.item_id)!;
        const plan = proposeBatches({
          units: n, perSheet: p.per_sheet, sheetMin: p.sheet_min, sheetMax: p.sheet_max, sampleTiers: info?.tiers ?? [],
          steps: info?.steps ?? null, startMin: info?.startMin ?? firstStepMin(null), calendar, today, dueOn: null,
          gapDays: info?.defaultGap ?? null,
        });
        const what = `${p.code} ${num(n)}개`;
        if (!plan.ok) { notes.push(`${what} - 셀 수 없습니다`); continue; }
        const last = plan.batches[plan.batches.length - 1]?.lastOn ?? null;
        if (!last) {
          notes.push(`${what} → ${plan.batches.length} 배치 (${num(plan.sheets)}장) · ${p.dm_label} 공정 시간표가 없어 날짜를 셀 수 없습니다`);
          continue;
        }
        notes.push(`${what} → ${plan.batches.length} 배치 (${num(plan.sheets)}장) · 마지막 배치 끝 ${last.slice(5)}`);
        if (!on || last > on) on = last;
      }
      if (on) notes.push('오늘 착수 기준');
      return { on, note: notes.join(' · ') };
    });
  } catch (e) {
    return { on: null, note: dbMessage(e) };
  }
}

/*
 * 취소한 주문 · 줄로 올린 배치 계획 가운데 아직 지시가 없는 것 (정밀 점검 E · 2026-11-27). 계획은 지우지 않는다 -
 * 자재 소요에서는 빠지고(0177), 그 배치를 만들지 않으면 사람이 일정에서 지운다. 그래서 결과 문구로 알린다.
 */
async function leftPlans(db: Db, where: string, id: string): Promise<string[]> {
  return (await db.rows<{ label: string }>(
    `select bp.label from batch_plan bp join sales_order_line sl on sl.id = bp.sales_order_line_id
      where ${where}
        and (bp.work_order_id is null
             or exists (select 1 from work_order w where w.id = bp.work_order_id and w.status = 'CANCELLED'))
      order by bp.start_on, bp.label`, [id])).map((x) => x.label);
}
const plansTail = (labels: string[]) => labels.length === 0 ? ''
  : ` 이 주문으로 올린 배치 계획 ${labels.length}개(${labels.slice(0, 3).join(' · ')}${labels.length > 3 ? ' 외' : ''})는`
    + ' 일정에 남아 있습니다. 자재 소요에서는 빠졌고, 만들지 않으면 생산 › 일정에서 지우십시오.';

export async function cancelOrder(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const reason = String(form.get('reason') ?? '').trim();
    if (!reason) return { error: '취소 사유를 적으십시오' };
    const id = String(form.get('id') ?? '');
    const plans = await withActor(me.id, async (db) => {
      await db.rows(
        `update sales_order set cancelled_at = now(), cancelled_by = $2, cancel_reason = $3
          where id = $1 and cancelled_at is null`,
        [id, me.id, reason]);
      return leftPlans(db, `sl.sales_order_id = $1::uuid`, id);
    }, { reason });
    bump();
    return { ok: true, message: '주문을 취소했습니다. 이미 나간 출고는 그대로 남습니다.' + plansTail(plans) };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function cancelLine(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const reason = String(form.get('reason') ?? '').trim();
    if (!reason) return { error: '취소 사유를 적으십시오' };
    const id = String(form.get('id') ?? '');
    const plans = await withActor(me.id, async (db) => {
      await db.rows(
        `update sales_order_line set cancelled_at = now(), cancel_reason = $2
          where id = $1 and cancelled_at is null`,
        [id, reason]);
      return leftPlans(db, `sl.id = $1::uuid`, id);
    }, { reason });
    bump();
    return { ok: true, message: '형명 줄을 취소했습니다.' + plansTail(plans) };
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
                  txt(form.get('contact_email')), txt(form.get('address')), String(form.get('note') ?? '').trim(),
                  price(form.get('price_per_cm2')) || null];
    await withActor(me.id, (db) => id
      ? db.rows(
          `update customer set name = $2, biz_no = $3, contact_name = $4, contact_phone = $5,
                  contact_email = $6, address = $7, note = $8, price_per_cm2 = $9, is_active = $10
            where id = $1`, [id, ...vals, form.get('is_active') === 'on'])
      : db.rows(
          `insert into customer (name, biz_no, contact_name, contact_phone, contact_email, address, note, price_per_cm2, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [...vals, me.id]));
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
