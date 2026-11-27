// =============================================================================
// 40_sales_order.mjs - 수주 장부 · 출고는 주문 줄로 · 형명 일괄 검토 (0159)
// 근거: 사용자 2026-11-25 «DHR 은 주문 장부와 출고 연결에만 집중하면 됨.» · «B 주문서+줄 (권고)» ·
//       «출고할때 발주 업체리스트에서 선택하고, 발주 형명이 맞는지 작업지시서 및 제조기록서 일괄
//       검토해서 출고시 오규격이 나가지 않도록 흐름을 그렇게 짜줘.»
//
// 고객이 낸 주문을 주문서(머리) + 형명 줄로 적고, 남은 수량 · 상태는 출고 표에서 센다(저장하지 않는다).
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder, sterilReport } from '../fixtures.mjs';
import { gtinOf, findModel } from '../../lib/model-find.ts';
import { cutRowCheck, specMessage } from '../../lib/ship-check.ts';

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

/** 재단 · 포장한 로트 하나에 멸균 위탁 steril 개만 보고서와 함께 (0180 시험) */
async function partlySterile(t, m, { qty = 30, steril = 10 } = {}) {
  const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
  const wo = await newWorkOrder(t, m, { rawLot });
  await t.setActor(m.admin);
  const item = await t.val(`select id from item where code = 'PD05050510'`);
  const lot = await t.val(`select cut_product_lot($1,$2,$3,0)`, [wo.id, item, qty]);
  await t.rows(`update product_lot set status = 'PACKED' where id = $1`, [lot]);
  const sb = await t.val(
    `insert into steril_batch (batch_no, vendor_name, registered_by, shipped_at, received_at, cert_no)
     values ('ST-SX-' || substr(md5(random()::text), 1, 10), '시험 멸균처', $1, current_date, current_date,
             'SR-SX-' || substr(md5(random()::text), 1, 6)) returning id`, [m.admin]);
  await t.rows(`insert into steril_batch_lot (steril_batch_id, product_lot_id, qty) values ($1,$2,$3)`, [sb, lot, steril]);
  return lot;
}
const lotRow = (t, lot) => t.one(`select lot_no, qty_available, status::text as status from product_lot where id = $1`, [lot]);

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
      () => t.rows(`update sales_order_line set qty = 4 where id = $1`, [lines.PD05050510]),
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


{
  id: 'SC-01', expect: '확인',
  name: '형명 · UDI 찾기는 형명 코드 · UDI-DI · 라벨 바코드 글을 받는다',
  async run(t) {
    for (const s of ['(01)08809911220376', '0108809911220376172811101026111001', '08809911220376', '8809911220376']) {
      t.eq(gtinOf(s), '08809911220376', s);
    }
    t.eq(gtinOf('PD05050510'), null, '형명 코드는 GTIN 이 아니다');
    const pool = [{ code: 'PD10182025', udi: '08809911220999' }, { code: 'PD05050510', udi: '08809911220376' }];
    t.eq(findModel('pd 0505 0510', pool)?.code, 'PD05050510', '띄어쓰기 · 소문자');
    t.eq(findModel('(01)08809911220376', pool)?.code, 'PD05050510', '바코드');
    t.eq(findModel('PD0505', pool), undefined, '반만 맞으면 없음');
    t.eq(findModel('', pool), undefined, '빈 칸');
  },
},

{
  id: 'SC-02', expect: '확인',
  name: '재단 줄은 손으로 적은 제조번호의 붙임표 자리가 달라도 그 로트 줄로 찾는다',
  async run(t) {
    const cells = [
      { row: 7, role: 'cutlot', value: 'GM261110-02' }, { row: 7, role: 'model', value: 'PD05050510' },
      { row: 5, role: 'cutlot', value: 'GM261110-01' }, { row: 5, role: 'model', value: 'pd1018 2025' },
      { row: 5, role: 'qty', value: '20' },
    ];
    const r = cutRowCheck(cells, 'GM-26111001', 1, 'PD10182025');
    t.eq(`${r.ok}/${r.row}/${r.actual}`, 'true/5/pd1018 2025', '제조번호로 찾은 줄 (n번째가 아니라)');
  },
},

