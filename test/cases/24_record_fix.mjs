// =============================================================================
// 24_record_fix.mjs - 마감 전 기록의 일차 · 작업일 · 시각 고치기 (0139)
// 근거: 사용자 2026-11-20 «제조기록서의 작성 일차(작업일)를 고칠 수 있는 권한»
//       결정: 고치기 + 직접 넣기 · 본인 · 생산관리자 · 시스템관리자 · 발행일 규칙은 그대로
//
// 마감 전 기록만 고쳐지고 잠긴 묶음은 어느 쪽으로도 열리지 않는지, 고친 칸마다
// 정정 내역과 감사추적이 남는지, 작업일 규칙(0052)과 S05 를 비켜 가지 않는지 본다.
// =============================================================================

import { masterData as master, newWorkOrder } from '../fixtures.mjs';

/* 응용이 하는 그대로 부른다: app_role 로 내려가 app.user_id 를 세운다 */
async function asUser(t, userId, fn) {
  await t.rows(`select set_config('app.user_id', $1, false)`, [userId ?? '']);
  try {
    return await t.asRole('app_role', fn);
  } finally {
    await t.rows(`select set_config('app.user_id', '', false)`);
  }
}

/* 사유로 마감한 기록 하나. ended 가 거짓이면 종료 칸이 빈 채로 둔다 */
async function rec(t, m, wo, { day = 1, op = 'WS-DX2401-03', worker, ended = true, workDate = 'current_date' } = {}) {
  await t.setActor(m.admin);
  const id = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date,
       worker_id, no_material_reason, started_at)
     values ($1,$2,$3,${workDate},$4,'자재 사용 없음', now() - interval '2 hours') returning id`,
    [wo.id, m.ops[op], day, worker ?? m.worker]);
  if (ended) await t.rows(`select complete_process($1)`, [id]);
  await t.setActor(null);
  return id;
}

const fix = (t, actor, pr, day, wd, st, en, why = '종이 기록서에 맞춤') =>
  asUser(t, actor, () => t.val(
    `select fix_record_day($1, $2::int, $3::date, $4::timestamptz, $5::timestamptz, $6)`,
    [pr, day, wd, st, en, why]));

export default [

{
  id: 'RF-01', expect: '통과',
  name: '작업자 본인이 마감 전 기록을 다른 일차로 옮기고 작업일을 고친다 → 칸마다 정정 내역 · 감사추적 사유',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rows(`update work_order set issued_at = now() - interval '5 days' where id = $1`, [wo.id]);
    const a = await rec(t, m, wo, { day: 1 });
    const b = await rec(t, m, wo, { day: 1, op: 'WS-DX2401-04' });
    const yesterday = await t.val(`select (current_date - 1)::text`);

    const n = await fix(t, m.worker, b, 2, yesterday, null, null);
    t.eq(n, 2, '바뀐 칸 수 (일차 · 작업일)');
    const r = await t.rows(`select day_no, work_date::text as wd from process_record where id = $1`, [b]);
    t.eq(r[0], { day_no: 2, wd: yesterday }, '옮겨진 기록');
    t.eq(await t.val(`select day_no from process_record where id = $1`, [a]), 1, '다른 기록은 그대로');

    const c = await t.rows(
      `select field, old_value, new_value, why, before_close, corrected_by::text as by
         from record_correction where process_record_id = $1 order by field`, [b]);
    t.eq(c.map((x) => [x.field, x.old_value, x.new_value]),
      [['day_no', '1', '2'], ['work_date', await t.val(`select current_date::text`), yesterday]], '정정 내역');
    t.ok(c.every((x) => x.before_close === true && x.by === m.worker && x.why === '종이 기록서에 맞춤'),
      '마감 전 고침 · 고친 사람 · 사유');
    t.ok(await t.val(
      `select exists (select 1 from audit_log
                       where table_name = 'process_record' and record_id = $1
                         and action = 'UPDATE' and reason like '고침 · %')`, [b]), '감사추적 사유');
  },
},

{
  id: 'RF-02', expect: '통과',
  name: '생산관리자는 남의 기록을 고친다 · 시작 · 종료 시각도',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await rec(t, m, wo);
    const mgr = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1, 'PROD_MGR')`, [mgr]);
    const st = await t.val(`select to_char(date_trunc('minute', now() - interval '90 minutes'), 'YYYY-MM-DD"T"HH24:MI:SSOF')`);
    const en = await t.val(`select to_char(date_trunc('minute', now() - interval '30 minutes'), 'YYYY-MM-DD"T"HH24:MI:SSOF')`);
    t.eq(await fix(t, mgr, pr, null, null, st, en), 2, '시작 · 종료');
    t.eq(await t.val(`select count(*)::int from record_correction
                       where process_record_id = $1 and field in ('started_at','ended_at')
                         and corrected_by = $2`, [pr, mgr]), 2, '정정 내역');
  },
},

