// =============================================================================
// 07_immutable.mjs · 적힌 사실은 고쳐 쓰지 않는다 (0052)
// 근거: CLAUDE.md §1 "기록은 삭제되지 않는다", §10, 적대적 감사 2026-08-28
//
// 감사에서 응용을 건너뛰고 SQL 을 직접 던져 뚫었던 자리들이다. 여기 각 줄은
// 그때 실제로 열렸던 조작이고, 지금은 막혀야 한다. 출력이 그대로 OQ 각본이
// 되도록 무엇을 시도해 무엇을 기대하는지 이름에 적는다 (§8.1).
//
// 함께 확인하는 것이 하나 더 있다 - 정상 작업은 그대로 열려 있는가.
// 막는 것만 시험하면 너무 많이 막아 놓고도 통과한다.
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder } from '../fixtures.mjs';

const BLOCKED = { code: 'P0001' };


/* ---------------------------------------------------------------------------
   제품표준서의 공정과 자재 구성표 (5차 감사 A3 · 0089)

   0084 가 본체를 잠갔는데 그 아래 표들은 열려 있었다. 공정 이름을 바꾸면
   이미 나간 배치의 제조기록서를 다시 뽑을 때 다른 이름이 인쇄되고, 소요량을
   바꾸면 이미 인쇄된 작업지시서와 다른 값이 나온다.

   막는 것과 여는 것을 함께 본다. 발행 전에는 오기 정정이 정상 작업이다.
--------------------------------------------------------------------------- */

/** 지시가 하나도 안 나간 제품표준서 한 벌. 공정 · 자재 · 구간까지 */
async function freshDmr(t, m, rev) {
  const dm = await t.val(
    `insert into device_master (item_id, revision, status, effective_from,
                                verified_by, verified_at)
     values ($1, $2, 'ACTIVE', current_date, $3, now()) returning id`,
    [m.fin, rev, m.admin]);
  const op = await t.val(
    `insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
     values ($1, 1, $2, '첫 공정', false) returning id`, [dm, `${rev}-OP1`]);
  const bom = await t.val(
    `insert into dmr_bom (operation_id, component_item_id, basis)
     values ($1, $2, 'SHEET_TIER') returning id`, [op, m.reagent]);
  const tier = await t.val(
    `insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
     values ($1, 1, 10, 1) returning id`, [bom]);
  return { dm, op, bom, tier };
}

/** 그 표준서로 지시 하나를 낸다. fixtures 의 것은 m.dm 에 고정되어 있다 */
async function issueAgainst(t, m, dm) {
  const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510' });
  return t.val(
    `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
       material_lot_id, sheet_count, issued_by_prod, issued_by_qa)
     values ($1,$2,$3,'Rev.02',$4,20,$5,$6) returning id`,
    [await t.val(`select next_number('WORK_ORDER')`),
     await t.val(`select next_number('BATCH')`), dm, rawLot, m.admin, m.qa]);
}

export default [

// ---- 작업 지시의 뿌리 (감사 지적 3) -----------------------------------------

{
  id: 'IMM-01', expect: '통과',
  name: '기록이 붙기 전에는 원재료 로트를 고칠 수 있다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const other = await newMaterialLot(t, m, m.raw, { thickness_band: '0510' });

    // 발행 직후 오기를 발견해 고치는 것은 정상 작업이다. 종이도 기록도 없다.
    await t.resolves(() => t.rows(
      `update work_order set material_lot_id = $2 where id = $1`, [wo.id, other]));
    t.eq(await t.val(`select material_lot_id from work_order where id = $1`, [wo.id]),
         other, '바뀐 로트');
  },
},

