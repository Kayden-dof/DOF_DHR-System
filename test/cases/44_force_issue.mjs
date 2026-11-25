// =============================================================================
// 44_force_issue.mjs - 관리자 강제 투입 (0165)
// 근거: 사용자 2026-11-25 «알칼리 처리에서 0.8L 처리한 기록 있고 세척에서 0.8L 처리한 기록 있잖아.
//       연결이 되어야 할거 같다 ... 강제로 투입을 더하는 형태로 수정해줘. 그리고 실제로 0.8L
//       선택하면 재고에서 줄어드는지도 확인이 필요함.»
//
// 현장 투입(material_issue insert)이 원액 잔여를 줄이는지, 인쇄된 일차에서는 보통 투입이 막히는지,
// 생산관리자 · 시스템관리자가 사유와 함께 더하면 잠긴 일차에도 들어가 재고 · 정정 내역에 남는지,
// 인쇄 자료(dayRecordPayload)에는 들지 않는지 본다.
// =============================================================================

import { readFileSync } from 'node:fs';
import { masterData as master, newMaterialLot, reverify } from '../fixtures.mjs';

let seq = 0;

async function asUser(t, userId, fn) {
  await t.rows(`select set_config('app.user_id', $1, false)`, [userId ?? '']);
  try {
    return await t.asRole('app_role', fn);
  } finally {
    await t.rows(`select set_config('app.user_id', '', false)`);
  }
}

async function grant(t, user, role) {
  await t.rows(
    `insert into user_role (user_id, role) select $1, $2::role_code
      where not exists (select 1 from user_role where user_id = $1 and role = $2::role_code)`, [user, role]);
}

/**
 * 원액 로트(5 L) 하나와, 그 원액이 구성표에 걸린 공정의 기록 하나.
 * 공용 제품표준서에는 손대지 않고 시험 전용 개정본을 세운다 (16_solution.mjs SL-13 과 같은 꼴).
 *   o.locked  사유로 마감하고 그 일차를 잠근다
 */
