// =============================================================================
// 40_sales_order.mjs - 수주 장부 · 출고는 주문 줄로 · 형명 일괄 검토 (0159)
// 근거: 사용자 2026-11-25 «DHR 은 주문 장부와 출고 연결에만 집중하면 됨.» · «B 주문서+줄 (권고)» ·
//       «출고할때 발주 업체리스트에서 선택하고, 발주 형명이 맞는지 작업지시서 및 제조기록서 일괄
//       검토해서 출고시 오규격이 나가지 않도록 흐름을 그렇게 짜줘.»
//
// 고객이 낸 주문을 주문서(머리) + 형명 줄로 적고, 남은 수량 · 상태는 출고 표에서 센다(저장하지 않는다).
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder, sterilReport } from '../fixtures.mjs';

/* 이 파일의 거래처 하나. 다른 시험의 거래처와 사업자번호가 겹치지 않게 */
let CUSTOMER;
const customer = (t, m) => (CUSTOMER ??= t.val(
  `insert into customer (name, biz_no, created_by) values ('시험 고객사', '000-00-00001', $1) returning id`,
  [m.admin]));

/** 주문서 한 장과 형명 줄. lines = [[형명 코드, 수량], …] */
async function order(t, m, { po, lines }) {
  const c = await customer(t, m);
  const o = await t.val(
    `insert into sales_order (customer_id, customer_po_no, ordered_on, created_by)
     values ($1,$2,current_date,$3) returning id`, [c, po, m.admin]);
  const ids = {};
  let seq = 0;
  for (const [code, qty] of lines) {
    seq += 1;
    ids[code] = await t.val(
      `insert into sales_order_line (sales_order_id, item_id, qty, seq)
       values ($1, (select id from item where code = $2), $3, $4) returning id`, [o, code, qty, seq]);
  }
  return { customer: c, order: o, lines: ids };
}

/**
 * 출고할 수 있는 제품 로트 하나: 원료 두께 band 의 배치에서 code 형명으로 재단 · 포장 · 멸균 보고서까지.
 * band 가 null 이면 원료 로트에 두께를 적지 않는다.
 */
async function readyLot(t, m, { band = '0510', code = 'PD05050510', qty = 30 } = {}) {
  const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: band, qty: 50 });
  const wo = await newWorkOrder(t, m, { rawLot });
  await t.setActor(m.admin);
  const item = await t.val(`select id from item where code = $1`, [code]);
  const lot = await t.val(`select cut_product_lot($1,$2,$3,0)`, [wo.id, item, qty]);
  await t.rows(`update product_lot set status = 'PACKED' where id = $1`, [lot]);
  await sterilReport(t, m, wo.id);
  return { lot, wo, item };
}

const ship = (t, m, lot, line, qty = 1) => t.val(
  `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by, sales_order_line_id)
   values ($1,'시험 고객사',$2,current_date,$3,$4) returning id`, [lot, qty, m.admin, line]);