{
  id: 'RF-03', expect: '거부',
  name: '역할 없는 다른 작업자가 남의 기록을 고침',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await rec(t, m, wo);
    await t.rejects(() => fix(t, m.worker2, pr, 2, null, null, null), { message: '다른 사람의' });
  },
},

{
  id: 'RF-04', expect: '거부',
  name: '잠긴 묶음의 기록을 고침 · 잠긴 일차로 옮김 (잠금은 그대로)',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const locked = await rec(t, m, wo, { day: 1 });
    const open = await rec(t, m, wo, { day: 2, op: 'WS-DX2401-04' });
    await t.setActor(m.admin);
    await t.rows(`select lock_day($1, 1, $2)`, [wo.id, m.worker]);
    await t.setActor(null);

    await t.rejects(() => fix(t, m.admin, locked, 2, null, null, null), { message: '마감된 1일차' });
    await t.rejects(() => fix(t, m.admin, open, 1, null, null, null), { message: '이미 마감' });
    t.ok(await t.val(`select is_locked($1, 1, $2)`, [wo.id, m.worker]), '잠금은 그대로');
    t.eq(await t.val(`select day_no from process_record where id = $1`, [locked]), 1, '잠긴 기록 그대로');
  },
},

{
  id: 'RF-05', expect: '거부',
  name: '작업 지시 발행일 앞 작업일 · 미래 작업일 (0052 그대로)',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await rec(t, m, wo);
    const d = (n) => t.val(`select (current_date + $1::int)::text`, [n]);
    await t.rejects(async () => fix(t, m.worker, pr, null, await d(-1), null, null), { message: '발행일' });
    await t.rejects(async () => fix(t, m.worker, pr, null, await d(1), null, null), { message: '아직 오지 않은 날' });
  },
},

{
  id: 'RF-06', expect: '거부',
  name: '사유 없음 · 열린 기록에 종료 · 종료가 시작 앞 · 미래 시각 · 마지막 일차를 건너뜀 · 같은 값',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const done = await rec(t, m, wo);
    const open = await rec(t, m, wo, { op: 'WS-DX2401-04', ended: false });
    await t.rejects(() => fix(t, m.worker, done, 2, null, null, null, '  '), { message: '왜 고치는지' });
    await t.rejects(() => fix(t, m.worker, open, null, null, null,
      new Date(Date.now() - 600_000).toISOString()), { message: '아직 마감하지 않은' });
    await t.rejects(() => fix(t, m.worker, done, null, null,
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() - 7_200_000).toISOString()),
      { message: '종료 시각이 시작' });
    await t.rejects(() => fix(t, m.worker, done, null, null,
      new Date(Date.now() + 3_600_000).toISOString(), null), { message: '아직 오지 않은 시각' });
    await t.rejects(() => fix(t, m.worker, done, 3, null, null, null), { message: '옮길 수 없습니다' });
    await t.rejects(() => fix(t, m.worker, done, 1, null, null, null), { message: '지금 값과 같습니다' });
    t.eq(await t.val(`select count(*)::int from record_correction where process_record_id in ($1, $2)`,
      [done, open]), 0, '거부된 고침은 내역을 남기지 않는다');
  },
},

