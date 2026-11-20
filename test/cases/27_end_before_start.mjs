// =============================================================================
// 27_end_before_start.mjs - 종료 시각이 시작 시각보다 앞서도 막지 않는다 (0142)
// 근거: 사용자 2026-11-20 «어디서 시작 시간이 잡혀있길래 종료일시를 못적게 되어있는지
//       확인해주고. 제한 사항 삭제해줘.» - B261104-01 WS-01 은 11-20 10:16 에 시작을
//       눌렀고 종이의 종료는 11-04 11:30 이었다.
//
// 공정 마감 · 마감 전 고치기 · 잠긴 기록의 강제 정정 세 길 모두 종료 < 시작 을 받는지,
// 그리고 나머지 규칙(미래 시각)은 그대로인지 본다.
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

/* 시작만 한 기록 (지금 시작) */
async function started(t, m, wo, op = 'WS-DX2401-03') {
  await t.setActor(m.admin);
  const id = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date,
       worker_id, no_material_reason, started_at)
     values ($1,$2,1,current_date,$3,'자재 사용 없음', now() - interval '5 minutes') returning id`,
    [wo.id, m.ops[op], m.worker]);
  await t.setActor(null);
  return id;
}

export default [

{
  id: 'EB-01', expect: '통과',
  name: '공정 마감에 시작보다 앞선 종료를 적는다 → 그대로 마감된다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rows(`update work_order set issued_at = now() - interval '20 days' where id = $1`, [wo.id]);
    const pr = await started(t, m, wo);
    await asUser(t, m.worker, () =>
      t.rows(`select complete_process_at($1, now() - interval '16 days')`, [pr]));
    t.eq(await t.val(`select ended_at < started_at from process_record where id = $1`, [pr]), true,
      '종료가 시작보다 앞선 채 마감');
  },
},

{
  id: 'EB-02', expect: '통과',
  name: '마감 전 고치기 · 강제 정정도 종료가 시작보다 앞선 값을 받는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rows(`update work_order set issued_at = now() - interval '20 days' where id = $1`, [wo.id]);
    const pr = await started(t, m, wo);
    await asUser(t, m.worker, () =>
      t.rows(`select complete_process_at($1, now() - interval '3 minutes')`, [pr]));
    /* 마감 전 고치기: 시작을 종료 뒤로 */
    await asUser(t, m.worker, () => t.val(
      `select fix_record_day($1, null, null, now() - interval '1 minute', null, '종이 기록서에 맞춤')`, [pr]));
    t.eq(await t.val(`select ended_at < started_at from process_record where id = $1`, [pr]), true, '고치기');

    /* 잠근 뒤 강제 정정 (시스템관리자): 종료를 시작보다 한참 앞으로 */
    await t.setActor(m.admin);
    await t.rows(`select lock_day($1, 1, $2)`, [wo.id, m.worker]);
    await t.setActor(null);
    await asUser(t, m.admin, () => t.val(
      `select force_correct_times($1, null, null, now() - interval '10 days', '종이 기록서에 맞춤')`, [pr]));
    t.eq(await t.val(`select ended_at < started_at - interval '9 days' from process_record where id = $1`, [pr]),
      true, '강제 정정');
  },
},

{
  id: 'EB-04', expect: '통과',
  name: '작업일보다 앞선 날로 마감하면 작업일도 그 날로 · 정정 내역 · 발행일 앞으로는 옮기지 않음 (0143)',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rows(`update work_order set issued_at = now() - interval '20 days' where id = $1`, [wo.id]);
    const pr = await started(t, m, wo);
    await asUser(t, m.worker, () =>
      t.rows(`select complete_process_at($1, now() - interval '16 days')`, [pr]));
    t.eq(await t.val(
      `select work_date = (timezone('Asia/Seoul', ended_at))::date from process_record where id = $1`, [pr]),
      true, '작업일 = 마감한 날');
    t.eq(await t.val(
      `select count(*)::int from record_correction
        where process_record_id = $1 and field = 'work_date' and before_close`, [pr]), 1, '정정 내역');

    /* 발행일보다 앞선 날로 마감하면 작업일은 그대로 두고 마감만 한다 */
    const wo2 = await newWorkOrder(t, m);
    await t.rows(`update work_order set issued_at = now() - interval '2 days' where id = $1`, [wo2.id]);
    const pr2 = await started(t, m, wo2);
    await asUser(t, m.worker, () =>
      t.rows(`select complete_process_at($1, now() - interval '10 days')`, [pr2]));
    t.eq(await t.val(`select work_date = current_date and ended_at is not null from process_record where id = $1`,
      [pr2]), true, '발행일 앞은 작업일을 두고 마감');
  },
},

{
  id: 'EB-03', expect: '거부',
  name: '미래 종료 시각은 그대로 막는다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await started(t, m, wo);
    await t.rejects(() => asUser(t, m.worker, () =>
      t.rows(`select complete_process_at($1, now() + interval '1 hour')`, [pr])), { message: '아직 오지 않은' });
  },
},

];