{
  id: 'SC-03', expect: '확인',
  name: '재단 줄 모델명이 주문 형명과 다르면 다름',
  async run(t) {
    const cells = [{ row: 3, role: 'cutlot', value: 'P2611-0001' }, { row: 3, role: 'model', value: 'PD05050510' }];
    const r = cutRowCheck(cells, 'P2611-0001', 0, 'PD10182025');
    t.eq(`${r.ok}/${r.row}/${r.actual}`, 'false/3/PD05050510', '다름');
  },
},

{
  id: 'SC-04', expect: '확인',
  name: '재단 칸이 없으면 볼 수 없음, 로트 줄이 없으면 다름, 제조번호 칸이 비면 n번째 줄',
  async run(t) {
    t.eq(cutRowCheck([], 'P1', 0, 'PD05050510').ok, null, '양식 없음');
    const one = [{ row: 2, role: 'cutlot', value: '' }, { row: 2, role: 'model', value: 'PD05050510' }];
    const miss = cutRowCheck(one, 'P2', 1, 'PD05050510');
    t.eq(`${miss.ok}/${miss.row}/${miss.actual}`, 'false/null/null', '둘째 로트인데 줄이 하나');
    const nth = cutRowCheck(one, 'P1', 0, 'PD05050510');
    t.eq(`${nth.ok}/${nth.row}`, 'true/2', '제조번호 칸이 비면 첫째 로트 = 첫째 줄');
  },
},


{
  id: 'SC-05', expect: '확인',
  name: '다른 검토 줄은 주문 형명과 실제 값을 함께 말한다',
  async run(t) {
    const m = specMessage({ kind: 'BAND', label: '작업지시서 원료 두께', expected: '0510', actual: '1015', ok: false });
    t.ok(m.includes('작업지시서 원료 두께') && m.includes('주문 0510') && m.includes('실제 1015'), m);
    t.ok(specMessage({ kind: 'BR', label: '제조기록서 재단 줄 모델명', expected: 'PD05050510', actual: null, ok: false })
      .includes('이 제조번호의 줄이 없습니다'), '재단 줄이 없을 때');
    t.ok(specMessage({ kind: 'STERIL', label: '멸균 보고서', expected: null, actual: null, ok: false })
      .includes('멸균 보고서가 없습니다'), '멸균 보고서');
  },
},


{
  id: 'SO-15', expect: '통과 · 예외',
  name: '작업지시서 하나에 주문 줄을 여럿 걸고, 같은 줄은 한 번만',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SO15', lines: [['PD05050510', 10]] });
    const lines2 = (await order(t, m, { po: 'SO15B', lines: [['PD05050510', 20]] })).lines;
    const { wo } = await readyLot(t, m);
    const link = (line) => t.rows(
      `insert into work_order_so_line (work_order_id, sales_order_line_id, linked_by) values ($1,$2,$3)`,
      [wo.id, line, m.admin]);
    await t.resolves(() => link(lines.PD05050510));
    await t.resolves(() => link(lines2.PD05050510));
    await t.rejects(() => link(lines.PD05050510), { code: '23505' });
    t.eq(await t.val(`select count(*)::int from work_order_so_line where work_order_id = $1`, [wo.id]), 2, '두 줄');
  },
},

