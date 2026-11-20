// =============================================================================
// 30_carry_open.mjs - 여러 날에 걸친 공정은 끝나는 일차로 넘긴다 (0146)
// 근거: 사용자 2026-11-20 «4일차까지 넘어가는게 있는데 어떻게 처리» → «끝나는 일차로»
//
// 일차를 마감하기 전에 진행 중 공정을 다음 일차 · 그 작업일로 넘기고, 그 일차는 마감되는지,
// 넘긴 공정은 다음 일차에서 이어 적고 마감되는지, 정정 내역이 남는지, 막을 것은 막는지 본다.
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

/* 사유로 마감하는 공정 기록 (작업일 n 일 앞) */
async function rec(t, m, wo, { op, daysAgo, ended = true }) {
  await t.setActor(m.admin);
  const id = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date,
       worker_id, no_material_reason, started_at)
     values ($1,$2,1,current_date - $3::int,$4,'자재 사용 없음', now() - make_interval(days => $3::int))
     returning id`, [wo.id, m.ops[op], daysAgo, m.worker]);
  if (ended) await t.rows(`select complete_process($1)`, [id]);
  await t.setActor(null);
  return id;
}

/* 작업자 m.worker 의 묶음을 actor 가 넘긴다 */
const carry = (t, m, actor, wo, day, date) => asUser(t, actor, () =>
  t.val(`select carry_open_records($1, $2, $3, $4::date)`, [wo.id, day, m.worker, date]));

export default [

{
  id: 'CR-01', expect: '통과',
  name: '진행 중 공정을 다음 일차 · 작업일로 넘기고 그 일차를 마감 · 넘긴 공정은 다음 일차에서 마감',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rows(`update work_order set issued_at = now() - interval '10 days' where id = $1`, [wo.id]);
    const done = await rec(t, m, wo, { op: 'WS-DX2401-03', daysAgo: 3 });
    const open = await rec(t, m, wo, { op: 'WS-DX2401-04', daysAgo: 3, ended: false });
    const next = await t.val(`select (current_date - 2)::text`);

    t.eq(await carry(t, m, m.worker, wo, 1, next), 1, '넘긴 공정 1건');
    t.eq(await t.rows(`select day_no, work_date::text as wd from process_record where id = $1`, [open]),
      [{ day_no: 2, wd: next }], '다음 일차 · 그 작업일');
    t.eq(await t.val(`select day_no from process_record where id = $1`, [done]), 1, '끝난 공정은 그대로');
    t.eq(await t.val(
      `select count(*)::int from record_correction
        where process_record_id = $1 and field in ('day_no','work_date') and before_close`, [open]), 2, '정정 내역');

    await asUser(t, m.worker, () => t.rows(`select lock_day($1, 1, $2)`, [wo.id, m.worker]));
    t.ok(await t.val(`select is_locked($1, 1, $2)`, [wo.id, m.worker]), '1일차 마감');

    /* 다음 일차에서 이어 적고 마감한다 */
    await asUser(t, m.worker, () => t.rows(`select complete_process_at($1, now())`, [open]));
    t.ok(await t.val(`select ended_at is not null and day_no = 2 from process_record where id = $1`, [open]),
      '2일차에서 공정 마감');
  },
},

{
  id: 'CR-02', expect: '거부',
  name: '미래 작업일 · 넘기는 공정보다 앞선 작업일 · 남의 묶음',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rows(`update work_order set issued_at = now() - interval '10 days' where id = $1`, [wo.id]);
    await rec(t, m, wo, { op: 'WS-DX2401-03', daysAgo: 3, ended: false });
    const d = (n) => t.val(`select (current_date + $1::int)::text`, [n]);
    await t.rejects(async () => carry(t, m, m.worker, wo, 1, await d(1)), { message: '아직 오지 않은 날' });
    await t.rejects(async () => carry(t, m, m.worker, wo, 1, await d(-5)), { message: '앞섭니다' });
    await t.rejects(async () => carry(t, m, m.worker2, wo, 1, await d(-2)), { message: '넘길 수 없습니다' });
  },
},

];
