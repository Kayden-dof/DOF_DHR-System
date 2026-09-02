// =============================================================================
// 04_rules_m1_m4.mjs · S01·S02·S04·S05 · 구조 시험 · 소요량 (§8.1, §8.4)
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder } from '../fixtures.mjs';

/** 재단 전 공정 기록 하나. */
/*
 * 기본은 **끝난 기록**이다. 0085 부터 종료 시각이 없는 공정이 있으면 그 묶음을
 * 잠글 수 없으므로, 잠금을 다루는 시험이 매번 종료를 적어야 한다. 열린 기록이
 * 필요한 시험은 `{ open: true }` 를 준다.
 */
async function newRecord(t, m, wo, opCode, opts = {}) {
  return t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date,
       worker_id, rotation_worker_id, attempt, started_at, ended_at, no_material_reason)
     values ($1,$2,$3, current_date, $4,$5,$6,$7,
             case when $10 then null else coalesce($8::timestamptz, now()) end,
             $9) returning id`,
    [wo.id, m.ops[opCode], opts.day ?? 1, opts.worker ?? m.worker,
     opts.rotation ?? null, opts.attempt ?? 1,
     opts.started ?? null, opts.ended ?? null, opts.reason ?? null,
     opts.open === true]);
}

export default [

// ---- S01 · S02 ---------------------------------------------------------------

{
  id: 'S01-01', expect: '예외',
  name: 'material_lot_id null로 material_issue INSERT',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await newRecord(t, m, wo, 'WS-DX2401-03');
    await t.rejects(
      () => t.rows(`insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
                    values ($1, null, 1, $2)`, [pr, m.admin]),
      { code: '23502' });
  },
},

{
  id: 'S01-02', expect: '예외',
  name: '존재하지 않는 자재 로트로 불출',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await newRecord(t, m, wo, 'WS-DX2401-03');
    await t.rejects(
      () => t.rows(`insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
                    values ($1, '00000000-0000-0000-0000-000000000000', 1, $2)`, [pr, m.admin]),
      { code: '23503' });
  },
},

{
  id: 'S02-01', expect: '예외',
  name: 'coa_no null로 material_lot INSERT',
  async run(t) {
    const m = await master(t);
    await t.rejects(
      () => t.rows(
        `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no, coa_no,
           coa_date, received_at, registered_by, qty_received, qty_available)
         values ($1,'X-COA-NULL',$2,'SL',null, current_date, now(), $3, 1, 1)`,
        [m.reagent, m.supplier, m.admin]),
      { code: '23502' });
  },
},

{
  id: 'S02-02', expect: '예외',
  name: 'coa_no 공백 문자열로 우회 시도 (사양 보강)',
  async run(t) {
    const m = await master(t);
    await t.rejects(
      () => t.rows(
        `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no, coa_no,
           coa_date, received_at, registered_by, qty_received, qty_available)
         values ($1,'X-COA-BLANK',$2,'SL','   ', current_date, now(), $3, 1, 1)`,
        [m.reagent, m.supplier, m.admin]),
      { code: '23514' });
  },
},

// ---- S04 잠금 ----------------------------------------------------------------

{
  id: 'S04-01', expect: '예외',
  name: '잠긴 (지시서,일차,작업자)의 process_record UPDATE',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await newRecord(t, m, wo, 'WS-DX2401-01', { day: 1 });

    await t.setActor(m.admin);
    await t.rows(`select print_day_record($1, 1, $2, md5('day1') || md5('day1'))`, [wo.id, m.worker]);
    await t.setActor(null);

    await t.rejects(
      () => t.rows(`update process_record set equipment_id = 'EQ-9' where id = $1`, [pr]),
      { code: 'P0001', message: 'S04: 인쇄 완료된 기록은 수정할 수 없습니다' });
  },
},

{
  id: 'S04-02', expect: '예외',
  name: '잠긴 묶음에 material_issue INSERT',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await newRecord(t, m, wo, 'WS-DX2401-03', { day: 2 });
    const lot = await newMaterialLot(t, m, m.reagent);

    await t.setActor(m.admin);
    await t.rows(`select print_day_record($1, 2, $2, md5('day2') || md5('day2'))`, [wo.id, m.worker]);
    await t.setActor(null);

    await t.rejects(
      () => t.rows(`insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
                    values ($1,$2,1,$3)`, [pr, lot, m.admin]),
      { code: 'P0001', message: 'S04' });
  },
},

{
  id: 'S04-03', expect: '통과',
  name: '다른 작업자의 같은 날 기록은 잠기지 않는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await newRecord(t, m, wo, 'WS-DX2401-01', { day: 3, worker: m.worker });
    const pr2 = await newRecord(t, m, wo, 'WS-DX2401-02', { day: 3, worker: m.worker2 });

    await t.setActor(m.admin);
    await t.rows(`select print_day_record($1, 3, $2, md5('day3') || md5('day3'))`, [wo.id, m.worker]);
    await t.setActor(null);

    t.eq(await t.val(`select is_locked($1, 3, $2)`, [wo.id, m.worker]),  true,  '작업자갑');
    t.eq(await t.val(`select is_locked($1, 3, $2)`, [wo.id, m.worker2]), false, '작업자을');

    await t.resolves(
      () => t.rows(`update process_record set equipment_id = 'EQ-1' where id = $1`, [pr2]));
  },
},

{
  id: 'S04-04', expect: '없음',
  name: '잠금 해제 함수가 존재하지 않는다 (§10)',
  async run(t) {
    const n = await t.val(
      `select count(*)::int from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public'
          and (p.proname ilike '%unlock%' or p.proname ilike '%force%'
               or p.proname ilike '%override%' or p.proname ilike '%skip_valid%')`);
    t.eq(n, 0, '해제·우회 함수 수');
  },
},

{
  id: 'S04-05', expect: '예외',
  name: '종료 시각 없는 공정을 품은 채 마감 (0085)',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await newRecord(t, m, wo, 'WS-DX2401-01', { day: 5 });
    await newRecord(t, m, wo, 'WS-DX2401-03', { day: 5, open: true });

    await t.setActor(m.worker);
    await t.rejects(() => t.rows(`select lock_day($1, 5, $2)`, [wo.id, m.worker]),
      { code: 'P0001', message: '종료 시각이 없는 공정' });
    await t.setActor(null);

    t.eq(await t.val(`select is_locked($1, 5, $2)`, [wo.id, m.worker]), false, '잠기지 않음');
  },
},

{
  id: 'S04-06', expect: '예외',
  name: '인쇄로도 잠글 수 없다 - 잠그는 길 둘을 한 자리에서 막는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await newRecord(t, m, wo, 'WS-DX2401-02', { day: 6, open: true });

    await t.setActor(m.admin);
    await t.rejects(
      () => t.rows(`select print_day_record($1, 6, $2, md5('d6') || md5('d6'))`,
                   [wo.id, m.worker]),
      { code: 'P0001', message: '종료 시각이 없는 공정' });
    await t.setActor(null);

    t.eq(await t.val(`select count(*)::int from record_print
                       where work_order_id = $1 and day_no = 6`, [wo.id]), 0, '인쇄 대장');
  },
},

{
  id: 'S04-07', expect: '통과',
  name: '공정을 마감하면 지나간다 · 이미 잠긴 묶음의 재인쇄는 막지 않는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await newRecord(t, m, wo, 'WS-DX2401-02',
                               { day: 7, open: true, reason: '해당 없음' });

    await t.setActor(m.worker);
    await t.rows(`select complete_process($1)`, [pr]);
    await t.resolves(() => t.rows(`select lock_day($1, 7, $2)`, [wo.id, m.worker]));
    await t.setActor(null);

    t.eq(await t.val(`select is_locked($1, 7, $2)`, [wo.id, m.worker]), true, '잠김');

    /*
     * 잠긴 뒤에 열린 기록이 생겨도 재인쇄는 막지 않는다. 이미 마감된 묶음을
     * 다시 뽑는 것은 마감이 아니다 (0063). 이 규칙이 서기 전에 잠긴 묶음도
     * 같은 이유로 그대로 뽑힌다.
     */
    await t.setActor(m.admin);
    await t.resolves(
      () => t.rows(`select print_day_record($1, 7, $2, md5('d7b') || md5('d7b'))`,
                   [wo.id, m.worker]));
    await t.setActor(null);
  },
},

// ---- S05 자재 미기록 ---------------------------------------------------------

{
  id: 'S05-01', expect: '예외',
  name: 'BOM 자재 미기록 상태로 complete_process',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await newRecord(t, m, wo, 'WS-DX2401-03', { day: 5 });
    await t.setActor(m.admin);
    await t.rejects(() => t.rows(`select complete_process($1)`, [pr]),
      { code: 'P0001', message: 'S05: 자재가 기록되지 않았습니다' });
    await t.setActor(null);
  },
},

{
  id: 'S05-02', expect: '통과',
  name: 'no_material_reason 입력 후 complete_process',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await newRecord(t, m, wo, 'WS-DX2401-03', { day: 6, reason: '해당 공정 미실시' });
    await t.setActor(m.admin);
    await t.resolves(() => t.rows(`select complete_process($1)`, [pr]));
    await t.setActor(null);
    t.ok(await t.val(`select ended_at is not null from process_record where id=$1`, [pr]),
      'ended_at이 채워져야 한다');
  },
},

{
  id: 'S05-03', expect: '통과',
  name: '자재를 기록하면 complete_process 통과',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await newRecord(t, m, wo, 'WS-DX2401-03', { day: 7 });
    const lot = await newMaterialLot(t, m, m.reagent);
    await t.rows(`insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
                  values ($1,$2,2,$3)`, [pr, lot, m.admin]);
    await t.setActor(m.admin);
    await t.resolves(() => t.rows(`select complete_process($1)`, [pr]));
    await t.setActor(null);
  },
},

{
  id: 'S05-04', expect: '확인',
  name: '원재료는 자재 구성표에 없으므로 S05 대상이 아니다',
  async run(t) {
    const m = await master(t);
    const n = await t.val(
      `select count(*)::int from dmr_bom b join item i on i.id = b.component_item_id
        where i.type = 'RAW'`);
    t.eq(n, 0, 'RAW 품목의 BOM 행 수');
  },
},

// ---- 구조 시험 ---------------------------------------------------------------

{
  id: 'ST-01', expect: '예외',
  name: 'after_cutting=false 공정에 product_lot_id 지정',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    const pl = await t.val(`select cut_product_lot($1,$2,10,1)`, [wo.id, m.fin]);
    await t.setActor(null);
    await t.rejects(
      () => t.rows(`insert into process_record (work_order_id, product_lot_id, operation_id,
                      day_no, work_date, worker_id)
                    values ($1,$2,$3,9,current_date,$4)`,
                   [wo.id, pl, m.ops['WS-DX2401-01'], m.worker]),
      { code: 'P0001', message: '재단 이전 공정에는 제품 로트를 지정할 수 없습니다' });
  },
},

{
  id: 'ST-02', expect: '예외',
  name: 'after_cutting=true 공정에 product_lot_id 미지정',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rejects(
      () => t.rows(`insert into process_record (work_order_id, operation_id, day_no,
                      work_date, worker_id)
                    values ($1,$2,9,current_date,$3)`,
                   [wo.id, m.ops['WS-DX2401-08'], m.worker]),
      { code: 'P0001', message: '재단 이후 공정은 제품 로트를 지정해야 합니다' });
  },
},

{
  id: 'ST-03', expect: '예외',
  name: '있을 수 없는 장입 장수는 자료가 되지 못한다 (0장)',
  async run(t) {
    const m = await master(t);
    /*
     * 트리거가 CHECK 보다 먼저 돈다. 그래서 0장은 하한에서 걸린다.
     * DDL 의 울타리는 그 뒤에 남아 있고 ST-03c 가 그것을 본다.
     */
    await t.rejects(() => newWorkOrder(t, m, { sheets: 0 }),
      { code: 'P0001', message: '하한' });
  },
},

{
  id: 'ST-03c', expect: '확인',
  name: '트리거가 물러나도 DDL 울타리는 남는다',
  async run(t) {
    /*
     * 복구할 때는 트리거가 물러난다 (session_replication_role = replica ·
     * scripts/restore-check.mjs). 그때 남는 것은 CHECK 뿐이다. 상한은 제품
     * 표준서로 옮겼지만 "0장이나 음수는 자료가 될 수 없다" 는 표에 남아 있어야
     * 한다 (0069).
     */
    const [c] = await t.rows(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'work_order'::regclass
          and conname = 'work_order_sheet_count_check'`);
    if (!c) throw new Error('바깥 울타리가 사라졌습니다');
    if (!/sheet_count\s*>\s*0/.test(c.def)) {
      throw new Error(`울타리가 기대와 다릅니다: ${c.def}`);
    }
  },
},