{
  id: 'SO-16', expect: '예외',
  name: '작업지시서에는 그 제품의 형명 줄만, 취소된 주문 줄은 걸지 않는다',
  async run(t) {
    const m = await master(t);
    await t.rows(
      `insert into item (code, name, type, purchase_uom, usage_uom, shelf_life_months)
       values ('SOX9999', '다른 제품 완제품', 'FIN', 'EA', 'EA', 24) on conflict do nothing`);
    const other = (await order(t, m, { po: 'SO16', lines: [['SOX9999', 5]] })).lines.SOX9999;
    const { order: o, lines } = await order(t, m, { po: 'SO16B', lines: [['PD05050510', 5]] });
    const { wo } = await readyLot(t, m);
    const link = (line) => t.rows(
      `insert into work_order_so_line (work_order_id, sales_order_line_id, linked_by) values ($1,$2,$3)`,
      [wo.id, line, m.admin]);
    await t.rejects(() => link(other), { code: 'P0001', message: '형명이 아닙니다' });
    await t.rows(`update sales_order set cancelled_at = now(), cancel_reason = '시험' where id = $1`, [o]);
    await t.rejects(() => link(lines.PD05050510), { code: 'P0001', message: '취소' });
  },
},

{
  id: 'SO-17', expect: '예외 · 통과',
  name: '작업지시서의 주문 줄 떼기는 사유가 있어야 하고 되돌리지 않는다, 뗀 뒤 다시 걸 수 있다',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SO17', lines: [['PD05050510', 10]] });
    const { wo } = await readyLot(t, m);
    const ins = () => t.val(
      `insert into work_order_so_line (work_order_id, sales_order_line_id, linked_by) values ($1,$2,$3) returning id`,
      [wo.id, lines.PD05050510, m.admin]);
    const id = await ins();
    await t.rejects(() => t.rows(`update work_order_so_line set unlinked_at = now() where id = $1`, [id]), { code: '23514' });
    await t.rows(`update work_order_so_line set unlinked_at = now(), unlink_reason = '시험' where id = $1`, [id]);
    await t.rejects(
      () => t.rows(`update work_order_so_line set unlinked_at = null, unlink_reason = null where id = $1`, [id]),
      { code: 'P0001' });
    await t.resolves(ins);
  },
},

{
  id: 'SO-18', expect: '통과',
  name: '작업지시서에 걸린 주문 줄이 아니어도 재고가 있으면 출고한다',
  async run(t) {
    const m = await master(t);
    const a = (await order(t, m, { po: 'SO18A', lines: [['PD05050510', 10]] })).lines.PD05050510;
    const b = (await order(t, m, { po: 'SO18B', lines: [['PD05050510', 10]] })).lines.PD05050510;
    const { lot, wo } = await readyLot(t, m);
    await t.rows(
      `insert into work_order_so_line (work_order_id, sales_order_line_id, linked_by) values ($1,$2,$3)`,
      [wo.id, a, m.admin]);
    await t.resolves(() => ship(t, m, lot, b, 3));
    t.eq(await t.val(`select so_line_left($1)`, [b]), 7, '걸리지 않은 주문에서 준다');
  },
},


{
  id: 'SO-19', expect: '통과 · 예외',
  name: '넘게 나간 줄도 주문 수량을 늘리는 고치기는 받고, 더 줄이는 것만 막는다',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SO19', lines: [['PD05050510', 5]] });
    const { lot } = await readyLot(t, m);
    await ship(t, m, lot, lines.PD05050510, 10);
    const set = (q) => t.rows(`update sales_order_line set qty = $2 where id = $1`, [lines.PD05050510, q]);
    await t.resolves(() => set(8));
    await t.rejects(() => set(7), { code: 'P0001', message: '줄일 수 없' });
    await t.resolves(() => set(12));
    await t.rejects(() => set(9), { code: 'P0001', message: '줄일 수 없' });
  },
},

