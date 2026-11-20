// =============================================================================
// 26_wo_issued.mjs - 작업 지시 발행 일시를 종이 지시서에 맞춘다 (0141)
// 근거: 사용자 2026-11-20 «작업지시서 날짜 강제 수정 요청 · 이부분 수정 가능하도록 기능 부여»
//       WO-261103-01: 종이 승인 11-03, DHR 에 11-09 에 옮겨 적어 발행일이 11-09 로 들어감
//
// 시스템관리자만 사유와 함께 고치고, 감사추적에 이전 값과 사유가 남는지, 미래 · 이미
// 적힌 작업일보다 늦은 발행일(0052 를 거꾸로 깨는 길)은 막는지 본다.
// =============================================================================

import { masterData as master, newWorkOrder } from '../fixtures.mjs';

/* 응용이 하는 그대로: app_role 로 내려가 app.user_id · app.change_reason 을 세운다 */
async function asUser(t, userId, reason, fn) {
  await t.rows(`select set_config('app.user_id', $1, false)`, [userId ?? '']);
  await t.rows(`select set_config('app.change_reason', $1, false)`, [reason ?? '']);
  try {
    return await t.asRole('app_role', fn);
  } finally {
    await t.rows(`select set_config('app.user_id', '', false)`);
    await t.rows(`select set_config('app.change_reason', '', false)`);
  }
}

const setIssued = (t, actor, wo, at, why = '발행 일시 고침 · 종이 지시서 승인일에 맞춤') =>
  asUser(t, actor, why, () => t.rows(
    `update work_order set issued_at = $2::timestamptz where id = $1`, [wo.id, at]));

/* 오늘을 기준으로 n 일 뒤(음수면 앞) 한국 시각 정오 */
const noon = (t, n) => t.val(
  `select ((current_date + $1::int)::text || ' 12:00:00+09:00')`, [n]);

/* 공정 기록 하나 (작업일 n 일 앞) */
async function rec(t, m, wo, daysAgo) {
  await t.setActor(m.admin);
  const id = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date,
       worker_id, no_material_reason, started_at)
     values ($1,$2,1,current_date - $3::int,$4,'자재 사용 없음', now() - interval '2 hours') returning id`,
    [wo.id, m.ops['WS-DX2401-03'], daysAgo, m.worker]);
  await t.setActor(null);
  return id;
}

export default [

{
  id: 'WI-01', expect: '통과',
  name: '시스템관리자가 기록이 붙은 지시의 발행 일시를 종이 날짜로 당긴다 → 감사추적에 이전 값 · 사유',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await rec(t, m, wo, 0);
    const before = await t.val(`select issued_at::text from work_order where id = $1`, [wo.id]);
    const at = await noon(t, -6);

    await setIssued(t, m.admin, wo, at);
    t.eq(await t.val(`select issued_at = $2::timestamptz from work_order where id = $1`, [wo.id, at]),
      true, '고친 발행 일시');

    const a = await t.rows(
      `select reason, old_value->>'issued_at' as old_at, actor_id::text as by
         from audit_log
        where table_name = 'work_order' and record_id = $1 and action = 'UPDATE'
        order by id desc limit 1`, [wo.id]);
    t.ok(a.length === 1 && a[0].reason === '발행 일시 고침 · 종이 지시서 승인일에 맞춤', '감사추적 사유');
    t.ok(a[0].old_at != null
      && await t.val(`select $1::timestamptz = $2::timestamptz`, [a[0].old_at, before]), '이전 값이 남는다');
    t.eq(a[0].by, m.admin, '고친 사람');
  },
},

{
  id: 'WI-02', expect: '거부',
  name: '시스템관리자가 아닌 계정 · 사유 없음 · 미래 일시 · 이미 적힌 작업일보다 늦은 발행일',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rows(`update work_order set issued_at = now() - interval '6 days' where id = $1`, [wo.id]);
    await rec(t, m, wo, 3);
    const mgr = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1, 'PROD_MGR')`, [mgr]);
    const before = await t.val(`select issued_at::text from work_order where id = $1`, [wo.id]);

    await t.rejects(async () => setIssued(t, mgr, wo, await noon(t, -5)), { message: '시스템관리자만' });
    await t.rejects(async () => setIssued(t, m.worker, wo, await noon(t, -5)), { message: '시스템관리자만' });
    await t.rejects(async () => setIssued(t, m.admin, wo, await noon(t, -5), '  '), { message: '까닭' });
    await t.rejects(async () => setIssued(t, m.admin, wo, await noon(t, 1)), { message: '아직 오지 않은' });
    await t.rejects(async () => setIssued(t, m.admin, wo, await noon(t, -1)), { message: '작업일' });
    t.eq(await t.val(`select issued_at::text from work_order where id = $1`, [wo.id]), before,
      '거부된 고침은 값을 바꾸지 않는다');
  },
},

{
  id: 'WI-03', expect: '통과',
  name: '작업일과 같은 날로는 고친다 · 기록이 없는 지시는 앞뒤로 고친다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rows(`update work_order set issued_at = now() - interval '6 days' where id = $1`, [wo.id]);
    await rec(t, m, wo, 3);
    await setIssued(t, m.admin, wo, await noon(t, -3));
    t.eq(await t.val(`select (issued_at at time zone 'Asia/Seoul')::date = current_date - 3
                        from work_order where id = $1`, [wo.id]), true, '작업일과 같은 날');

    const bare = await newWorkOrder(t, m);
    await setIssued(t, m.admin, bare, await noon(t, -2));
    await setIssued(t, m.admin, bare, await noon(t, -1));
    t.eq(await t.val(`select (issued_at at time zone 'Asia/Seoul')::date = current_date - 1
                        from work_order where id = $1`, [bare.id]), true, '기록이 없으면 늦출 수도 있다');
  },
},

];
