// =============================================================================
// 42_order_plan.mjs - 주문에서 생산 계획 · 자재 소요 예보 (0164)
// 근거: 사용자 2026-11-25 «주문에서 생산 계획을 잡고, 자재가 얼마나 드는지 미리 보고 싶다»
//
// 판의 유효 크기 · 원료 품목 칸, 계획의 장수와 주문 줄, 장당 개수.
// =============================================================================

import { masterData as master, newWorkOrder } from '../fixtures.mjs';

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
async function orderLine(t, m, code, po) {
  CUSTOMER ??= await t.val(
    `insert into customer (name, biz_no, created_by) values ('계획 시험 고객사', '000-00-00042', $1) returning id`, [m.admin]);
  const o = await t.val(
    `insert into sales_order (customer_id, customer_po_no, ordered_on, created_by)
     values ($1,$2,current_date,$3) returning id`, [CUSTOMER, po, m.admin]);
  return t.val(
    `insert into sales_order_line (sales_order_id, item_id, qty, seq) values ($1,$2,10,1) returning id`,
    [o, await item(t, code)]);
}

const plan = (t, m, { sheets = 5, line = null, label = 'P-' + Math.random().toString(36).slice(2, 8) } = {}) =>
  t.val(
    `insert into batch_plan (label, device_master_id, start_on, sheets, sales_order_line_id, created_by)
     values ($1,$2,current_date,$3,$4,$5) returning id`, [label, m.dm, sheets, line, m.admin]);

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
