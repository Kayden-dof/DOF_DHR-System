// =============================================================================
// 37_force_br.mjs - 관리자 기록서 정정 · «-» 사용 안 함은 기입 누락이 아니다 (0155)
// 근거: 사용자 2026-11-20 «관리자는 수정 기록할수있게 열어줘» · «내가 - 사용안함으로 기록한건데
//       기록누락이라고 말하면 어떻게 하니?»
//
// 잠긴 일차의 칸은 작업자가 못 고치고, 생산관리자는 사유와 함께 그 칸 하나를 고치며 정정 내역 ·
// 감사추적에 남는지, 권한 · 사유 · 같은 값은 막는지, «사용 안 함 · …» 사유는 기입 누락으로 짚지
// 않는지 본다.
// =============================================================================

import { masterData as master, newWorkOrder } from '../fixtures.mjs';

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

let DOC = null;
const doc = (t, m) => (DOC ??= t.val(
  `insert into mfg_doc (product_code, op_code, kind, doc_no, title, revision, registered_by, form)
   values ('FB-TEST', 'WS-DX2401-03', 'BR', 'F706-FB-03', '시험 기록서', 'Rev.00', $1,
           '{"page":{"w":842,"h":595},"pages":[{"texts":[],"tables":[]}]}'::jsonb)
   returning id`, [m.admin]));

/* 작업자가 칸 하나를 적고 공정을 마감한 뒤 그 일차를 잠근 기록 */
async function lockedRecord(t, m) {
  const wo = await newWorkOrder(t, m);
  const d = await doc(t, m);
  await t.setActor(m.admin);
  const pr = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id,
       no_material_reason, started_at)
     values ($1,$2,1,current_date,$3,'자재 사용 없음', now()) returning id`,
    [wo.id, m.ops['WS-DX2401-03'], m.worker]);
  await t.setActor(null);
  await asUser(t, m.worker, async () => {
    await t.rows(`insert into br_entry (process_record_id, doc_id, field, value, entered_by)
                  values ($1,$2,'p0t1r2c3','585',$3)`, [pr, d, m.worker]);
    await t.rows(`select complete_process($1)`, [pr]);
    await t.rows(`select lock_day($1, 1, $2)`, [wo.id, m.worker]);
  });
  const mgr = await t.newUser({ full_name: '생산관리자정정' });
  await grant(t, mgr, 'PROD_MGR');
  return { wo, d, pr, mgr };
}

const force = (t, user, pr, d, value, why = '종이 기록서에 맞춤') => asUser(t, user, () =>
  t.rows(`select force_br_entry($1, $2, 'p0t1r2c3', $3, $4, '염화나트륨 · 결과')`, [pr, d, value, why]));

export default [

{
  id: 'FB-01', expect: '통과',
  name: '잠긴 일차의 칸을 생산관리자가 사유와 함께 고친다 · 정정 내역 · 감사추적 · 정정 표시',
  async run(t) {
    const m = await master(t);
    const { d, pr, mgr } = await lockedRecord(t, m);
    await t.rejects(() => asUser(t, m.worker, () => t.rows(
      `update br_entry set value = '293' where process_record_id = $1`, [pr])), { message: 'S04' });
    await force(t, mgr, pr, d, '293');
    t.eq(await t.rows(`select value, forced from br_entry where process_record_id = $1 and field = 'p0t1r2c3'`, [pr]),
      [{ value: '293', forced: true }], '값 · 정정 표시');
    t.eq(await t.rows(
      `select old_value, new_value, why from record_correction where process_record_id = $1 and field = 'br_entry'`, [pr]),
      [{ old_value: '염화나트륨 · 결과 · 585', new_value: '293', why: '종이 기록서에 맞춤' }], '정정 내역');
    t.ok(await t.val(
      `select count(*) > 0 from audit_log where table_name = 'br_entry' and reason like '기록서 정정 · %'`), '감사추적 사유');
    /* 잠금은 그대로 - 작업자는 여전히 못 고친다 */
    await t.rejects(() => asUser(t, m.worker, () => t.rows(
      `update br_entry set value = '1' where process_record_id = $1`, [pr])), { message: 'S04' });
  },
},

{
  id: 'FB-02', expect: '거부',
  name: '작업자의 정정 · 사유 없음 · 같은 값 · 칸 자리 틀림',
  async run(t) {
    const m = await master(t);
    const { d, pr, mgr } = await lockedRecord(t, m);
    await grant(t, m.worker, 'WORKER');
    await t.rejects(() => force(t, m.worker, pr, d, '293'), { message: '생산관리자 또는 시스템관리자' });
    await t.rejects(() => force(t, mgr, pr, d, '293', ' '), { message: '왜 고치는지' });
    await t.rejects(() => force(t, mgr, pr, d, '585'), { message: '지금 값과 같습니다' });
    await t.rejects(() => asUser(t, mgr, () => t.rows(
      `select force_br_entry($1, $2, 'x', '1', '사유')`, [pr, d])), { message: '칸 자리' });
  },
},

{
  id: 'FB-03', expect: '통과',
  name: '«사용 안 함 · …» 사유로 마감한 기록은 기입 누락으로 짚지 않는다 (다른 사유는 짚는다)',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    const op = m.ops['WS-DX2401-03'];
    const mk = (why) => t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id,
         no_material_reason, started_at, ended_at)
       values ($1,$2,1,current_date,$3,$4, now() - interval '1 hour', now()) returning id`,
      [wo.id, op, m.worker, why]);
    await mk('사용 안 함 · 파우치 라벨');
    const missing = async () => (await t.rows(`select kind, detail from review_flags($1)`, [wo.id]))
      .filter((r) => r.kind === '기입 누락' && r.detail.includes('자재를 기록하지 않고'));
    t.eq((await missing()).length, 0, '«-» 사용 안 함은 짚지 않는다');
    await t.rows(`update process_record set no_material_reason = '자재 사용 없음' where work_order_id = $1`, [wo.id]);
    t.eq((await missing()).length, 1, '다른 사유는 짚는다');
    await t.setActor(null);
  },
},

];