export default [

{
  id: 'SO-01', expect: '확인',
  name: '주문 줄의 남은 수량 · 주문서 상태를 출고 없이 센다',
  async run(t) {
    const m = await master(t);
    const { order: o, lines } = await order(t, m, { po: 'SO01', lines: [['PD05050510', 1000]] });
    t.eq(await t.val(`select so_line_shipped($1)`, [lines.PD05050510]), 0, '출고 0');
    t.eq(await t.val(`select so_line_left($1)`, [lines.PD05050510]), 1000, '처음엔 주문 수량');
    t.eq(await t.val(`select so_status($1)`, [o]), 'OPEN', '출고 0 이면 접수');
  },
},

{
  id: 'SO-02', expect: '예외',
  name: '한 주문서에 같은 형명 줄을 두 번 적지 않는다',
  async run(t) {
    const m = await master(t);
    await t.rejects(
      () => order(t, m, { po: 'SO02', lines: [['PD05050510', 10], ['PD05050510', 20]] }),
      { code: '23505' });
  },
},

{
  id: 'SO-03', expect: '예외 · 통과',
  name: '고객 발주번호는 거래처마다 살아 있는 주문 안에서 하나, 취소하면 다시 쓴다',
  async run(t) {
    const m = await master(t);
    const first = await order(t, m, { po: 'SO03', lines: [['PD05050510', 10]] });
    await t.rejects(() => order(t, m, { po: 'SO03', lines: [['PD05050510', 10]] }), { code: '23505' });
    await t.rows(
      `update sales_order set cancelled_at = now(), cancel_reason = '시험 - 잘못 받음' where id = $1`,
      [first.order]);
    await t.resolves(() => order(t, m, { po: 'SO03', lines: [['PD05050510', 10]] }));
  },
},

{
  id: 'SO-04', expect: '예외',
  name: '취소에는 사유가 있어야 하고, 취소는 되돌리지 않는다',
  async run(t) {
    const m = await master(t);
    const { order: o } = await order(t, m, { po: 'SO04', lines: [['PD05050510', 10]] });
    await t.rejects(
      () => t.rows(`update sales_order set cancelled_at = now() where id = $1`, [o]), { code: '23514' });
    await t.rejects(
      () => t.rows(`update sales_order set cancelled_at = now(), cancel_reason = '  ' where id = $1`, [o]),
      { code: '23514' });
    await t.rows(`update sales_order set cancelled_at = now(), cancel_reason = '시험' where id = $1`, [o]);
    t.ok(await t.val(`select cancelled_by is not distinct from current_user_id() from sales_order where id = $1`, [o]),
      '취소한 사람은 DB 가 채운다');
    await t.rejects(
      () => t.rows(`update sales_order set cancelled_at = null, cancel_reason = null where id = $1`, [o]),
      { code: 'P0001' });
  },
},

{
  id: 'SO-05', expect: '예외',
  name: '형명 줄의 품목은 완제품이어야 한다',
  async run(t) {
    const m = await master(t);
    const { order: o } = await order(t, m, { po: 'SO05', lines: [] });
    await t.rejects(
      () => t.rows(`insert into sales_order_line (sales_order_id, item_id, qty) values ($1,$2,5)`, [o, m.reagent]),
      { code: 'P0001', message: '완제품' });
  },
},

{
  id: 'SO-06', expect: '확인',
  name: '주문서를 취소하면 남은 수량이 0 이고 상태는 취소',
  async run(t) {
    const m = await master(t);
    const { order: o, lines } = await order(t, m, { po: 'SO06', lines: [['PD05050510', 40], ['PD10150510', 5]] });
    await t.rows(`update sales_order set cancelled_at = now(), cancel_reason = '시험' where id = $1`, [o]);
    t.eq(await t.val(`select so_line_left($1)`, [lines.PD05050510]), 0, '취소된 주문의 줄');
    t.eq(await t.val(`select so_status($1)`, [o]), 'CANCELLED', '상태');
  },
},

{
  id: 'SO-07', expect: '예외',
  name: '거래처 · 주문서 · 형명 줄은 지우지 않는다',
  async run(t) {
    const m = await master(t);
    const { customer: c, order: o, lines } = await order(t, m, { po: 'SO07', lines: [['PD05050510', 1]] });
    for (const [sql, id] of [
      ['delete from sales_order_line where id = $1', lines.PD05050510],
      ['delete from sales_order where id = $1', o],
      ['delete from customer where id = $1', c],
    ]) {
      await t.rejects(() => t.asRole('app_role', () => t.rows(sql, [id])), { code: '42501' });
    }
  },
},

{
  id: 'SO-08', expect: '예외',
  name: '출고는 주문 줄을 골라야 한다',
  async run(t) {
    const m = await master(t);
    const { lot } = await readyLot(t, m);
    await t.rejects(() => ship(t, m, lot, null), { code: 'P0001', message: '주문 줄' });
  },
},

{
  id: 'SO-09', expect: '예외',
  name: '제품 로트 형명이 주문 형명과 다르면 출고하지 않는다',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SO09', lines: [['PD10150510', 10]] });
    const { lot } = await readyLot(t, m);
    await t.rejects(() => ship(t, m, lot, lines.PD10150510), { code: 'P0001', message: '제품 로트 형명' });
  },
},

