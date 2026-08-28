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
      `select id from record_print_log('WORK_ORDER','abc123',$1,null,null,null,null,1,null)`,
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

];