{
  id: 'SO-20', expect: '통과 · 예외',
  name: '취소한 형명 줄은 같은 주문에 다시 더할 수 있고, 살아 있는 같은 형명 줄은 하나',
  async run(t) {
    const m = await master(t);
    const { order: o, lines } = await order(t, m, { po: 'SO20', lines: [['PD05050510', 5], ['PD10150510', 5]] });
    await t.rows(`update sales_order_line set cancelled_at = now(), cancel_reason = '시험' where id = $1`, [lines.PD05050510]);
    const add = () => t.rows(
      `insert into sales_order_line (sales_order_id, item_id, qty, seq)
       values ($1, (select id from item where code = 'PD05050510'), 7, 3)`, [o]);
    await t.resolves(add);
    await t.rejects(add, { code: '23505' });
  },
},

{
  id: 'SO-21', expect: '확인',
  name: '원료 두께는 영문 · 숫자만 견준다 (05-10 = 0510)',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SO21', lines: [['PD05050510', 10]] });
    const { lot } = await readyLot(t, m, { band: '05-10' });
    const off = (await t.rows(`select id from model_scheme where prefix = 'PD' and not is_active`)).map((x) => x.id);
    await t.rows(`update model_scheme set is_active = true where id = any($1::uuid[])`, [off]);
    try {
      t.eq(await t.val(`select ok from ship_spec_check($1,$2) where kind = 'BAND'`, [lot, lines.PD05050510]),
        true, '표기만 다른 두께');
    } finally {
      await t.rows(`update model_scheme set is_active = false where id = any($1::uuid[])`, [off]);
    }
  },
},

{
  id: 'SC-06', expect: '확인',
  name: '재단 기록이 여러 회차면 제조번호가 맞는 줄만 보고, 어느 회차에도 없을 때만 막는다',
  async run(t) {
    const { brReview } = await import('../../lib/ship-check.ts');
    const rec = (rows) => rows.flatMap(([lot, model], i) => [
      { row: i, role: 'cutlot', value: lot }, { row: i, role: 'model', value: model }]);
    /* 첫날 로트 1~3, 둘째 날 기록서 1~3 줄에 그날 로트 4~6 을 손으로 적었다 */
    const sets = [
      rec([['P-1', 'PD05050510'], ['P-2', 'PD05050510'], ['P-3', 'PD10150510']]),
      rec([['P-4', 'PD05050510'], ['P-5', 'PD05050510'], ['P-6', 'PD10150510']]),
    ];
    const r = (lot, idx, code) => { const x = brReview(sets, lot, idx, code); return `${x.ok}/${x.actual}`; };
    t.eq(r('P-1', 0, 'PD05050510'), 'true/PD05050510', '첫 회차에만 있는 로트');
    t.eq(r('P-5', 4, 'PD05050510'), 'true/PD05050510', '둘째 회차에만 있는 로트');
    t.eq(r('P-3', 2, 'PD05050510'), 'false/PD10150510', '모델명이 다르면 다름');
    t.eq(r('P-9', 8, 'PD05050510'), 'false/null', '어느 회차에도 없으면 막는다');
    t.eq(brReview([], 'P-1', 0, 'PD05050510').ok, null, '재단 기록서가 없으면 볼 수 없음');
  },
},

