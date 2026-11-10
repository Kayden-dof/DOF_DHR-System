// =============================================================================
// 17_force_correct.mjs - 구성표 양의 범위 · 잠긴 기록의 강제 정정 (0128)
// 근거: 사용자 2026-11-10 «작업표준서 292 ~ 293 g» · «강제 정정이 좀 필요하겠네»
//
// 범위 안의 값은 검토에 뜨지 않고 범위 밖은 뜨는지, 강제 정정이 시스템관리자의
// 함수 하나로만 열리고 잠금 자체는 그대로인지를 본다.
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder } from '../fixtures.mjs';

/* 응용이 하는 그대로 부른다: app_role 로 내려가 app.user_id 를 세운다 */
async function asUser(t, userId, fn) {
  await t.rows(`select set_config('app.user_id', $1, false)`, [userId ?? '']);
  try {
    return await t.asRole('app_role', fn);
  } finally {
    await t.rows(`select set_config('app.user_id', '', false)`);
  }
}

const flags = (t, woId) => t.rows(`select kind, detail from review_flags($1)`, [woId]);

/*
 * 20장 구간(11~20장, 2통)의 상한을 3으로 둔다. 이 기준정보에는 지시가 이미 나가
 * 있으므로 0089 의 잠금 아래에서 비어 있던 상한을 채우는 길을 그대로 지난다.
 * 한 번 채우면 되돌릴 수 없으므로(그것도 잠금이다) 처음 한 번만 채운다.
 */
async function rangeTier(t, m) {
  const tier = await t.val(
    `select t.id from dmr_bom_tier t join dmr_bom b on b.id = t.dmr_bom_id
      where b.operation_id = $1 and b.component_item_id = $2 and t.min_sheets = 11`,
    [m.ops['WS-DX2401-03'], m.reagent]);
  await t.rows(`update dmr_bom_tier set qty_max = 3 where id = $1 and qty_max is null`, [tier]);
  return tier;
}

async function opWithQty(t, m, qty) {
  const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
  const wo = await newWorkOrder(t, m, { rawLot, sheets: 20 });
  await t.setActor(m.admin);
  const lot = await newMaterialLot(t, m, m.reagent, { qty: 20 });
  const pr = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date,
       worker_id, started_at, ended_at)
     values ($1,$2,1,current_date,$3,
             current_date + interval '8 hours', current_date + interval '9 hours')
     returning id`,
    [wo.id, m.ops['WS-DX2401-03'], m.worker]);
  await t.rows(
    `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
     values ($1,$2,$3,$4)`, [pr, lot, qty, m.admin]);
  return wo;
}

/* 자재 없이 사유로 마감하고 그 일차를 잠근 기록 하나 */
async function lockedReason(t, m, reason = '자재 사용 없음') {
  const wo = await newWorkOrder(t, m);
  await t.setActor(m.admin);
  const pr = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date,
       worker_id, no_material_reason)
     values ($1,$2,1,current_date,$3,$4) returning id`,
    [wo.id, m.ops['WS-DX2401-03'], m.worker, reason]);
  await t.rows(`select complete_process($1)`, [pr]);
  await t.rows(`select lock_day($1,1,$2)`, [wo.id, m.worker]);
  await t.setActor(null);
  return { wo, pr };
}