{
  id: 'IMM-02', expect: '예외',
  name: '공정 기록이 붙은 뒤에는 원재료 로트를 바꿀 수 없다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const other = await newMaterialLot(t, m, m.raw, { thickness_band: '0510' });

    await t.setActor(m.admin);
    await t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,current_date,$3)`,
      [wo.id, m.ops['WS-DX2401-01'], m.worker]);

    await t.rejects(() => t.rows(
      `update work_order set material_lot_id = $2 where id = $1`, [wo.id, other]),
      { ...BLOCKED, message: '원재료 로트' });
    await t.rejects(() => t.rows(
      `update work_order set batch_no = batch_no || 'X' where id = $1`, [wo.id]), BLOCKED);
    await t.rejects(() => t.rows(
      `update work_order set sheet_count = 5 where id = $1`, [wo.id]), BLOCKED);

    // 상태는 정상 작업이다. 착수 · 재단 · 종료가 이 열을 움직인다.
    await t.resolves(() => t.rows(
      `update work_order set status = 'IN_PROCESS' where id = $1`, [wo.id]));
  },
},

// ---- 제품 로트의 확정값 (감사 지적 4) ---------------------------------------

{
  id: 'IMM-03', expect: '예외',
  name: '유효기한과 생산 수량은 재단 시점 값으로 고정된다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    const lot = await t.val(`select cut_product_lot($1,$2,$3,$4)`, [wo.id, m.fin, 20, 2]);

    // §10 "product_lot.expiry_date 를 사용기간 변경 시 소급 갱신" 금지
    await t.rejects(() => t.rows(
      `update product_lot set expiry_date = expiry_date + 365 where id = $1`, [lot]),
      { ...BLOCKED, message: '유효기한' });
    await t.rejects(() => t.rows(
      `update product_lot set qty_produced = qty_produced + 100 where id = $1`, [lot]),
      BLOCKED);
    await t.rejects(() => t.rows(
      `update product_lot set lot_no = lot_no || 'X' where id = $1`, [lot]), BLOCKED);
    await t.rejects(() => t.rows(
      `update product_lot set manufactured_on = current_date - 30 where id = $1`, [lot]),
      BLOCKED);
  },
},

{
  id: 'IMM-04', expect: '통과',
  name: '출고 가능 수량과 상태는 그대로 움직인다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    const lot = await t.val(`select cut_product_lot($1,$2,$3,$4)`, [wo.id, m.fin, 20, 2]);

    // 출고 · 폐기 · 시료가 이 열을 움직인다. 그 경로에는 사유가 남는다.
    await t.resolves(() => t.rows(
      `update product_lot set qty_available = qty_available - 1 where id = $1`, [lot]));
    await t.resolves(() => t.rows(
      `update product_lot set status = 'PACKED' where id = $1`, [lot]));
  },
},

// ---- 인쇄 기록 (감사 지적 2) ------------------------------------------------

{
  id: 'IMM-05', expect: '예외',
  name: '자료 식별자와 인쇄자는 고쳐 쓸 수 없다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    const p = await t.one(
      `select id from record_print_log('WORK_ORDER', md5('wo') || md5('wo'),$1,null,null,null,null,1,null)`,
      [wo.id]);
    const rp = await t.val(
      `select id from record_print where work_order_id = $1 order by seq desc limit 1`, [wo.id]);
    t.ok(rp, `인쇄 기록이 있어야 한다 (${JSON.stringify(p)})`);

    await t.rejects(() => t.rows(
      `update record_print set data_hash = 'FORGED' where id = $1`, [rp]),
      { ...BLOCKED, message: '인쇄 기록은 고칠 수 없습니다' });
    await t.rejects(() => t.rows(
      `update record_print set printed_by = $2 where id = $1`, [rp, m.worker]), BLOCKED);
    await t.rejects(() => t.rows(
      `update record_print set seq = seq + 1 where id = $1`, [rp]), BLOCKED);

    // 회수는 정상 작업이다. 그것만 열려 있다.
    await t.resolves(() => t.rows(`select retrieve_print($1, $2)`, [rp, '오기 발견']));
  },
},

// ---- 개발 계정 표시 (감사 지적 5) -------------------------------------------

{
  id: 'IMM-06', expect: '예외',
  name: '개발 계정 표시를 끄고 품질책임자를 붙일 수 없다',
  async run(t) {
    const dev = await t.newUser({ full_name: '개발표시시험', is_developer: true });

    // 감사에서는 이 두 줄이 순서대로 통과했다.
    await t.rejects(() => t.rows(
      `update app_user set is_developer = false where id = $1`, [dev]),
      { ...BLOCKED, message: '해제할 수 없습니다' });
    await t.rejects(() => t.rows(
      `insert into user_role (user_id, role) values ($1,'QP')`, [dev]),
      { ...BLOCKED, message: '품질책임자' });

    // 켜는 것은 열려 있다. 개발자에게 계정을 새로 내줄 때 필요하다.
    const plain = await t.newUser({ full_name: '일반계정' });
    await t.resolves(() => t.rows(
      `update app_user set is_developer = true where id = $1`, [plain]));
  },
},

// ---- 작업일 (감사 지적 10) --------------------------------------------------

{
  id: 'IMM-07', expect: '예외',
  name: '있을 수 없는 작업일은 받지 않는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);

    const ins = (date, day) => t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,$3,$4::date,$5)`,
      [wo.id, m.ops['WS-DX2401-01'], day, date, m.worker]);

    await t.rejects(() => ins('2020-01-01', 91), { ...BLOCKED, message: '발행일' });
    await t.rejects(() => t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,92,current_date + 30,$3)`,
      [wo.id, m.ops['WS-DX2401-01'], m.worker]), { ...BLOCKED, message: '아직 오지 않은' });

    // 오늘 것을 오늘 적는 것도, 어제 것을 오늘 적는 것도 정상 작업이다.
    await t.resolves(() => t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,93,current_date,$3)`,
      [wo.id, m.ops['WS-DX2401-01'], m.worker]));
  },
},