{
  id: 'RF-07', expect: '통과',
  name: '발행일보다 앞선 옛 작업일 기록도 일차는 옮긴다 (그 날짜를 다시 묻지 않는다)',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.rows(`update work_order set issued_at = now() - interval '5 days' where id = $1`, [wo.id]);
    const pr = await rec(t, m, wo, { workDate: 'current_date - 3' });
    await rec(t, m, wo, { day: 2, op: 'WS-DX2401-04' });
    /* DHR 발행이 종이보다 늦게 옮겨 적힌 배치 - 지금은 발행일이 그 작업일보다 뒤다 */
    await t.rows(`update work_order set issued_at = now() where id = $1`, [wo.id]);
    t.eq(await fix(t, m.worker, pr, 2, null, null, null), 1, '일차만');
    t.eq(await t.val(`select day_no from process_record where id = $1`, [pr]), 2, '옮겨진 일차');
    await t.rejects(async () => fix(t, m.worker, pr, null,
      await t.val(`select (current_date - 2)::text`), null, null), { message: '발행일' });
  },
},

{
  id: 'RF-08', expect: '통과',
  name: '열린 기록을 다른 일차로 옮기면 남은 일차가 마감된다 (B261104-01 의 막힘)',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await rec(t, m, wo, { day: 2 });
    const open = await rec(t, m, wo, { day: 2, op: 'WS-DX2401-04', ended: false });
    await t.setActor(m.admin);
    await t.rejects(() => t.rows(`select lock_day($1, 2, $2)`, [wo.id, m.worker]),
      { message: '종료 시각이 없는' });
    await t.setActor(null);

    t.eq(await fix(t, m.worker, open, 3, null, null, null), 1, '3일차로');
    await asUser(t, m.worker, () => t.rows(`select lock_day($1, 2, $2)`, [wo.id, m.worker]));
    t.ok(await t.val(`select is_locked($1, 2, $2)`, [wo.id, m.worker]), '2일차 마감');
    t.ok(!(await t.val(`select is_locked($1, 3, $2)`, [wo.id, m.worker])), '3일차는 작성 중');
  },
},

{
  id: 'RF-09', expect: '통과',
  name: '적은 종료 시각으로 공정 마감 · S05 에 막히면 종료 칸도 남지 않는다 · 미래 · 시작 앞 거부',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    /* 시약이 구성표에 걸린 공정 - 자재 없이 사유도 없이 마감하면 S05 */
    await t.setActor(m.admin);
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id, started_at)
       values ($1,$2,1,current_date,$3, now() - interval '3 hours') returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    await t.setActor(null);
    const at = (ms) => new Date(Date.now() + ms).toISOString();

    await t.rejects(() => asUser(t, m.worker, () => t.rows(
      `select complete_process_at($1, $2::timestamptz)`, [pr, at(-3_600_000)])), { message: 'S05' });
    t.eq(await t.val(`select ended_at is null from process_record where id = $1`, [pr]), true,
      'S05 에 막히면 종료 칸이 비어 있다');
    await t.rejects(() => asUser(t, m.worker, () => t.rows(
      `select complete_process_at($1, $2::timestamptz)`, [pr, at(3_600_000)])), { message: '아직 오지 않은' });
    await t.rejects(() => asUser(t, m.worker, () => t.rows(
      `select complete_process_at($1, $2::timestamptz)`, [pr, at(-4 * 3_600_000)])), { message: '시작 시각' });

    await t.rows(`update process_record set no_material_reason = '해당 공정 미실시' where id = $1`, [pr]);
    const end = await t.val(`select date_trunc('minute', now() - interval '1 hour')::text`);
    await asUser(t, m.worker, () => t.rows(`select complete_process_at($1, $2::timestamptz)`, [pr, end]));
    t.eq(await t.val(`select ended_at = $2::timestamptz from process_record where id = $1`, [pr, end]), true,
      '적은 종료 시각');
  },
},

{
  id: 'RF-10', expect: '권한 거부',
  name: '열람 역할이 고치기 · 적은 시각 마감을 부름',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const pr = await rec(t, m, wo);
    await t.rows(`select set_config('app.user_id', $1, false)`, [m.admin]);
    try {
      await t.asRole('app_readonly', async () => {
        await t.rejects(() => t.rows(
          `select fix_record_day($1, 2, null, null, null, '열람')`, [pr]), { code: '42501' });
        await t.rejects(() => t.rows(
          `select complete_process_at($1, null)`, [pr]), { code: '42501' });
      });
    } finally {
      await t.rows(`select set_config('app.user_id', '', false)`);
    }
  },
},

];
