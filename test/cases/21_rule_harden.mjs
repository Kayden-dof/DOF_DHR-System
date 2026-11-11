// =============================================================================
// 21_rule_harden.mjs - 설비 여럿 (0133) · 규칙 강화 (0134)
// 근거: 사용자 2026-11-11 «설비 여러개 선택» · UI/UX 검수 «권고대로 진행»
//
//   출하 승인은 승인 기록과 함께만 · 출고는 승인된 로트만
//   서면 대조가 짚는 것이 바뀌면 대조가 풀린다 (짚지 않는 것은 그대로)
//   지시가 나간 뒤에는 시행일을 바꾸지 않는다
//   완제품은 사용기간과 함께 만든다
//   공정 기록 한 줄에 설비 여럿 · 시작 뒤에 설비를 고치면 코드도 따라온다
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder } from '../fixtures.mjs';

/** 출하 승인 전인 제품 로트 하나 */
async function lot(t, m) {
  const wo = await newWorkOrder(t, m);
  await t.setActor(m.admin);
  const id = await t.val(`select cut_product_lot($1,$2,$3,$4,current_date)`, [wo.id, m.fin, 20, 2]);
  await t.setActor(null);
  return { wo, id };
}

/** 서면 대조를 마친 제품표준서 하나 (공정 하나). 지시는 아직 없다 */
async function verifiedDmr(t, m, rev, effective = 'current_date') {
  const dm = await t.val(
    `insert into device_master (item_id, revision, status, effective_from)
     values ($1, $2, 'DRAFT', ${effective}) returning id`, [m.fin, rev]);
  const op = await t.val(
    `insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
     values ($1, 1, $2, '시험 공정', false) returning id`, [dm, `${rev}-OP1`]);
  await t.rows(
    `update device_master set verified_by = $2, verified_at = now(), status = 'ACTIVE'
      where id = $1`, [dm, m.admin]);
  return { dm, op };
}

const state = (t, dm) => t.one(
  `select verified_at is not null as verified, status from device_master where id = $1`, [dm]);