{
  id: 'ST-03b', expect: '예외',
  name: '장입 상한은 제품표준서가 정한다',
  async run(t) {
    const m = await master(t);
    await t.setActor(m.admin);

    /* 상한이 없으면 막지 않는다 */
    await t.rows(`update device_master set sheet_min = null, sheet_max = null where id = $1`,
      [m.dm]);
    await t.resolves(() => newWorkOrder(t, m, { sheets: 500 }));

    /* 제품표준서가 정하면 그 값으로 막는다 */
    await t.rows(`update device_master set sheet_min = 5, sheet_max = 30 where id = $1`, [m.dm]);
    await t.rejects(() => newWorkOrder(t, m, { sheets: 31 }),
      { code: 'P0001', message: '상한(30장)' });
    await t.rejects(() => newWorkOrder(t, m, { sheets: 4 }),
      { code: 'P0001', message: '하한(5장)' });
    await t.resolves(() => newWorkOrder(t, m, { sheets: 30 }));

    /* 값을 바꾸면 막는 자리도 함께 움직인다 - 코드를 고치지 않는다 (§2.0) */
    await t.rows(`update device_master set sheet_max = 40 where id = $1`, [m.dm]);
    await t.resolves(() => newWorkOrder(t, m, { sheets: 31 }));
  },
},

