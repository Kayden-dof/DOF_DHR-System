// =============================================================================
// 28_consumable_stock.mjs - 로트 없이 쓰는 소모품의 재고 (0144)
// 근거: 사용자 2026-11-20 «로트 번호가 없는건 재고 증감을 못하는건가.. 타이벡 파우치같은건
//       로트 번호가 없는걸...?» → «자동 차감까지»
//
// 소모품만 성적서 · 공급자 로트 없이 입고되는지 (로트 기록 품목은 S02 그대로), 공정 마감이
// 구성표 소요량만큼 오래된 입고부터 자동 투입하는지, 두 번 불러도 한 번인지, 미사용 사유면
// 하지 않는지, 재고가 모자라도 마감은 되는지 본다.
//
// 시험 기준정보의 H2O2 시약(WS-DX2401-04, 장입 구간 1/2/3 통)을 잠시 소모품으로 바꿔 쓰고
// 끝나면 되돌린다 - 기준정보는 시험 파일들이 나눠 쓴다.
// =============================================================================

import { masterData as master, newWorkOrder, newMaterialLot } from '../fixtures.mjs';

async function asUser(t, userId, fn) {
  await t.rows(`select set_config('app.user_id', $1, false)`, [userId ?? '']);
  try {
    return await t.asRole('app_role', fn);
  } finally {
    await t.rows(`select set_config('app.user_id', '', false)`);
  }
}

async function started(t, m, wo, opts = {}) {
  await t.setActor(m.admin);
  const id = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date,
       worker_id, no_material_reason, started_at)
     values ($1,$2,1,current_date,$3,$4, now() - interval '5 minutes') returning id`,
    [wo.id, m.ops['WS-DX2401-04'], m.worker, opts.reason ?? null]);
  await t.setActor(null);
  return id;
}

/* 소모품 입고 로트 (성적서 · 공급자 로트 없이) */
const looseLot = (t, m, item, qty, daysAgo) => t.val(
  `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no, coa_no, coa_date,
     received_at, registered_by, qty_received, qty_available)
   values ($1, next_number('MATERIAL_LOT'), $2, '', null, null,
           now() - make_interval(days => $3::int), $4, $5, $5) returning id`,
  [item, m.supplier, daysAgo, m.admin, qty]);

async function withLoose(t, m, fn) {
  await t.rows(`update item set lot_tracked = false where id = $1`, [m.reagent2]);
  try {
    return await fn();
  } finally {
    await t.rows(`update item set lot_tracked = true where id = $1`, [m.reagent2]);
  }
}

export default [

{
  id: 'CS-01', expect: '통과',
  name: '소모품은 성적서 · 공급자 로트 없이 입고된다 · 로트를 기록하는 품목은 S02 로 막힌다',
  async run(t) {
    const m = await master(t);
    await t.rejects(() => t.val(
      `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no, coa_no, coa_date,
         received_at, registered_by, qty_received, qty_available)
       values ($1, next_number('MATERIAL_LOT'), $2, null, null, null, now(), $3, 5, 5) returning id`,
      [m.reagent, m.supplier, m.admin]), { message: 'S02' });
    await withLoose(t, m, async () => {
      const id = await looseLot(t, m, m.reagent2, 5, 0);
      const r = await t.rows(`select supplier_lot_no, coa_no, coa_date from material_lot where id = $1`, [id]);
      t.eq(r[0], { supplier_lot_no: null, coa_no: null, coa_date: null }, '빈 칸은 비운 채로');
    });
    /* 다시 로트를 기록하는 품목이 되면 그 품목의 새 입고는 S02 로 막힌다 */
    await t.rejects(() => looseLot(t, m, m.reagent2, 5, 0), { message: 'S02' });
  },
},

{
  id: 'CS-02', expect: '통과',
  name: '공정 마감이 소요량만큼 오래된 입고부터 자동 투입 · 두 번 불러도 한 번 · 미사용 사유면 하지 않음',
  async run(t) {
    const m = await master(t);
    await withLoose(t, m, async () => {
      const wo = await newWorkOrder(t, m);                 // 20장 → 구간 11~20 → 2 통
      const old = await looseLot(t, m, m.reagent2, 1, 400);  // 가장 오래된 입고
      await looseLot(t, m, m.reagent2, 5, 399);
      const before = await t.val(
        `select coalesce(sum(qty_available),0)::numeric from material_lot where item_id = $1`, [m.reagent2]);

      const pr = await started(t, m, wo);
      await asUser(t, m.worker, () => t.rows(`select complete_process_at($1, now())`, [pr]));
      t.eq(await t.val(`select sum(qty)::numeric::text from material_issue where process_record_id = $1`, [pr]),
        '2', '소요량 2 통 투입');
      t.eq(await t.val(`select qty_available::numeric::text from material_lot where id = $1`, [old]), '0',
        '오래된 입고부터');
      t.eq(await t.val(
        `select coalesce(sum(qty_available),0)::numeric from material_lot where item_id = $1`, [m.reagent2]),
        String(Number(before) - 2), '재고 2 줄어듦');

      /* 마감을 다시 불러도 다시 차감하지 않는다 */
      await asUser(t, m.worker, () => t.rows(`select complete_process_at($1, now())`, [pr]));
      t.eq(await t.val(`select count(*)::int from material_issue where process_record_id = $1`, [pr]), 2,
        '두 번 불러도 한 번');

      /* 자재 미사용 사유로 마감하면 차감하지 않는다 */
      const pr2 = await started(t, m, await newWorkOrder(t, m), { reason: '해당 공정 미실시' });
      await asUser(t, m.worker, () => t.rows(`select complete_process_at($1, now())`, [pr2]));
      t.eq(await t.val(`select count(*)::int from material_issue where process_record_id = $1`, [pr2]), 0,
        '미사용 사유');
    });
  },
},

{
  id: 'CS-03', expect: '통과',
  name: '재고가 모자라면 있는 만큼만 차감하고 마감은 된다 · 재고가 없어도 마감은 된다',
  async run(t) {
    const m = await master(t);
    await withLoose(t, m, async () => {
      /* 쓸 수 있는 재고를 모두 비운다 (이 품목만) */
      await t.rows(`update material_lot set status = 'DISPOSED' where item_id = $1 and status = 'AVAILABLE'`,
        [m.reagent2]);
      const wo = await newWorkOrder(t, m);
      const pr0 = await started(t, m, wo);
      await asUser(t, m.worker, () => t.rows(`select complete_process_at($1, now())`, [pr0]));
      t.ok(await t.val(`select ended_at is not null from process_record where id = $1`, [pr0]), '재고 없이 마감');

      const lot = await looseLot(t, m, m.reagent2, 1, 0);
      const pr = await started(t, m, await newWorkOrder(t, m));
      await asUser(t, m.worker, () => t.rows(`select complete_process_at($1, now())`, [pr]));
      t.eq(await t.val(`select sum(qty)::numeric::text from material_issue where process_record_id = $1`, [pr]),
        '1', '있는 1 통만');
      t.eq(await t.val(`select status::text from material_lot where id = $1`, [lot]), 'CONSUMED', '다 쓴 로트');
    });
  },
},

];