export default [

{
  id: 'RH-01', expect: '예외',
  name: '승인 기록 없이 출하 승인 상태로 바꿈',
  async run(t) {
    const m = await master(t);
    const l = await lot(t, m);
    await t.rejects(
      () => t.rows(`update product_lot set status = 'RELEASE_APPROVED' where id = $1`, [l.id]),
      { message: '출하 승인은 품질책임자의 서면 승인' });
  },
},

{
  id: 'RH-02', expect: '통과',
  name: '승인 기록(성명 · 일자)과 함께면 출하 승인이 된다',
  async run(t) {
    const m = await master(t);
    const l = await lot(t, m);
    await t.rows(
      `update product_lot set release_approved_by = '정품질', release_approved_on = current_date,
              status = 'RELEASE_APPROVED' where id = $1`, [l.id]);
    t.eq(await t.val(`select status::text from product_lot where id = $1`, [l.id]),
         'RELEASE_APPROVED', '승인');
  },
},

{
  id: 'RH-03', expect: '예외',
  name: '출하 승인 기록이 없는 로트를 출고',
  async run(t) {
    const m = await master(t);
    const l = await lot(t, m);
    await t.rejects(
      () => t.rows(
        `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by)
         values ($1, '거래처', 1, current_date, $2)`, [l.id, m.admin]),
      { message: '출하 승인 기록이 없어 출고할 수 없습니다' });
  },
},

{
  id: 'RH-04', expect: '확인',
  name: '대조가 짚는 공정 · 자재 · 설비가 바뀌면 대조가 풀리고, 짚지 않는 값은 그대로다',
  async run(t) {
    const m = await master(t);
    const { dm, op } = await verifiedDmr(t, m, 'RH-04');
    const again = () => t.rows(
      `update device_master set verified_by = $2, verified_at = now(), status = 'ACTIVE'
        where id = $1`, [dm, m.admin]);

    /* 짚지 않는 값: 표준 일차 · 비고 · 장입 범위 */
    await t.rows(`update dmr_operation set typical_day = 2 where id = $1`, [op]);
    await t.rows(`update device_master set note = '비고', sheet_min = 1, sheet_max = 30 where id = $1`, [dm]);
    t.eq(await state(t, dm), { verified: true, status: 'ACTIVE' }, '짚지 않는 값');

    /* 공정 이름 */
    await t.rows(`update dmr_operation set name = '바뀐 이름' where id = $1`, [op]);
    t.eq(await state(t, dm), { verified: false, status: 'DRAFT' }, '공정 이름');
    await again();

    /* 자재 줄 */
    const bom = await t.val(
      `insert into dmr_bom (operation_id, component_item_id, basis)
       values ($1, $2, 'SHEET_TIER') returning id`, [op, m.reagent]);
    t.eq(await state(t, dm), { verified: false, status: 'DRAFT' }, '자재 줄 넣기');
    await again();

    /* 장입 구간 */
    await t.rows(`insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
                  values ($1, 1, 10, 1)`, [bom]);
    t.eq(await state(t, dm), { verified: false, status: 'DRAFT' }, '장입 구간');
    await again();

    /* 설비 연결 */
    const eq = await t.val(`insert into equipment (code, name) values ('RH-EQ1','시험 설비') returning id`);
    await t.rows(`insert into operation_equipment (operation_id, equipment_id) values ($1, $2)`, [op, eq]);
    t.eq(await state(t, dm), { verified: false, status: 'DRAFT' }, '설비 연결');
    await again();

    /* 예상 생산수량 (본체에서 짚는 값) */
    await t.rows(`update device_master set expected_units = 99 where id = $1`, [dm]);
    t.eq(await state(t, dm), { verified: false, status: 'DRAFT' }, '예상 생산수량');
  },
},

{
  id: 'RH-05', expect: '확인',
  name: '비어 있던 시행일을 처음 정하면 대조가 남고, 정해 둔 날을 바꾸면 풀린다',
  async run(t) {
    const m = await master(t);
    const { dm } = await verifiedDmr(t, m, 'RH-05', 'null');
    await t.rows(`update device_master set effective_from = current_date where id = $1`, [dm]);
    t.eq(await state(t, dm), { verified: true, status: 'ACTIVE' }, '처음 정함');
    await t.rows(`update device_master set effective_from = current_date + 1 where id = $1`, [dm]);
    t.eq(await state(t, dm), { verified: false, status: 'DRAFT' }, '바꿈');
  },
},

{
  id: 'RH-06', expect: '예외',
  name: '작업 지시가 나간 제품표준서의 시행일을 바꿈',
  async run(t) {
    const m = await master(t);
    const { dm } = await verifiedDmr(t, m, 'RH-06');
    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510' });
    await t.val(
      `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
         material_lot_id, sheet_count, issued_by_prod, issued_by_qa)
       values (next_number('WORK_ORDER'), next_number('BATCH'), $1, 'RH-06', $2, 10, $3, $4)
       returning id`, [dm, rawLot, m.admin, m.qa]);
    await t.rejects(
      () => t.rows(`update device_master set effective_from = current_date - 1 where id = $1`, [dm]),
      { message: '시행일은 바꿀 수 없습니다' });
  },
},

{
  id: 'RH-07', expect: '예외',
  name: '사용기간 없이 완제품 형명을 만듦',
  async run(t) {
    await t.rejects(
      () => t.rows(
        `insert into item (code, name, type, purchase_uom, usage_uom)
         values ('RH-FIN-01', '사용기간 없는 완제품', 'FIN', 'EA', 'EA')`),
      { message: '사용기간(개월)과 함께 등록하십시오' });
  },
},

{
  id: 'RH-08', expect: '확인',
  name: '공정 기록 한 줄에 설비 여럿 · 겹친 것은 한 번 · 시작 뒤에 고치면 코드도 따라온다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const e1 = await t.val(`insert into equipment (code, name) values ('RH-M1','동결건조기') returning id`);
    const e2 = await t.val(`insert into equipment (code, name) values ('RH-T1','캘리퍼스') returning id`);
    const e3 = await t.val(`insert into equipment (code, name) values ('RH-M2','동결건조기 2') returning id`);
    await t.setActor(m.admin);
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id,
         started_at, equipment_ref, extra_equipment_refs)
       values ($1, $2, 1, current_date, $3, now(), $4, array[$5::uuid, $4::uuid, $5::uuid])
       returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker, e1, e2]);

    const row = () => t.one(
      `select equipment_id, extra_equipment_ids from process_record where id = $1`, [pr]);
    t.eq(await row(), { equipment_id: 'RH-M1', extra_equipment_ids: ['RH-T1'] }, '넣을 때');
    t.eq(Number(await t.val(
      `select count(*) from v_process_equipment where process_record_id = $1`, [pr])), 2, '뷰가 둘 다 편다');

    await t.rows(`update process_record set equipment_ref = $2, extra_equipment_refs = array[$3::uuid, $4::uuid]
                   where id = $1`, [pr, e3, e2, e1]);
    t.eq(await row(), { equipment_id: 'RH-M2', extra_equipment_ids: ['RH-T1', 'RH-M1'] }, '고친 뒤');

    await t.rows(`update process_record set extra_equipment_refs = null where id = $1`, [pr]);
    t.eq(await row(), { equipment_id: 'RH-M2', extra_equipment_ids: null }, '둘째부터 비움');
    await t.setActor(null);
  },
},

{
  id: 'RH-09', expect: '확인',
  name: '공정에 걸리지 않은 설비 · 구성표에 없는 자재를 쓰면 검토가 «표준서 밖» 으로 짚는다 (0135)',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const eq = await t.val(`insert into equipment (code, name) values ('RH-X1','대체 설비') returning id`);
    const lot = await newMaterialLot(t, m, m.reagent2);   // 03 공정 구성표에는 reagent 만 있다
    await t.setActor(m.admin);
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id,
         started_at, equipment_ref)
       values ($1, $2, 1, current_date, $3, now(), $4) returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.admin, eq]);
    await t.rows(`insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
                  values ($1, $2, 1, $3)`, [pr, lot, m.admin]);
    const flags = await t.rows(
      `select detail, ref from review_flags($1) where kind = '표준서 밖' order by ref`, [wo.id]);
    t.eq(flags.length, 2, '설비 하나 · 자재 하나');
    t.eq(flags.some((f) => f.ref === 'RH-X1' && f.detail.includes('걸리지 않은 설비')), true, '설비');
    t.eq(flags.some((f) => f.detail.includes('자재 구성표에 없는 자재')), true, '자재');
    await t.setActor(null);
  },
},

];