// ---- 시료 채취 기준표 (감사 지적 8) -----------------------------------------

{
  id: 'IMM-08', expect: '거부',
  name: '시료 채취 기준표는 표 소유자도 지우지 못한다',
  async run(t) {
    const m = await master(t);
    t.ok(await t.val(`select count(*)::int from sample_plan`) > 0, '기준표가 있어야 한다');

    await t.asRole('app_role', () =>
      t.rejects(() => t.rows(`delete from sample_plan`), { code: '42501' }));
    await t.rejects(() => t.rows(`delete from sample_plan`),
      { ...BLOCKED, message: 'S03: 기록은 삭제할 수 없습니다' });
    t.ok(m, '');
  },
},

{
  id: 'DMR-01', expect: '통과',
  name: '지시가 나가기 전에는 공정 · 자재 구성표 · 구간을 고칠 수 있다',
  async run(t) {
    const m = await master(t);
    const x = await freshDmr(t, m, 'A3-OPEN');

    await t.resolves(() => t.rows(
      `update dmr_operation set code = $2, name = '고친 공정', seq = 2,
              after_cutting = true, typical_day = 3 where id = $1`,
      [x.op, 'A3-OPEN-OP1-FIXED']));

    await t.resolves(() => t.rows(
      `update dmr_bom set basis = 'PER_UNIT', qty_per_unit = 2 where id = $1`, [x.bom]));

    await t.resolves(() => t.rows(
      `update dmr_bom_tier set min_sheets = 1, max_sheets = 20, qty = 5 where id = $1`,
      [x.tier]));

    t.eq(await t.val(`select name from dmr_operation where id = $1`, [x.op]),
         '고친 공정', '고쳐진 이름');
  },
},

{
  id: 'DMR-02', expect: '예외',
  name: '지시가 나간 뒤에는 공정을 고칠 수 없다',
  async run(t) {
    const m = await master(t);
    const x = await freshDmr(t, m, 'A3-ISSUED');
    await issueAgainst(t, m, x.dm);

    await t.rejects(
      () => t.rows(`update dmr_operation set name = '몰래 고침' where id = $1`, [x.op]),
      { ...BLOCKED, message: '고칠 수 없습니다' });
  },
},

{
  id: 'DMR-03', expect: '예외',
  name: '지시가 나간 뒤에는 자재 구성표와 장입 구간도 고칠 수 없다',
  async run(t) {
    const m = await master(t);
    const x = await freshDmr(t, m, 'A3-ISSUED2');
    await issueAgainst(t, m, x.dm);

    await t.rejects(
      () => t.rows(`update dmr_bom set qty_per_unit = 99 where id = $1`, [x.bom]),
      { ...BLOCKED, message: '자재 구성표' });

    await t.rejects(
      () => t.rows(`update dmr_bom_tier set qty = 99 where id = $1`, [x.tier]),
      { ...BLOCKED, message: '장입 구간' });
  },
},

{
  id: 'DMR-04', expect: '통과',
  name: '지시가 나간 뒤에도 공정과 자재를 더할 수는 있다',
  async run(t) {
    const m = await master(t);
    const x = await freshDmr(t, m, 'A3-ADD');
    await issueAgainst(t, m, x.dm);

    /* 새로 넣는 것은 앞서 나간 종이를 뒤집지 않는다 */
    await t.resolves(() => t.rows(
      `insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
       values ($1, 9, 'A3-ADD-OP9', '뒤에 더한 공정', false)`, [x.dm]));

    await t.resolves(() => t.rows(
      `insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
       values ($1, 11, 20, 2)`, [x.bom]));
  },
},