{
  id: 'ST-04', expect: '예외',
  name: 'qty_available > qty_produced - qty_sample',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rejects(
      () => t.rows(`insert into product_lot (work_order_id, lot_no, item_id, qty_produced,
                      qty_sample, qty_available, manufactured_on, expiry_date, registered_by)
                    values ($1,'BAD-QTY',$2,10,2,9,current_date,current_date+365,$3)`,
                   [wo.id, m.fin, m.admin]),
      { code: '23514' });
  },
},

{
  id: 'ST-05', expect: '예외',
  name: 'issued_by_prod = issued_by_qa',
  async run(t) {
    const m = await master(t);
    const raw = await newMaterialLot(t, m, m.raw);
    await t.rejects(
      () => t.rows(`insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
                      material_lot_id, sheet_count, issued_by_prod, issued_by_qa)
                    values ('WO-SAME','B-SAME',$1,'Rev.02',$2,10,$3,$3)`,
                   [m.dm, raw, m.admin]),
      { code: '23514' });
  },
},

{
  id: 'ST-06', expect: '예외',
  name: 'worker_id = rotation_worker_id',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rejects(
      () => newRecord(t, m, wo, 'WS-DX2401-01', { day: 8, rotation: m.worker }),
      { code: '23514' });
  },
},

