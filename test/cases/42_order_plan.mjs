// =============================================================================
// 42_order_plan.mjs - 주문에서 생산 계획 · 자재 소요 예보 (0164)
// 근거: 사용자 2026-11-25 «주문에서 생산 계획을 잡고, 자재가 얼마나 드는지 미리 보고 싶다»
//
// 판의 유효 크기 · 원료 품목 칸, 계획의 장수와 주문 줄, 장당 개수.
// =============================================================================

import { masterData as master, newWorkOrder, reverify } from '../fixtures.mjs';

/** 꺼진 PD 형명 체계를 켜고, 끝에 되돌린다 (40_sales_order 꼴) */
async function withScheme(t, fn) {
  const off = (await t.rows(`select id from model_scheme where prefix = 'PD' and not is_active`)).map((x) => x.id);
  await t.rows(`update model_scheme set is_active = true where id = any($1::uuid[])`, [off]);
  try { return await fn(); }
  finally { await t.rows(`update model_scheme set is_active = false where id = any($1::uuid[])`, [off]); }
}

const item = async (t, code) =>
  (await t.val(`select id from item where code = $1`, [code]))
  ?? t.val(`insert into item (code, name, type, shelf_life_months, purchase_uom, usage_uom, conversion) values ($1, $1, 'FIN', 12, 'EA', 'EA', 1) returning id`, [code]);

let CUSTOMER;
async function orderLine(t, m, code, po, qty = 10) {
  CUSTOMER ??= await t.val(
    `insert into customer (name, biz_no, created_by) values ('계획 시험 고객사', '000-00-00042', $1) returning id`, [m.admin]);
  const o = await t.val(
    `insert into sales_order (customer_id, customer_po_no, ordered_on, created_by)
     values ($1,$2,current_date,$3) returning id`, [CUSTOMER, po, m.admin]);
  return t.val(
    `insert into sales_order_line (sales_order_id, item_id, qty, seq) values ($1,$2,$3,1) returning id`,
    [o, await item(t, code), qty]);
}

const plan = (t, m, { sheets = 5, line = null, label = 'P-' + Math.random().toString(36).slice(2, 8) } = {}) =>
  t.val(
    `insert into batch_plan (label, device_master_id, start_on, sheets, sales_order_line_id, created_by)
     values ($1,$2,current_date,$3,$4,$5) returning id`, [label, m.dm, sheets, line, m.admin]);

/** 판을 시행 중으로 만들고 유효 크기를 정한다. 끝에 되돌릴 값(원래 칸)을 돌려준다 */
async function putInForce(t, m) {
  const old = (await t.rows(
    `select usable_w, usable_h, verified_by, verified_at, status, effective_from from device_master where id = $1`, [m.dm]))[0];
  await t.rows(`update device_master set usable_w = 20, usable_h = 20 where id = $1`, [m.dm]);
  await reverify(t, m.dm, m.admin);
  await t.rows(`update device_master set status = 'ACTIVE', effective_from = current_date where id = $1`, [m.dm]);
  return old;
}
async function restoreDm(t, m, old) {
  await t.rows(
    `update device_master set usable_w = $2, usable_h = $3, effective_from = $4,
            status = $5, verified_by = $6, verified_at = $7 where id = $1`,
    [m.dm, old.usable_w, old.usable_h, old.effective_from, old.status, old.verified_by, old.verified_at]);
}
/** 시험이 만든 계획 · 줄 · 지시 이음 · 지시를 뒷시험이 보지 않게 치운다 (지울 수 없는 것은 취소 · 뗌 · 0 으로) */
async function tidy(t, m, { plans = [], lines = [], wos = [], lots = [] } = {}) {
  await t.setActor(m.admin);
  for (const id of plans) await t.rows(`delete from batch_plan where id = $1`, [id]);
  await t.rows(
    `update work_order_so_line set unlinked_at = now(), unlinked_by = $2, unlink_reason = '시험 뒷정리'
      where sales_order_line_id = any($1::uuid[]) and unlinked_at is null`, [lines, m.admin]);
  await t.rows(
    `update sales_order_line set cancelled_at = now(), cancel_reason = '시험 뒷정리'
      where id = any($1::uuid[]) and cancelled_at is null`, [lines]);
  await t.rows(
    `update sales_order set cancelled_at = now(), cancel_reason = '시험 뒷정리'
      where id in (select sales_order_id from sales_order_line where id = any($1::uuid[])) and cancelled_at is null`, [lines]);
  for (const id of lots) await t.rows(`update product_lot set qty_available = 0 where id = $1`, [id]);
  for (const id of wos) await t.rows(
    `update work_order set status = 'CANCELLED', cancelled_reason = '시험 뒷정리' where id = $1 and status <> 'CANCELLED'`, [id]);
}
const fgStock = (t, code) => t.val(
  `select coalesce(sum(qty_available),0)::int from product_lot where item_id = (select id from item where code = $1)`, [code]);