export default [

{
  id: 'FC-01', expect: '확인',
  name: '구간 양이 범위면 범위 안의 기입량은 구간 이탈이 아니다',
  async run(t) {
    const m = await master(t);
    await rangeTier(t, m);
    const wo = await opWithQty(t, m, 3);
    const rows = await flags(t, wo.id);
    t.eq(rows.filter((r) => r.kind === '구간 이탈').length, 0,
      `범위 안 (${rows.map((r) => r.detail).join(' / ')})`);
  },
},

{
  id: 'FC-02', expect: '확인',
  name: '범위 밖이면 잡고, 문구에 범위를 그대로 적는다',
  async run(t) {
    const m = await master(t);
    await rangeTier(t, m);
    const wo = await opWithQty(t, m, 4);
    const hit = (await flags(t, wo.id)).find((r) => r.kind === '구간 이탈');
    if (!hit) throw new Error('범위 밖 기입량을 잡지 못했다');
    t.ok(hit.detail.includes('2~3'), `범위를 적어야 한다: ${hit.detail}`);
  },
},

{
  id: 'FC-03', expect: '거부',
  name: '지시가 나간 구간의 상한을 다시 고침 · 상한이 하한보다 작은 구간',
  async run(t) {
    const m = await master(t);
    const tier = await rangeTier(t, m);
    await t.rejects(() => t.rows(`update dmr_bom_tier set qty_max = 4 where id = $1`, [tier]),
      { message: '고칠 수 없습니다' });
    await t.rejects(() => t.rows(`update dmr_bom_tier set qty = 3 where id = $1`, [tier]),
      { message: '고칠 수 없습니다' });
    const bom = await t.val(`select dmr_bom_id from dmr_bom_tier where id = $1`, [tier]);
    await t.rejects(() => t.rows(
      `insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty, qty_max)
       values ($1, 31, 40, 5, 4)`, [bom]), { message: 'dmr_bom_tier_qty_max' });
  },
},

{
  id: 'FC-04', expect: '거부',
  name: '잠긴 기록을 app_role 이 직접 고침 (정정 표시를 스스로 걸어도)',
  async run(t) {
    const m = await master(t);
    const { pr } = await lockedReason(t, m);
    await asUser(t, m.admin, async () => {
      await t.rows(`select set_config('app.force_correct', $1, false)`, [pr]);
      try {
        await t.rejects(() => t.rows(
          `update process_record set no_material_reason = '고침' where id = $1`, [pr]),
          { message: 'S04' });
      } finally {
        await t.rows(`select set_config('app.force_correct', '', false)`);
      }
    });
  },
},

{
  id: 'FC-05', expect: '거부',
  name: '시스템관리자가 아닌 계정의 강제 정정',
  async run(t) {
    const m = await master(t);
    const { pr } = await lockedReason(t, m);
    const mgr = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1, 'PROD_MGR')`, [mgr]);
    await asUser(t, mgr, () => t.rejects(() => t.rows(
      `select force_correct_reason($1, '고침', '종이 기록 대조')`, [pr]),
      { message: '시스템관리자만' }));
  },
},

{
  id: 'FC-06', expect: '거부',
  name: '사유 없는 강제 정정 · 잠기지 않은 기록의 강제 정정',
  async run(t) {
    const m = await master(t);
    const { pr } = await lockedReason(t, m);
    await asUser(t, m.admin, () => t.rejects(() => t.rows(
      `select force_correct_reason($1, '고침', '  ')`, [pr]), { message: '사유' }));

    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    const open = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
         worker_id, no_material_reason)
       values ($1,$2,1,current_date,$3,'자재 사용 없음') returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    await t.setActor(null);
    await asUser(t, m.admin, () => t.rejects(() => t.rows(
      `select force_correct_reason($1, '고침', '종이 기록 대조')`, [open]),
      { message: '잠기지 않은' }));
  },
},

{
  id: 'FC-07', expect: '통과',
  name: '시스템관리자의 강제 정정 → 그 칸만 바뀌고 정정 내역 · 감사추적이 남는다',
  async run(t) {
    const m = await master(t);
    const { wo, pr } = await lockedReason(t, m);
    await asUser(t, m.admin, () => t.rows(
      `select force_correct_reason($1, $2, $3)`,
      [pr, '타이벡 파우치 로트 미부여 (기록서 \'-\')', '종이 기록서 대조']));

    t.eq(await t.val(`select no_material_reason from process_record where id = $1`, [pr]),
      '타이벡 파우치 로트 미부여 (기록서 \'-\')', '바뀐 사유');
    const c = await t.rows(
      `select field, old_value, new_value, why, corrected_by::text as by
         from record_correction where process_record_id = $1`, [pr]);
    t.eq(c.length, 1, '정정 내역');
    t.eq(c[0].old_value, '자재 사용 없음', '옛 값');
    t.eq(c[0].by, m.admin, '정정한 사람');
    t.ok(await t.val(
      `select exists (select 1 from audit_log
                       where table_name = 'process_record' and record_id = $1
                         and action = 'UPDATE')`, [pr]), '감사추적');
    t.ok(await t.val(`select is_locked($1, 1, $2)`, [wo.id, m.worker]), '잠금은 그대로');

    /* 정정 뒤에도 같은 기록을 직접 고치는 길은 닫혀 있다 */
    await asUser(t, m.admin, () => t.rejects(() => t.rows(
      `update process_record set no_material_reason = '또' where id = $1`, [pr]),
      { message: 'S04' }));
  },
},

{
  id: 'FC-08', expect: '권한 거부',
  name: 'app_role 이 정정 내역을 직접 적음',
  async run(t) {
    const m = await master(t);
    const { pr } = await lockedReason(t, m);
    await asUser(t, m.admin, () => t.rejects(() => t.rows(
      `insert into record_correction (process_record_id, field, new_value, why, corrected_by)
       values ($1, 'no_material_reason', 'x', 'y', $2)`, [pr, m.admin]),
      { code: '42501' }));
  },
},

{
  id: 'FC-09', expect: '통과',
  name: '작업일 · 시작 · 종료를 종이 기록에 맞춘다 (발행일 앞 작업일 · 칸마다 정정 내역 · 잠금 그대로)',
  async run(t) {
    const m = await master(t);
    const { wo, pr } = await lockedReason(t, m);
    await t.rows(`update work_order set issued_at = now() where id = $1`, [wo.id]);
    const n = await asUser(t, m.admin, () => t.val(
      `select force_correct_times($1, current_date - 2,
              (current_date - 2) + interval '9 hours', (current_date - 1) + interval '8 hours',
              '종이 제조기록서 대조')`, [pr]));
    t.eq(n, 3, '바뀐 칸 수');
    t.eq(await t.val(`select (work_date = current_date - 2) from process_record where id = $1`, [pr]), true, '작업일');
    t.eq(await t.val(`select count(*)::int from record_correction where process_record_id = $1
                        and field in ('work_date','started_at','ended_at')`, [pr]), 3, '정정 내역');
    t.ok(await t.val(`select is_locked($1, 1, $2)`, [wo.id, m.worker]), '잠금은 그대로');
    /* 강제 정정 밖에서는 발행일 앞 작업일이 여전히 막힌다 */
    await asUser(t, m.admin, () => t.rejects(() => t.rows(
      `select force_correct_times($1, null, now() + interval '1 hour', now(), '거꾸로')`, [pr]),
      { message: '종료 시각이' }));
  },
},

{
  id: 'FC-10', expect: '거부',
  name: '기록이 있는 지시의 배치번호를 까닭 없이 바꿈 (까닭이 있으면 바뀐다)',
  async run(t) {
    const m = await master(t);
    const { wo } = await lockedReason(t, m);
    await t.rejects(() => t.rows(`update work_order set batch_no = 'B-FC10-01' where id = $1`, [wo.id]),
      { message: '까닭' });
    await t.rows(`select set_config('app.change_reason', '종이 배치번호', false)`);
    try {
      await t.rows(`update work_order set batch_no = 'B-FC10-01' where id = $1`, [wo.id]);
    } finally {
      await t.rows(`select set_config('app.change_reason', '', false)`);
    }
    t.eq(await t.val(`select batch_no from work_order where id = $1`, [wo.id]), 'B-FC10-01', '바뀐 번호');
    await t.rejects(() => t.rows(`update work_order set sheet_count = sheet_count + 1 where id = $1`, [wo.id]),
      { message: '장입 장수' });
  },
},

];
