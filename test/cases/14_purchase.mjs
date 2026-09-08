// =============================================================================
// 14_purchase.mjs · 발주와 입고 (§4.4 · 0102)
//
// 발주는 나눠 들어올 수 있다. 전에는 첫 로트 하나만 붙어도 발주가 통째로
// 입고 완료가 되어, 두 번째 입고를 그 발주에 못 붙이고 최소 재고선 알림도
// 남은 미입고분을 못 셌다.
//
// 시스템은 여기서 판정하지 않는다. 무엇이 합격인지 묻지 않고, 적힌 수량을
// 더해 발주 수량에 닿았는지만 본다. 많이 들어와도 막지 않는다 (§2).
// =============================================================================

import { masterData as master, newMaterialLot } from '../fixtures.mjs';

/** 발주 하나. 수량은 사용 단위다 (§4.2) */
async function newOrder(t, m, itemId, qty, opts = {}) {
  return t.val(
    `insert into purchase_order (po_no, item_id, supplier_id, qty, unit_price,
       ordered_at, ordered_by, status)
     values ($1,$2,$3,$4,$5, current_date, $6, $7) returning id`,
    [opts.po_no ?? `PO-T-${Math.random().toString(36).slice(2, 9)}`,
     itemId, opts.supplier ?? m.supplier, qty, opts.price ?? 1000, m.admin,
     opts.status ?? 'ORDERED']);
}

/** 그 발주로 자재를 넣는다. */
async function receive(t, m, po, itemId, qty) {
  return newMaterialLot(t, m, itemId, { qty, po });
}

const stateOf = (t, po) =>
  t.one(`select status, po_received(id)::numeric as got from purchase_order where id = $1`,
        [po]);

export default [

{
  id: 'PO-01', expect: '통과',
  name: '절반만 들어오면 발주중으로 남는다',
  async run(t) {
    const m = await master(t);
    const po = await newOrder(t, m, m.reagent, 20);
    await receive(t, m, po, m.reagent, 8);

    const s = await stateOf(t, po);
    t.eq(Number(s.got), 8, '입고 누계');
    t.eq(s.status, 'ORDERED', '발주 상태');
  },
},

{
  id: 'PO-02', expect: '통과',
  name: '나머지가 들어오면 입고 완료로 넘어간다',
  async run(t) {
    const m = await master(t);
    const po = await newOrder(t, m, m.reagent, 20);
    await receive(t, m, po, m.reagent, 8);
    await receive(t, m, po, m.reagent, 12);

    const s = await stateOf(t, po);
    t.eq(Number(s.got), 20, '입고 누계');
    t.eq(s.status, 'RECEIVED', '발주 상태');
  },
},

{
  id: 'PO-03', expect: '통과',
  name: '두 번째 입고도 같은 발주에 붙는다',
  async run(t) {
    const m = await master(t);
    const po = await newOrder(t, m, m.reagent, 20);
    await receive(t, m, po, m.reagent, 8);

    /*
     * 화면의 "연결할 발주" 고르개는 status='ORDERED' 만 담는다. 절반 들어온
     * 발주가 거기 남아 있지 않으면 나머지를 붙일 자리가 없다 - 그것이 이
     * 이관을 만든 까닭이다.
     */
    const open = await t.val(
      `select count(*)::int from purchase_order where id = $1 and status = 'ORDERED'`, [po]);
    t.eq(open, 1, '고르개에 남아 있는가');

    await receive(t, m, po, m.reagent, 12);
    t.eq((await stateOf(t, po)).status, 'RECEIVED', '마저 붙인 뒤');
  },
},

{
  id: 'PO-04', expect: '통과',
  name: '발주보다 많이 들어와도 막지 않는다',
  async run(t) {
    const m = await master(t);
    const po = await newOrder(t, m, m.reagent, 10);
    await t.resolves(() => receive(t, m, po, m.reagent, 25));

    const s = await stateOf(t, po);
    t.eq(Number(s.got), 25, '입고 누계');
    t.eq(s.status, 'RECEIVED', '발주 상태');
  },
},

{
  id: 'PO-05', expect: '통과',
  name: '취소된 발주는 물건이 들어와도 취소로 남는다',
  async run(t) {
    const m = await master(t);
    const po = await newOrder(t, m, m.reagent, 10, { status: 'CANCELLED' });
    await receive(t, m, po, m.reagent, 10);

    /* 취소는 사람이 내린 결정이다. 뒤늦게 물건이 왔다고 시스템이 되돌리지 않는다 */
    t.eq((await stateOf(t, po)).status, 'CANCELLED', '발주 상태');
  },
},

{
  id: 'PO-06', expect: '통과',
  name: '최소 재고선은 아직 안 온 만큼만 발주중으로 센다',
  async run(t) {
    const m = await master(t);
    /* 재고를 0 으로 두고 기준선을 세운다 */
    await t.rows(`update item set min_stock = 100 where id = $1`, [m.reagent2]);

    const po = await newOrder(t, m, m.reagent2, 60);
    const before = await t.one(
      `select on_hand::numeric as h, on_order::numeric as n
         from v_reorder_alert where id = $1`, [m.reagent2]);
    t.eq(Number(before.n), 60, '입고 전 발주중');

    await receive(t, m, po, m.reagent2, 25);
    const after = await t.one(
      `select on_hand::numeric as h, on_order::numeric as n
         from v_reorder_alert where id = $1`, [m.reagent2]);

    /*
     * 전에는 발주 수량을 통째로 셌다. 25 가 들어와 재고로 잡혔는데 발주중도
     * 60 그대로라, 보유 + 발주중이 85 로 부풀었다.
     *
     * 보유는 늘어난 만큼으로 본다 - 이 시험은 자료가 쌓인 DB 를 물려받으므로
     * 절대값을 박으면 앞 시험이 뭘 넣었는지에 따라 흔들린다.
     */
    t.eq(Number(after.n), 35, '남은 발주중');
    t.eq(Number(after.h) - Number(before.h), 25, '늘어난 보유');
  },
},

{
  id: 'PO-07', expect: '통과',
  name: '상태가 그대로면 감사추적에 빈 변경을 쌓지 않는다',
  async run(t) {
    const m = await master(t);
    const po = await newOrder(t, m, m.reagent, 30);

    const seen = () => t.val(
      `select count(*)::int from audit_log
        where table_name = 'purchase_order' and record_id = $1 and action = 'UPDATE'`, [po]);

    await receive(t, m, po, m.reagent, 5);
    const a = await seen();
    await receive(t, m, po, m.reagent, 5);
    const b = await seen();

    /*
     * 둘 다 ORDERED 인 채다. 같은 값을 다시 써도 트리거는 UPDATE 를 잡으므로,
     * 막지 않으면 로트를 넣을 때마다 "발주를 바꿨다" 가 쌓여 진짜 변경이
     * 그 속에 묻힌다 (§10).
     */
    t.eq(b, a, '빈 변경이 늘지 않았는가');

    await receive(t, m, po, m.reagent, 20);
    t.eq((await seen()) > b, true, '실제로 넘어갈 때는 남는가');
  },
},

];
