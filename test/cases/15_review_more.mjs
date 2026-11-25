// =============================================================================
// 15_review_more.mjs · 검토 표시가 넓어진 갈래 (§8.5 · 0113)
//
// 네 갈래 전부 산술로 결론이 하나로 정해지는 것만 본다. 막지 않고 짚기만 하며,
// 적합·부적합을 말하지 않는다.
//
// 세는 것이 아니라 **그 사실이 짚였는가**를 본다 - 이 파일은 시험 순서상
// 뒤쪽이라, 앞에서 공급자 상태를 바꿔 둔 시험(RV3-08)이 남긴 표시가 함께
// 있을 수 있다. 총 건수로 재면 그것 때문에 흔들린다.
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder } from '../fixtures.mjs';

/** 그 갈래의 표시 가운데 이 말이 들어간 것 */
async function flags(t, woId, kind, needle) {
  const rows = await t.rows(
    `select detail from review_flags($1) where kind = $2`, [woId, kind]);
  return rows.map((r) => r.detail).filter((d) => d.includes(needle));
}

export default [

{
  id: 'RM-01', expect: '확인',
  name: '유효기한이 지난 자재가 들어가면 짚는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);

    const old = await newMaterialLot(t, m, m.reagent,
      { qty: 20, expiry: '2020-01-01', lot_no: 'ML-EXPIRED-01' });
    const fresh = await newMaterialLot(t, m, m.reagent,
      { qty: 20, expiry: '2099-12-31', lot_no: 'ML-FRESH-01' });

    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3) returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    for (const lot of [old, fresh]) {
      await t.rows(
        `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
         values ($1,$2,1,$3)`, [pr, lot, m.admin]);
    }

    const hit = await flags(t, wo.id, '기한 경과', 'ML-EXPIRED-01');
    t.eq(hit.length, 1, '지난 로트를 짚는다');
    t.ok(hit[0].includes('2020-01-01'), '유효기한을 적는다');

    /* 기한이 남은 로트는 같은 자리에서 짚히지 않는다 */
    t.eq((await flags(t, wo.id, '기한 경과', 'ML-FRESH-01')).length, 0, '남은 것은 안 짚는다');
    await t.setActor(null);
  },
},

{
  id: 'RM-02', expect: '확인',
  name: '승인되지 않은 공급자의 자재가 들어가면 짚고, 승인되면 사라진다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);

    const lot = await newMaterialLot(t, m, m.reagent,
      { qty: 20, supplier: m.supplierPending, lot_no: 'ML-PENDING-01' });
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3) returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    await t.rows(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,1,$3)`, [pr, lot, m.admin]);

    const hit = await flags(t, wo.id, '미승인 공급자', 'ML-PENDING-01');
    t.eq(hit.length, 1, '미승인 공급자를 짚는다');
    t.ok(hit[0].includes('PENDING'), '상태를 적는다');

    /*
     * 승인하면 사라진다. 이것이 중요하다 - 풀 수 없는 표시는 늘 떠 있게 되고,
     * 늘 떠 있는 표시는 아무도 안 본다 (0107 · 0108 이 같은 판단을 했다).
     */
    await t.rows(
      `update supplier set status = 'APPROVED', approved_until = current_date + 365
        where id = $1`, [m.supplierPending]);
    t.eq((await flags(t, wo.id, '미승인 공급자', 'ML-PENDING-01')).length, 0,
         '승인하면 사라진다');

    /* 승인기한이 투입일 이전이면 다시 짚는다 - 날짜는 그 날을 물을 수 있다 */
    await t.rows(
      `update supplier set approved_until = current_date - 1 where id = $1`,
      [m.supplierPending]);
    const late = await flags(t, wo.id, '미승인 공급자', 'ML-PENDING-01');
    t.eq(late.length, 1, '승인기한이 지났으면 짚는다');
    t.ok(late[0].includes('승인기한'), '기한을 적는다');
    await t.setActor(null);
  },
},

{
  id: 'RM-03', expect: '확인',
  name: '지시된 원재료가 아닌 원재료가 기입되면 짚는다 (§8.5 참조 불일치)',
  /*
   * 이 갈래는 0113 이 더한 것이 아니라 0023 부터 있던 것이다. 없는 줄 알고
   * 하나 더 달았다가 같은 사실이 두 번 나와 여기서 걸렸다 - 그래서 시험은
   * 남긴다. 지키는 것이 있는데 묻는 자리가 없었다.
   */
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);

    const other = await newMaterialLot(t, m, m.raw,
      { qty: 30, thickness_band: '0510', lot_no: 'ML-OTHERRAW-01' });
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3) returning id`,
      [wo.id, m.ops['WS-DX2401-01'], m.worker]);
    await t.rows(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,1,$3)`, [pr, other, m.admin]);

    const hit = await flags(t, wo.id, '참조 불일치', 'ML-OTHERRAW-01');
    t.eq(hit.length, 1, '다른 원재료를 짚는다');
    t.ok(hit[0].includes(await t.val(
      `select lot_no from material_lot where id = $1`, [wo.rawLot])), '지시된 로트를 함께 적는다');

    /* 지시된 원재료를 그대로 기입한 것은 짚지 않는다 */
    await t.rows(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,1,$3)`, [pr, wo.rawLot, m.admin]);
    t.eq((await t.rows(`select 1 from review_flags($1) where kind='참조 불일치'`, [wo.id])).length,
         1, '지시된 것은 늘지 않는다');
    await t.setActor(null);
  },
},

{
  id: 'RM-04', expect: '확인',
  name: '제품 개수 기준 자재가 소요량과 다르면 짚는다 (재포장분은 더해서 본다)',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);

    /* 파우치는 제품 1개당 1 (fixtures 의 mkUnitBom) */
    const lotA = await t.val(`select cut_product_lot($1,$2,$3,$4)`, [wo.id, m.fin, 10, 0]);
    const finB = await t.val(`select id from item where code = 'PD10150510'`);
    const lotB = await t.val(`select cut_product_lot($1,$2,$3,$4)`, [wo.id, finB, 10, 0]);
    const pouchLot = await newMaterialLot(t, m, m.pouch, { qty: 200 });

    const pack = async (lot, qty, rework = null) => {
      const pr = await t.val(
        `insert into process_record (work_order_id, product_lot_id, operation_id,
           day_no, work_date, worker_id, rework_qty)
         values ($1,$2,$3,2,current_date,$4,$5) returning id`,
        [wo.id, lot, m.ops['WS-DX2401-08'], m.worker, rework]);
      await t.rows(
        `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
         values ($1,$2,$3,$4)`, [pr, pouchLot, qty, m.admin]);
      return pr;
    };

    /* 10개를 만들고 8개분만 기입했다 */
    await pack(lotA, 8);
    const lotANo = await t.val(`select lot_no from product_lot where id = $1`, [lotA]);
    const hit = await flags(t, wo.id, '수량 불일치', lotANo);
    t.eq(hit.length, 1, '모자란 기입을 짚는다');
    t.ok(hit[0].includes('10') && hit[0].includes('8'), '두 값을 나란히 적는다');

    /* 재포장 2개를 적었으면 12가 맞다. 더해서 보므로 짚지 않는다 */
    await pack(lotB, 12, 2);
    const lotBNo = await t.val(`select lot_no from product_lot where id = $1`, [lotB]);
    t.eq((await flags(t, wo.id, '수량 불일치', lotBNo)).length, 0,
         '재포장분을 더하면 맞는 것은 안 짚는다');
    await t.setActor(null);
  },
},

];