{
  id: 'SO-10', expect: '예외',
  name: '작업지시서 원료 두께가 주문 형명의 두께와 다르면 출고하지 않는다',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SO10', lines: [['PD05050510', 10]] });
    const { lot } = await readyLot(t, m, { band: '1015' });
    /* 12_model_scheme 가 체계를 모두 끈 채 끝난다. 두께 자리를 읽으려면 PD 체계가 켜져 있어야 한다 */
    const off = (await t.rows(`select id from model_scheme where prefix = 'PD' and not is_active`)).map((x) => x.id);
    await t.rows(`update model_scheme set is_active = true where id = any($1::uuid[])`, [off]);
    try {
      const r = await t.rows(`select kind, expected, actual, ok from ship_spec_check($1,$2)`, [lot, lines.PD05050510]);
      t.eq(r.map((x) => `${x.kind}:${x.expected}/${x.actual}:${x.ok}`).join(' '),
        'LOT:PD05050510/PD05050510:true DMR:PD05050510/PD05050510:true BAND:0510/1015:false', '검토 세 줄');
      await t.rejects(() => ship(t, m, lot, lines.PD05050510), { code: 'P0001', message: '원료 두께' });
    } finally {
      await t.rows(`update model_scheme set is_active = false where id = any($1::uuid[])`, [off]);
    }
  },
},

{
  id: 'SO-11', expect: '통과',
  name: '원료 두께가 비어 있으면 두께는 볼 수 없음으로 두고 막지 않는다',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SO11', lines: [['PD05050510', 10]] });
    const { lot } = await readyLot(t, m, { band: null });
    const r = await t.rows(`select kind, ok from ship_spec_check($1,$2)`, [lot, lines.PD05050510]);
    t.eq(r.map((x) => `${x.kind}:${x.ok}`).join(' '), 'LOT:true DMR:true BAND:null', '검토 세 줄');
    await t.resolves(() => ship(t, m, lot, lines.PD05050510));
  },
},

{
  id: 'SO-12', expect: '통과',
  name: '주문 남은 양보다 많이 출고해도 받고, 남음은 음수 · 상태는 출고 완료',
  async run(t) {
    const m = await master(t);
    const { order: o, lines } = await order(t, m, { po: 'SO12', lines: [['PD05050510', 5]] });
    const { lot } = await readyLot(t, m);
    await t.resolves(() => ship(t, m, lot, lines.PD05050510, 10));
    t.eq(await t.val(`select so_line_left($1)`, [lines.PD05050510]), -5, '남음');
    t.eq(await t.val(`select so_status($1)`, [o]), 'DONE', '상태');
    await t.rejects(
      () => t.rows(`update sales_order_line set qty = 9 where id = $1`, [lines.PD05050510]),
      { code: 'P0001', message: '줄일 수 없' });
  },
},

{
  id: 'SO-13', expect: '예외',
  name: '취소된 주문서의 줄에는 출고를 붙이지 않는다',
  async run(t) {
    const m = await master(t);
    const { order: o, lines } = await order(t, m, { po: 'SO13', lines: [['PD05050510', 10]] });
    await t.rows(`update sales_order set cancelled_at = now(), cancel_reason = '시험' where id = $1`, [o]);
    const { lot } = await readyLot(t, m);
    await t.rejects(() => ship(t, m, lot, lines.PD05050510), { code: 'P0001', message: '취소' });
  },
},

{
  id: 'SO-14', expect: '예외 · 통과',
  name: '출고의 주문 바꾸기는 사유가 있어야 하고, 바꿀 줄도 형명 검토를 받는다',
  async run(t) {
    const m = await master(t);
    const a = (await order(t, m, { po: 'SO14A', lines: [['PD05050510', 100]] })).lines.PD05050510;
    const b = (await order(t, m, { po: 'SO14B', lines: [['PD05050510', 100]] })).lines.PD05050510;
    const c = (await order(t, m, { po: 'SO14C', lines: [['PD10150510', 100]] })).lines.PD10150510;
    const { lot } = await readyLot(t, m);
    const id = await ship(t, m, lot, a, 1);
    const relink = (line) => t.rows(`update shipment set sales_order_line_id = $2 where id = $1`, [id, line]);

    await t.rejects(() => relink(b), { code: 'P0001', message: '사유' });
    await t.rows(`select set_config('app.change_reason', '시험 - 주문을 잘못 고름', false)`);
    try {
      await t.resolves(() => relink(b));
      t.eq(await t.val(`select so_line_left($1)`, [a]), 100, '앞 줄은 남음이 돌아온다');
      t.eq(await t.val(`select so_line_left($1)`, [b]), 99, '새 줄에서 준다');
      await t.rejects(() => relink(c), { code: 'P0001', message: '제품 로트 형명' });
      await t.rejects(() => relink(null), { code: 'P0001', message: '뗄 수 없' });
    } finally {
      await t.rows(`select set_config('app.change_reason', '', false)`);
    }
  },
},

];