/** 판 안 형명 가운데 장당 개수가 나오는 첫 형명 */
async function pickCode(t, m) {
  for (const r of await t.rows(`select code from dm_models($1)`, [m.dm])) {
    const n = await t.val(`select model_per_sheet($1, (select id from item where code = $2))`, [m.dm, r.code]);
    if (n) return { code: r.code, per: n };
  }
  throw new Error('장당 개수가 나오는 형명이 없다');
}
const covered = (t, line) => t.val(`select so_line_covered($1)`, [line]);
const planRow = async (t, line) =>
  (await t.rows(`select * from order_plan_lines() where line_id = $1`, [line]))[0];
const hang = (t, m, wo, line) => t.rows(
  `insert into work_order_so_line (work_order_id, sales_order_line_id, linked_by) values ($1,$2,$3)`, [wo, line, m.admin]);

export default [

{
  id: 'OP-01', expect: '통과',
  name: '장당 개수는 유효 크기와 형명 크기로 센다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      for (const c of ['PD10182025', 'PD05050510', 'PD25250510', 'PD01020510']) await item(t, c);
      await t.rows(`update device_master set usable_w = 20, usable_h = 20 where id = $1`, [m.dm]);
      const per = (c) => t.val(`select model_per_sheet($1, (select id from item where code = $2))`, [m.dm, c]);
      t.eq(await per('PD10182025'), 2, '10x18 은 2');
      t.eq(await per('PD05050510'), 16, '5x5 는 16');
      t.eq(await per('PD25250510'), null, '25x25 는 들어가지 않아 null');
      t.eq(await per('PD01020510'), 200, '1x2 는 200');
      await t.rows(`update device_master set usable_w = null, usable_h = null where id = $1`, [m.dm]);
      t.eq(await per('PD10182025'), null, '유효 크기가 비면 null');
    });
  },
},

{
  id: 'OP-02', expect: '거부',
  name: '계획 장수는 0 보다 크고, 이은 주문 줄은 그 판의 형명이어야 한다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      await t.rejects(() => plan(t, m, { sheets: 0 }), { code: '23514' });
      const out = await orderLine(t, m, 'ZZ-OUT-001', 'OP02-OUT');
      await t.rejects(() => plan(t, m, { line: out }), { code: 'P0001', message: '이 주문 줄의 형명은' });
      const inCode = await t.val(`select code from dm_models($1) limit 1`, [m.dm]);
      const inn = await orderLine(t, m, inCode, 'OP02-IN');
      const ok = await plan(t, m, { line: inn });
      t.ok(ok, '판 안 형명의 줄은 들어간다');
      /* 시연 자료 비우기 시험(08)이 «표시 뒤 기록 없음» 을 보므로 계획은 치운다 */
      await t.rows(`delete from batch_plan where id = $1`, [ok]);
    });
  },
},

