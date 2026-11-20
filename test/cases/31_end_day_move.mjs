// =============================================================================
// 31_end_day_move.mjs - 여러 날 공정은 마감하면 끝나는 일차로 간다 (0148)
// 근거: 사용자 2026-11-20 «동결건조 마감일이 11월 10일날 마감됐으면 그 사이 일자는 그냥 쭉 다
//       패싱하게끔 일차 표기가 되는 기능이 필요할듯»
//
// 공정 마감(complete_process_at)의 종료 날이 작업일보다 뒤면 그 기록이 일차 + 걸친 날 수(또는 그
// 날짜로 이미 선 뒤 일차)로 가고 작업일이 종료일이 되는지, 정정 내역이 남는지, 같은 날 끝난
// 공정 · 잠긴 일차는 그대로인지 본다.
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

/* 진행 중 공정 기록 (작업일 n 일 앞 · 일차 day) */
async function open(t, m, wo, { op, daysAgo, day = 1 }) {
  await t.setActor(m.admin);
  const id = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date,
       worker_id, no_material_reason, started_at)
     values ($1,$2,$5,current_date - $3::int,$4,'자재 사용 없음', now() - make_interval(days => $3::int))
     returning id`, [wo.id, m.ops[op], daysAgo, m.worker, day]);
  await t.setActor(null);
  return id;
}

const close = (t, m, pr, ago) => asUser(t, m.worker, () =>
  t.rows(`select complete_process_at($1, now() - make_interval(days => $2::int))`, [pr, ago]));

async function prep(t) {
  const m = await master(t);
  const wo = await newWorkOrder(t, m);
  await t.rows(`update work_order set issued_at = now() - interval '10 days' where id = $1`, [wo.id]);
  return { m, wo };
}

export default [

{
  id: 'ED-01', expect: '통과',
  name: '작업일 3일 전에 시작해 1일 전에 끝난 공정 → 1일차에서 3일차 · 작업일은 끝난 날 · 정정 내역',
  async run(t) {
    const { m, wo } = await prep(t);
    const pr = await open(t, m, wo, { op: 'WS-DX2401-03', daysAgo: 3 });
    await close(t, m, pr, 1);
    t.eq(await t.rows(`select day_no, (work_date = current_date - 1) as wd from process_record where id = $1`, [pr]),
      [{ day_no: 3, wd: true }], '3일차 · 끝난 날');
    t.eq(await t.val(
      `select count(*)::int from record_correction
        where process_record_id = $1 and field in ('day_no','work_date') and before_close
          and why like '여러 날 공정은 끝나는 일차로%'`, [pr]), 2, '정정 내역 2건');
  },
},

{
  id: 'ED-02', expect: '통과',
  name: '끝난 날짜로 이미 선 뒤 일차가 있으면 그 일차로 간다',
  async run(t) {
    const { m, wo } = await prep(t);
    const pr = await open(t, m, wo, { op: 'WS-DX2401-03', daysAgo: 3 });
    /* 다른 공정이 끝난 날(1일 전)에 2일차로 서 있다 */
    const other = await open(t, m, wo, { op: 'WS-DX2401-04', daysAgo: 1, day: 2 });
    await close(t, m, other, 1);
    await close(t, m, pr, 1);
    t.eq(await t.val(`select day_no from process_record where id = $1`, [pr]), 2, '2일차 (그 날짜의 일차)');
  },
},

{
  id: 'ED-03', expect: '통과',
  name: '같은 날 끝난 공정은 그대로 · 일차 · 작업일 정정 내역 없음',
  async run(t) {
    const { m, wo } = await prep(t);
    const pr = await open(t, m, wo, { op: 'WS-DX2401-03', daysAgo: 0 });
    await close(t, m, pr, 0);
    t.eq(await t.rows(`select day_no, (work_date = current_date) as wd from process_record where id = $1`, [pr]),
      [{ day_no: 1, wd: true }], '1일차 그대로');
    t.eq(await t.val(
      `select count(*)::int from record_correction where process_record_id = $1 and field = 'day_no'`, [pr]),
      0, '일차 정정 없음');
  },
},

{
  id: 'ED-04', expect: '통과',
  name: '옮길 일차가 이미 마감되었으면 옮기지 않는다 (잠금은 풀지 않는다)',
  async run(t) {
    const { m, wo } = await prep(t);
    /* 3일차를 먼저 적고 마감해 둔다 */
    const d3 = await open(t, m, wo, { op: 'WS-DX2401-04', daysAgo: 1, day: 3 });
    await close(t, m, d3, 1);
    await asUser(t, m.worker, () => t.rows(`select lock_day($1, 3, $2)`, [wo.id, m.worker]));
    const pr = await open(t, m, wo, { op: 'WS-DX2401-03', daysAgo: 3 });
    await close(t, m, pr, 1);
    t.eq(await t.val(`select day_no from process_record where id = $1`, [pr]), 1, '1일차에 남는다');
  },
},

];