{
  id: 'SC-07', expect: '확인',
  name: '기록서 채우기가 재단 줄의 제조번호 · 모델명 · 수량을 돌려주고, 적은 값이 이긴다',
  async run(t) {
    /* 칸 이름(제조번호 · 모델명 · 수량)이 역할로 읽히지 않으면 출고 검토가 조용히 «볼 수 없음» 이 된다 */
    const { fillForm } = await import('../../lib/br-form.ts');
    const row = () => ({ h: 20, cells: [{ c: 0 }, { c: 1 }, { c: 2 }] });
    const form = { page: { w: 800, h: 600 }, pages: [{ texts: [], tables: [{
      x: 0, y: 0, w: 300, cols: [100, 100, 100],
      rows: [{ h: 20, cells: [{ c: 0, t: '제조번호' }, { c: 1, t: '모델명' }, { c: 2, t: '수량' }] }, row(), row()] }] }] };
    const base = { batchNo: 'B1', productLotNo: null, productModel: null, rawItemCode: 'RM', rawLotNo: 'RL',
      sheets: 1, loadUnit: null, worker: '갑', workDate: '2026-11-25', issues: [], notes: [],
      cutLots: [{ lot_no: 'P-1', code: 'PD05050510', qty: 20 }, { lot_no: 'P-2', code: 'PD10150510', qty: 5 }] };
    const flat = (cut) => cut.map((c) => `${c.row}${c.role}=${c.value}`).join(' ');
    t.eq(flat(fillForm(form, { ...base, entries: {} }).cut),
      '0cutlot=P-1 0model=PD05050510 0qty=20 1cutlot=P-2 1model=PD10150510 1qty=5', '채운 값');
    const written = fillForm(form, { ...base, entries: { p0t0r1c1: { value: 'PD99999999', by: '갑', at: '2026-11-25' } } });
    t.eq(written.cut.find((c) => c.row === 0 && c.role === 'model')?.value, 'PD99999999', '적은 값이 이긴다');
  },
},


{
  id: 'SO-22', expect: '예외',
  name: '출고의 제조번호는 바꾸지 않는다 (형명 검토 · 출하 가능 수량을 건너뛰는 길)',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SO22', lines: [['PD05050510', 10]] });
    const a = await readyLot(t, m);
    const b = await readyLot(t, m);
    const id = await ship(t, m, a.lot, lines.PD05050510, 1);
    await t.rejects(() => t.rows(`update shipment set product_lot_id = $2 where id = $1`, [id, b.lot]),
      { code: 'P0001', message: '제조번호' });
    await t.resolves(() => t.rows(`update shipment set customer_name = '시험 고객사 (정정)' where id = $1`, [id]));
  },
},

{
  id: 'SO-23', expect: '통과',
  name: '쓰지 않음으로 바꾼 형명이라도 그 배치가 만든 재고는 출고한다',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SO23', lines: [['PD05050510', 10]] });
    const { lot } = await readyLot(t, m);
    await t.rows(`update item set is_active = false where code = 'PD05050510'`);
    try {
      t.eq(await t.val(`select ok from ship_spec_check($1,$2) where kind = 'DMR'`, [lot, lines.PD05050510]),
        true, '이 배치가 만든 형명');
      await t.resolves(() => ship(t, m, lot, lines.PD05050510, 1));
    } finally {
      await t.rows(`update item set is_active = true where code = 'PD05050510'`);
    }
  },
},

{
  id: 'SX-01', expect: '통과',
  name: '출고를 지우면 그 수량이 로트로 돌아가고 출고 완료 로트는 출고 전 상태로 (0180)',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SX01', lines: [['PD05050510', 30]] });
    const { lot } = await readyLot(t, m, { qty: 30 });
    const id = await ship(t, m, lot, lines.PD05050510, 30);
    t.eq((await lotRow(t, lot)).status, 'SHIPPED', '다 나가면 출고 완료');
    t.eq(await t.val(`select lot_status_before::text from shipment where id = $1`, [id]), 'PACKED', '출고 전 상태를 남긴다');
    await t.rows(`delete from shipment where id = $1`, [id]);
    const r = await lotRow(t, lot);
    t.eq(Number(r.qty_available), 30, '수량이 돌아온다');
    t.eq(r.status, 'PACKED', '출고 전 상태로');
    t.eq(await t.val(`select so_line_shipped($1)`, [lines.PD05050510]), 0, '주문 출고에서도 빠진다');
    /* 일부만 나간 로트는 상태가 그대로이고 수량만 돌아온다 */
    const id2 = await ship(t, m, lot, lines.PD05050510, 5);
    await t.rows(`delete from shipment where id = $1`, [id2]);
    t.eq(Number((await lotRow(t, lot)).qty_available), 30, '일부 출고를 지워도 수량이 돌아온다');
  },
},