{
  id: 'OP-03', expect: '통과',
  name: '덮인 개수는 걸린 지시 · 이은 계획을 센다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      const old = await putInForce(t, m);
      const mine = { plans: [], lines: [], wos: [], lots: [] };
      try {
        const { code, per } = await pickCode(t, m);
        const stock0 = await fgStock(t, code);
        const l1 = await orderLine(t, m, code, 'OP03-A', 100);
        mine.lines.push(l1);
        t.eq(await covered(t, l1), 0, '아무것도 없으면 0');
        const r0 = await planRow(t, l1);
        t.ok(r0, '시행 중인 판이 있으면 제안 대상 줄에 나온다');
        t.eq(r0.left_qty, 100, 'left 100');
        t.eq(r0.covered, 0, 'covered 0');
        t.eq(r0.per_sheet, per, '장당 개수');
        t.eq(r0.fg_stock, stock0, 'fg_stock 은 그 형명 제품 로트 남은 양 합 (보이기만 한다)');
        t.eq(r0.multi_wo, false, '지시가 없으면 multi_wo 아님');

        const p = await plan(t, m, { sheets: 3, line: l1 });
        mine.plans.push(p);
        t.eq(await covered(t, l1), 3 * per, '지시 없는 이은 계획은 장수 x 장당 개수');

        const wo = await newWorkOrder(t, m, { sheets: 10 });
        mine.wos.push(wo.id);
        await hang(t, m, wo.id, l1);
        t.eq(await covered(t, l1), 3 * per + 10 * per, '재단 전 지시(10장)는 지시 장수 x 장당 개수');
        t.eq((await planRow(t, l1)).multi_wo, false, '한 줄만 걸린 지시는 multi_wo 아님');

        const l2 = await orderLine(t, m, code, 'OP03-B', 100);
        mine.lines.push(l2);
        await hang(t, m, wo.id, l2);
        t.eq(await covered(t, l1), 3 * per + 5 * per, '같은 형명 줄이 둘이면 지시 몫이 반씩');
        t.eq((await planRow(t, l1)).multi_wo, true, '다른 줄에도 걸린 지시가 있으면 multi_wo');

        await t.rows(`update sales_order_line set cancelled_at = now(), cancel_reason = '시험 취소' where id = $1`, [l2]);
        t.eq(await planRow(t, l2), undefined, '취소한 줄은 빠진다');
        t.eq(await covered(t, l1), 3 * per + 10 * per, '취소한 줄은 몫을 나누지 않는다');
        await t.rows(`update sales_order_line set cancelled_at = now(), cancel_reason = '시험 취소' where id = $1`, [l1]);
        t.eq(await covered(t, l1), 3 * per, '줄이 모두 left 0 이어도 0 으로 나누지 않는다 (지시 몫 0, 이은 계획만 남는다)');
        t.eq(await planRow(t, l1), undefined, '취소한 줄은 빠진다 (둘째)');
      } finally { await tidy(t, m, mine); await restoreDm(t, m, old); }
    });
  },
},

