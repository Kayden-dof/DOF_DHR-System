// =============================================================================
// 40_sales_order.mjs - 수주 장부 · 출고는 주문 줄로 · 형명 일괄 검토 (0159)
// 근거: 사용자 2026-11-25 «DHR 은 주문 장부와 출고 연결에만 집중하면 됨.» · «B 주문서+줄 (권고)» ·
//       «출고할때 발주 업체리스트에서 선택하고, 발주 형명이 맞는지 작업지시서 및 제조기록서 일괄
//       검토해서 출고시 오규격이 나가지 않도록 흐름을 그렇게 짜줘.»
//
// 고객이 낸 주문을 주문서(머리) + 형명 줄로 적고, 남은 수량 · 상태는 출고 표에서 센다(저장하지 않는다).
// =============================================================================

import { masterData as master } from '../fixtures.mjs';

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

];