{
  id: 'ST-07', expect: '예외',
  name: '다른 배치의 제품 로트에 공정 기록 (사양 보강)',
  async run(t) {
    const m = await master(t);
    const woA = await newWorkOrder(t, m);
    const woB = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    const pl = await t.val(`select cut_product_lot($1,$2,5,0)`, [woA.id, m.fin]);
    await t.setActor(null);
    await t.rejects(
      () => t.rows(`insert into process_record (work_order_id, product_lot_id, operation_id,
                      day_no, work_date, worker_id)
                    values ($1,$2,$3,1,current_date,$4)`,
                   [woB.id, pl, m.ops['WS-DX2401-08'], m.worker]),
      { code: 'P0001', message: '이 작업 지시의 로트가 아닙니다' });
  },
},

{
  id: 'ST-08', expect: '예외',
  name: '취소 사유 없이 작업지시 취소 (사양 보강)',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rejects(
      () => t.rows(`update work_order set status='CANCELLED' where id=$1`, [wo.id]),
      { code: 'P0001', message: '취소 사유를 입력해야 합니다' });
    await t.resolves(
      () => t.rows(`update work_order set status='CANCELLED', cancelled_reason='원재료 부적합'
                    where id=$1`, [wo.id]));
  },
},

{
  id: 'ST-09', expect: '예외',
  name: '장입 구간이 겹치는 자재 구성표 (사양 보강)',
  async run(t) {
    const m = await master(t);
    const bom = await t.val(
      `insert into dmr_bom (operation_id, component_item_id, basis)
       values ($1,$2,'SHEET_TIER') returning id`, [m.ops['WS-DX2401-05'], m.reagent]);
    await t.rows(`insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
                  values ($1,1,10,1)`, [bom]);
    await t.rejects(
      () => t.rows(`insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
                    values ($1,5,15,2)`, [bom]),
      { code: 'P0001', message: '장입 구간이 기존 구간과 겹칩니다' });
  },
},

// ---- 소요량 (§8.4) -----------------------------------------------------------