{
  id: 'OP-04', expect: '통과',
  name: '재단한 지시는 그 형명 로트의 남은 양만 센다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      const old = await putInForce(t, m);
      const mine = { plans: [], lines: [], wos: [], lots: [] };
      try {
        const { code } = await pickCode(t, m);
        const stock0 = await fgStock(t, code);
        const l1 = await orderLine(t, m, code, 'OP04', 100);
        mine.lines.push(l1);
        const wo = await newWorkOrder(t, m, { sheets: 10 });
        mine.wos.push(wo.id);
        await hang(t, m, wo.id, l1);
        const itemId = await t.val(`select id from item where code = $1`, [code]);
        mine.lots.push(await t.val(
          `insert into product_lot (work_order_id, lot_no, item_id, qty_produced, qty_available, manufactured_on, expiry_date, registered_by)
           values ($1, $2, $3, 20, 12, current_date, current_date + 365, $4) returning id`,
          [wo.id, 'OP04-' + Math.random().toString(36).slice(2, 8), itemId, m.admin]));
        t.eq(await covered(t, l1), 12, '재단한 지시는 로트의 남은 양');
        t.eq((await planRow(t, l1)).fg_stock - stock0, 12, 'fg_stock 은 로트 남은 양만큼 늘어 보인다');
        /* 로트가 다른 형명이면 그 지시는 이 줄에 0 */
        const other = (await t.rows(`select code from dm_models($1) where code <> $2 limit 1`, [m.dm, code]))[0];
        if (other) {
          const l2 = await orderLine(t, m, other.code, 'OP04-B', 100);
          mine.lines.push(l2);
          await hang(t, m, wo.id, l2);
          t.eq(await covered(t, l2), 0, '다른 형명 로트만 있으면 0');
        }
      } finally { await tidy(t, m, mine); await restoreDm(t, m, old); }
    });
  },
},

{
  id: 'OP-06', expect: '통과',
  name: '계획에 지시를 이으면 그 주문 줄을 지시에 함께 건다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      const code = await t.val(`select code from dm_models($1) limit 1`, [m.dm]);
      const line = await orderLine(t, m, code, 'OP06');
      const p = await plan(t, m, { line });
      const wo = await newWorkOrder(t, m);
      await t.setActor(m.admin);
      await t.rows(`update batch_plan set work_order_id = $1 where id = $2`, [wo.id, p]);
      const n = () => t.val(
        `select count(*)::int from work_order_so_line where work_order_id = $1 and sales_order_line_id = $2 and unlinked_at is null`,
        [wo.id, line]);
      t.eq(await n(), 1, '주문 줄이 지시에 걸린다');
      await t.rows(`update batch_plan set work_order_id = null where id = $1`, [p]);
      await t.rows(`update batch_plan set work_order_id = $1 where id = $2`, [wo.id, p]);
      t.eq(await n(), 1, '이미 걸려 있으면 두 줄이 되지 않는다');
      await t.rows(`delete from batch_plan where id = $1`, [p]);
    });
  },
},

{
  id: 'OP-06b', expect: '통과',
  name: '주문 줄이 0159 규칙에 걸려 걸리지 않아도 계획 잇기는 그대로 된다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      const code = await t.val(`select code from dm_models($1) limit 1`, [m.dm]);
      const line = await orderLine(t, m, code, 'OP06B');
      const p = await plan(t, m, { line });
      await t.setActor(m.admin);
      await t.rows(`update sales_order_line set cancelled_at = now(), cancel_reason = '시험 취소' where id = $1`, [line]);
      const wo = await newWorkOrder(t, m);
      await t.setActor(m.admin);
      await t.rows(`update batch_plan set work_order_id = $1 where id = $2`, [wo.id, p]);
      t.eq(await t.val(`select work_order_id from batch_plan where id = $1`, [p]), wo.id, '계획 잇기는 그대로');
      t.eq(await t.val(
        `select count(*)::int from work_order_so_line where work_order_id = $1 and unlinked_at is null`, [wo.id]),
        0, '취소된 줄은 지시에 걸리지 않는다');
      await t.rows(`delete from batch_plan where id = $1`, [p]);
    });
  },
},

{
  id: 'OP-00', expect: '거부',
  name: '원료 품목 칸에는 원료(RAW) 품목만',
  async run(t) {
    const m = await master(t);
    await t.rejects(() => t.rows(`update device_master set raw_item_id = $1 where id = $2`, [m.reagent, m.dm]),
      { code: 'P0001', message: '원료' });
    await t.rows(`update device_master set raw_item_id = $1 where id = $2`, [m.raw, m.dm]);
    t.eq(await t.val(`select raw_item_id from device_master where id = $1`, [m.dm]), m.raw, '원료 품목은 들어간다');
  },
},

];