async function setup(t, m, o = {}) {
  seq += 1;
  const item = await t.val(
    `insert into item (code, name, type, purchase_uom, usage_uom, shelf_life_months)
     values ($1, $2, 'SOLUTION', 'L', 'L', 6) returning id`,
    [`SOL-FI${String(seq).padStart(3, '0')}`, `시험 20X PBS ${seq}`]);
  const a = await newMaterialLot(t, m, m.reagent,  { qty: 10 });
  const b = await newMaterialLot(t, m, m.reagent2, { qty: 10 });
  await t.setActor(m.admin);
  const lot = await t.val(
    `select make_solution_lot($1, $2::date, 5, array[$3,$4]::uuid[], array[3,2]::numeric[], null)`,
    [item, '2026-10-22', a, b]);
  const today = await t.val(`select (timezone('Asia/Seoul', now()))::date::text`);
  const rev = `FI-${seq}`;
  const dm = await t.val(
    `insert into device_master (item_id, revision, status, effective_from,
       verified_by, verified_at, sheet_min, sheet_max)
     values ($1,$2,'ACTIVE',$3::date,$4,now(),1,30) returning id`,
    [m.fin, rev, today, m.admin]);
  const op = await t.val(
    `insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
     values ($1,1,$2,'시험 알칼리 처리',false) returning id`, [dm, `WS-FI-${seq}`]);
  const bom = await t.val(
    `insert into dmr_bom (operation_id, component_item_id, basis)
     values ($1,$2,'SHEET_TIER') returning id`, [op, item]);
  await t.rows(
    `insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty) values ($1,1,30,0.8)`, [bom]);
  await reverify(t, dm, m.admin);
  const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510' });
  const wo = await t.val(
    `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision, material_lot_id,
       sheet_count, issued_by_prod, issued_by_qa)
     values (next_number('WORK_ORDER'), next_number('BATCH'), $1, $2, $3, 20, $4, $5)
     returning id`, [dm, rev, rawLot, m.admin, m.qa]);
  const pr = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id,
       no_material_reason)
     values ($1,$2,1,$3::date,$4,$5) returning id`,
    [wo, op, today, m.worker, o.locked ? '자재 사용 없음' : null]);
  if (o.locked) {
    await t.rows(`select complete_process($1)`, [pr]);
    await t.rows(`select lock_day($1,1,$2)`, [wo, m.worker]);
  }
  await t.setActor(null);
  const mgr = await t.newUser({ full_name: `생산관리자투입${seq}` });
  await grant(t, mgr, 'PROD_MGR');
  return { item, lot, wo, pr, op, mgr, a };
}

/* 현장 투입이 하는 그대로 (app/(work)/work/actions.ts issueMaterial · issueFromSheet) */
const fieldIssue = (t, pr, lot, qty, by) => t.rows(
  `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
   values ($1,$2,$3,$4)`, [pr, lot, qty, by]);

const left = async (t, lot) => Number(await t.val(`select qty_available from material_lot where id = $1`, [lot]));

const force = (t, user, pr, lot, qty, why = '종이 기록서에 0.8 L 적혀 있음') => asUser(t, user, () =>
  t.rows(`select force_material_issue($1, $2, $3, $4) as id`, [pr, lot, qty, why]));

export default [

{
  id: 'FI-01', expect: '통과',
  name: '원액 로트를 0.8 고르면 남은 양이 0.8 준다 (현장 투입과 같은 insert)',
  async run(t) {
    const m = await master(t);
    const s = await setup(t, m);
    t.eq(await left(t, s.lot), 5, '처음 잔여');
    await t.setActor(m.admin);
    await fieldIssue(t, s.pr, s.lot, 0.8, m.admin);
    await t.setActor(null);
    t.eq(await left(t, s.lot), 4.2, '0.8 L 투입 뒤 잔여');
  },
},

{
  id: 'FI-02', expect: '거부',
  name: '인쇄된 일차에는 보통 투입이 막힌다 (S04)',
  async run(t) {
    const m = await master(t);
    const s = await setup(t, m, { locked: true });
    await t.setActor(m.admin);
    await t.rejects(() => fieldIssue(t, s.pr, s.lot, 0.8, m.admin), { message: 'S04' });
    await t.setActor(null);
    t.eq(await left(t, s.lot), 5, '잔여는 그대로');
    /* 화면 코드가 표시만 걸고 직접 넣는 길도 막힌다 (app_role) */
    await asUser(t, s.mgr, async () => {
      await t.rows(`select set_config('app.force_issue', $1, false)`, [s.pr]);
      await t.rejects(() => fieldIssue(t, s.pr, s.lot, 0.8, s.mgr), { message: 'S04' });
      await t.rows(`select set_config('app.force_issue', '', false)`);
    });
    t.eq(await left(t, s.lot), 5, '표시만 걸어서는 열리지 않는다');
  },
},

{
  id: 'FI-03', expect: '통과',
  name: '관리자 강제 투입은 잠긴 일차에도 들어가고 재고 · 정정 내역에 남는다',
  async run(t) {
    const m = await master(t);
    const s = await setup(t, m, { locked: true });
    const id = (await force(t, s.mgr, s.pr, s.lot, 0.8))[0].id;
    t.eq(await t.rows(
      `select forced, qty::float8 as qty, issued_by = $2 as by_mgr from material_issue where id = $1`, [id, s.mgr]),
      [{ forced: true, qty: 0.8, by_mgr: true }], '투입 줄');
    t.eq(await left(t, s.lot), 4.2, '재고에서 빠진다');
    const lotNo = await t.val(`select lot_no from material_lot where id = $1`, [s.lot]);
    const code = await t.val(`select code from item where id = $1`, [s.item]);
    t.eq(await t.rows(
      `select old_value, new_value, why, corrected_by = $2 as by_mgr, before_close
         from record_correction where process_record_id = $1 and field = 'material_issue'`, [s.pr, s.mgr]),
      [{ old_value: '(없음)', new_value: `${code} ${lotNo} 0.8 L`, why: '종이 기록서에 0.8 L 적혀 있음',
         by_mgr: true, before_close: false }], '정정 내역');
    /* 등록에는 감사추적 사유를 묻지 않는다 (0124) - 사유는 정정 내역이 든다. 감사추적에는 줄 자체가 남는다 */
    t.eq(await t.val(
      `select count(*)::int from audit_log
        where table_name = 'material_issue' and record_id = $1 and action = 'INSERT' and actor_id = $2`,
      [id, s.mgr]), 1, '감사추적 등록 줄');
    /* 표시는 다시 비워진다 - 뒤따르는 보통 투입은 여전히 막힌다 */
    await t.setActor(m.admin);
    await t.rejects(() => fieldIssue(t, s.pr, s.lot, 0.1, m.admin), { message: 'S04' });
    /* 고치기는 열지 않는다 */
    await t.rejects(() => t.rows(`update material_issue set qty = 0.5 where id = $1`, [id]));
    await t.setActor(null);
    t.eq(await left(t, s.lot), 4.2, '잔여 그대로');
  },
},

{
  id: 'FI-04', expect: '거부',
  name: '작업자 · 빈 사유 · 0 수량 · 모자란 잔여는 거부',
  async run(t) {
    const m = await master(t);
    const s = await setup(t, m, { locked: true });
    await grant(t, m.worker, 'WORKER');
    await t.rejects(() => force(t, m.worker, s.pr, s.lot, 0.8),
      { message: '투입 정정은 생산관리자 또는 시스템관리자가 합니다' });
    await t.rejects(() => force(t, s.mgr, s.pr, s.lot, 0.8, '  '), { message: '왜 더하는지 적으십시오' });
    await t.rejects(() => force(t, s.mgr, s.pr, s.lot, 0), { message: '수량은 0 보다 커야 합니다' });
    await t.rejects(() => force(t, s.mgr, s.pr, s.lot, -1), { message: '수량은 0 보다 커야 합니다' });
    await t.rejects(() => force(t, s.mgr, '00000000-0000-0000-0000-000000000000', s.lot, 1),
      { message: '공정 기록을 찾을 수 없습니다' });
    await t.rejects(() => force(t, s.mgr, s.pr, s.lot, 9));
    t.eq(await left(t, s.lot), 5, '거부된 것은 재고를 줄이지 않는다');
    t.eq(await t.val(`select count(*)::int from record_correction
                       where process_record_id = $1 and field = 'material_issue'`, [s.pr]), 0, '정정 내역도 없다');
  },
},

{
  id: 'FI-06', expect: '통과',
  name: '구성표 밖 자재도 받는다 - 재고에서 빠지고 정정 내역에 (구성표 밖) 이 붙는다',
  async run(t) {
    const m = await master(t);
    const s = await setup(t, m, { locked: true });
    const before = await left(t, s.a);   // 원액 원료로 3 이 이미 빠져 있다
    const id = (await force(t, s.mgr, s.pr, s.a, 1))[0].id;
    t.eq(await t.val(`select forced from material_issue where id = $1`, [id]), true, '강제 투입 줄');
    t.eq(await left(t, s.a), before - 1, '재고에서 빠진다');
    const nv = await t.val(
      `select new_value from record_correction where process_record_id = $1 and field = 'material_issue'`, [s.pr]);
    t.ok(nv.endsWith(' (구성표 밖)'), '정정 내역 끝에 (구성표 밖): ' + nv);
  },
},

{
  id: 'FI-05', expect: '확인',
  name: '강제 투입은 인쇄 자료에 들지 않는다 (dayRecordPayload 질의에서 forced 를 뺀다)',
  async run(t) {
    /*
     * lib/print-payload.ts 는 @/ 별칭 · TypeScript 라 시험에서 바로 부를 수 없다. 그래서 질의 조각이
     * 강제 투입을 빼는지를 원문으로 지키고, 실제 인쇄 결과가 그대로인지는 npm run test:print
     * (기존 287 일치) 가 본다.
     */
    const src = readFileSync(new URL('../../lib/print-payload.ts', import.meta.url), 'utf8');
    const from = src.indexOf('from material_issue mi');
    t.ok(from > 0, 'material_issue 질의가 있다');
    t.ok(/where mi\.process_record_id = pr\.id\s+and not mi\.forced/.test(src.slice(from, from + 300)),
      '인쇄 자료의 투입 질의가 forced 를 뺀다');
  },
},

];