{
  id: 'SX-02', expect: '거부',
  name: '출고 수량은 고쳐 쓰지 않는다 - 지우고 다시 적는다 (0180)',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SX02', lines: [['PD05050510', 10]] });
    const { lot } = await readyLot(t, m);
    const id = await ship(t, m, lot, lines.PD05050510, 5);
    await t.rejects(() => t.rows(`update shipment set qty = 6 where id = $1`, [id]),
      { code: 'P0001', message: '출고 수량은 고쳐 쓰지 않습니다' });
  },
},

{
  id: 'SX-03', expect: '통과',
  name: '멸균 보고서가 있는 수량까지만 나간다 - 생략한 로트는 수량을 보지 않는다 (0180 · 사용자 «막기»)',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SX03', lines: [['PD05050510', 100]] });
    const lot = await partlySterile(t, m, { qty: 30, steril: 10 });
    t.eq(await t.val(`select lot_ship_left($1)`, [lot]), 10, '지금 나갈 수 있는 수량은 멸균 보고서가 있는 10');
    await t.resolves(() => ship(t, m, lot, lines.PD05050510, 8));
    t.eq(await t.val(`select lot_ship_left($1)`, [lot]), 2, '8 이 나가면 2');
    await t.rejects(() => ship(t, m, lot, lines.PD05050510, 3),
      { code: 'P0001', message: '멸균 보고서가 있는 수량' });
    await t.rejects(() => ship(t, m, lot, lines.PD05050510, 999),
      { code: 'P0001', message: '출하 가능 수량' });
    await t.rows(`insert into steril_report_skip (product_lot_id, reason, skipped_by) values ($1, '시험 생략', $2)`, [lot, m.admin]);
    t.eq(await t.val(`select lot_ship_left($1)`, [lot]), 22, '생략하면 남은 수량 그대로');
    await t.resolves(() => ship(t, m, lot, lines.PD05050510, 5));
  },
},

{
  id: 'SX-04', expect: '통과',
  name: '출고할 수 있는 수량은 상태도 본다 - 재단 · 폐기 로트는 0 (0180)',
  async run(t) {
    const m = await master(t);
    const { lot } = await readyLot(t, m);
    t.ok(await t.val(`select lot_ship_left($1)`, [lot]) > 0, '포장 · 멸균 보고서가 있으면 나간다');
    await t.rows(`update product_lot set status = 'DISPOSED' where id = $1`, [lot]);
    t.eq(await t.val(`select lot_ship_left($1)`, [lot]), 0, '폐기 로트는 0');
    await t.rows(`update product_lot set status = 'CUT' where id = $1`, [lot]);
    t.eq(await t.val(`select lot_ship_left($1)`, [lot]), 0, '재단만 한 로트는 0');
  },
},

{
  id: 'SX-05', expect: '통과',
  name: '개체 찾기가 순번 없이 나간 출고를 안다 - 다 나갔으면 출고됨, 남았으면 일부 출고 (0180)',
  async run(t) {
    const m = await master(t);
    const { lines } = await order(t, m, { po: 'SX05', lines: [['PD05050510', 30]] });
    const { lot } = await readyLot(t, m, { qty: 30 });
    const no = (await lotRow(t, lot)).lot_no;
    const unit = () => t.one(`select standing, customer_name from find_unit($1)`, [no + '-005']);
    t.eq((await unit()).standing, '재고', '나가기 전에는 재고');
    await ship(t, m, lot, lines.PD05050510, 10);
    t.eq((await unit()).standing, '일부 출고 (개체 미상)', '일부만 나가면 어느 개체인지 모른다');
    await ship(t, m, lot, lines.PD05050510, 20);
    const u = await unit();
    t.eq(u.standing, '출고됨', '다 나가면 출고됨');
    t.eq(u.customer_name, '시험 고객사', '출고처');
  },
},

];