{
  id: 'RQ-01', expect: '확인',
  name: '시약 SHEET_TIER 구간 판정 (10/11/20/21/30장)',
  async run(t) {
    const m = await master(t);
    const op = m.ops['WS-DX2401-03'];
    const cases = [[10, 1], [11, 2], [20, 2], [21, 3], [30, 3], [1, 1]];
    for (const [sheets, expected] of cases) {
      const got = await t.val(`select required_qty($1,$2,$3,0)`, [op, m.reagent, sheets]);
      t.eq(Number(got), expected, `${sheets}장`);
    }
  },
},

{
  id: 'RQ-02', expect: '확인',
  name: '타이백 5장 단위 6구간',
  async run(t) {
    const m = await master(t);
    const op = m.ops['WS-DX2401-08'];
    for (const [sheets, expected] of [[1, 1], [5, 1], [6, 2], [25, 5], [26, 6], [30, 6]]) {
      const got = await t.val(`select required_qty($1,$2,$3,0)`, [op, m.tyvek, sheets]);
      t.eq(Number(got), expected, `${sheets}장`);
    }
  },
},

{
  id: 'RQ-03', expect: '확인',
  name: '포장재 PER_UNIT은 제품 개수에 비례',
  async run(t) {
    const m = await master(t);
    const op = m.ops['WS-DX2401-08'];
    t.eq(Number(await t.val(`select required_qty($1,$2,0,40)`, [op, m.pouch])), 40, '파우치 1개당');
    t.eq(Number(await t.val(`select required_qty($1,$2,0,40)`, [op, m.label])), 80, '라벨 2개당');
  },
},

{
  id: 'RQ-04', expect: '확인',
  name: '구간 밖 장수는 값이 없다 (0장·31장)',
  async run(t) {
    const m = await master(t);
    const op = m.ops['WS-DX2401-03'];
    t.eq(await t.val(`select required_qty($1,$2,0,0)`,  [op, m.reagent]), null, '0장');
    t.eq(await t.val(`select required_qty($1,$2,31,0)`, [op, m.reagent]), null, '31장');
  },
},

{
  id: 'RQ-05', expect: '확인',
  name: '공정별 소요량 일괄 조회 (작업지시서 인쇄용)',
  async run(t) {
    const m = await master(t);
    const rows = await t.rows(
      `select item_code, required::numeric as required
         from operation_requirements($1, 25, 40) order by item_code`,
      [m.ops['WS-DX2401-08']]);
    const map = Object.fromEntries(rows.map((r) => [r.item_code, Number(r.required)]));
    t.eq(map['PM-001'], 5,  '타이백 25장 구간');
    t.eq(map['PM-002'], 40, '파우치');
    t.eq(map['PM-003'], 80, '라벨');
  },
},

// ---- 완제품 형명 생성 (§4.2) --------------------------------------------------

{
  id: 'FI-01', expect: '확인',
  name: '완제품 형명을 규칙으로 생성한다',
  async run(t) {
    const m = await master(t);
    t.eq(m.generatedCount, 4 * 5 - 3, '크기 4 x 두께 5 - 제외 3');

    /*
     * 크기는 cm 그대로, 두께만 mm 로 환산한다 (0057 · 3차 검수 결함 1).
     *
     * 이 시험은 넉 달 동안 "DX2401 0.5x0.5 0.5~1.0mm" 를 정답으로 못박고
     * 있었다. 틀린 값을 시험이 지켜 주고 있었던 셈이다. 종이에 찍히는 값을
     * 시험이 붙들고 있으면 그 시험이 결함의 방패가 된다.
     */
    t.eq(await t.val(`select name from item where code = 'PD05050510'`),
         'DX2401 5x5cm 0.5~1.0mm', '형명 표기 (크기 cm · 두께 mm)');
    t.eq(await t.val(`select name from item where code = 'PD10150510'`),
         'DX2401 10x15cm 0.5~1.0mm', '두 자리 크기');
    t.eq(await t.val(`select spec_label('PD10152025')`),
         '10x15cm · 두께 2.0~2.5mm', '인쇄물이 쓰는 규격 문구');

    t.eq(await t.val(`select count(*)::int from item where code = 'PD10152530'`),
         0, '제외 조합은 생성되지 않는다');
  },
},

{
  id: 'FI-02', expect: '통과',
  name: '재생성해도 중복되지 않는다',
  async run(t) {
    const before = await t.val(`select count(*)::int from item where type='FIN'`);
    await t.rows(
      `select * from generate_finished_items(
         array['0505'], array['0510'], array[]::text[])`);
    t.eq(await t.val(`select count(*)::int from item where type='FIN'`), before, '완제품 수');
  },
},

];