/* ---------------------------------------------------------------------------
   자재 로트의 오기 정정 (5차 감사 A1 · 0090)

   `material_lot_coa_once` 가 여덟 열을 잠그고 화면에도 고치는 자리가 없어,
   입고 등록에서 한 글자를 틀리면 영구히 되돌릴 수 없었다. 계보가 뒤집히는
   넷만 남기고 나머지를 연다.
--------------------------------------------------------------------------- */

{
  id: 'ML-01', expect: '통과',
  name: '성적서 번호 · 공급자 로트번호 · 두께 구간의 오기를 고칠 수 있다',
  async run(t) {
    const m = await master(t);
    const lot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510' });

    await t.resolves(() => t.rows(
      `update material_lot
          set coa_no = 'COA-FIXED', coa_date = current_date,
              supplier_lot_no = 'SUP-FIXED', thickness_band = '1015',
              expiry_date = current_date + 100, location = 'A-3', unit_price = 1234
        where id = $1`, [lot]));

    t.eq(await t.val(`select coa_no from material_lot where id = $1`, [lot]),
         'COA-FIXED', '고쳐진 성적서 번호');
    t.eq(await t.val(`select supplier_lot_no from material_lot where id = $1`, [lot]),
         'SUP-FIXED', '고쳐진 공급자 로트번호');
  },
},

{
  id: 'ML-02', expect: '예외',
  name: '사내 로트번호 · 품목 · 공급자 · 입고 수량은 그대로 잠긴다',
  async run(t) {
    const m = await master(t);
    const lot = await newMaterialLot(t, m, m.raw);

    for (const [col, sql] of [
      ['lot_no',       `update material_lot set lot_no = 'ML-BOGUS' where id = $1`],
      ['item_id',      `update material_lot set item_id = $2 where id = $1`],
      ['supplier_id',  `update material_lot set supplier_id = $2 where id = $1`],
      ['qty_received', `update material_lot set qty_received = 9999 where id = $1`],
    ]) {
      const args = col === 'item_id' ? [lot, m.reagent]
                 : col === 'supplier_id' ? [lot, m.supplierPending]
                 : [lot];
      await t.rejects(() => t.rows(sql, args),
        { ...BLOCKED, message: '한 번 적으면 고칠 수 없습니다' });
    }
  },
},

{
  id: 'ML-03', expect: '확인',
  name: '고친 사실과 이전 값이 감사추적에 남는다',
  async run(t) {
    const m = await master(t);
    const lot = await newMaterialLot(t, m, m.raw, { coa_no: 'COA-BEFORE' });

    await t.setActor(m.admin);
    await t.rows(`select set_config('app.change_reason', '자재 로트 정정 · 오타', false)`);
    await t.rows(`update material_lot set coa_no = 'COA-AFTER' where id = $1`, [lot]);
    await t.rows(`select set_config('app.change_reason', '', false)`);
    await t.setActor(null);

    const row = await t.rows(
      `select old_value ->> 'coa_no' as before, new_value ->> 'coa_no' as after, reason
         from audit_log
        where table_name = 'material_lot' and record_id = $1 and action = 'UPDATE'
        order by id desc limit 1`, [lot]);

    t.eq(row[0]?.before, 'COA-BEFORE', '이전 값');
    t.eq(row[0]?.after,  'COA-AFTER',  '바뀐 값');
    t.ok((row[0]?.reason ?? '').includes('오타'), `사유가 남는다: ${row[0]?.reason}`);
  },
},

{
  id: 'DMR-05', expect: '예외',
  name: '지시가 나간 뒤에는 허가 번호를 바꿀 수 없다 (0095)',
  async run(t) {
    const m = await master(t);
    const x = await freshDmr(t, m, 'A3-LICENSE');

    /* 발행 전에는 적고 고치는 것이 정상 작업이다 */
    await t.resolves(() => t.rows(
      `update device_master set license_no = '제허 00-0001호' where id = $1`, [x.dm]));

    await issueAgainst(t, m, x.dm);

    await t.rejects(
      () => t.rows(`update device_master set license_no = '제허 00-9999호' where id = $1`,
                   [x.dm]),
      { ...BLOCKED, message: '허가 번호는 바꿀 수 없습니다' });

    t.eq(await t.val(`select license_no from device_master where id = $1`, [x.dm]),
         '제허 00-0001호', '적힌 번호가 그대로다');
  },
},

];
