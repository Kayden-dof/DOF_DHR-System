// =============================================================================
// 25_br_sign.mjs - 제조기록서 서명 칸(작업(검사)자 · 일자) 고치기 (0140)
// 근거: 사용자 2026-11-20 «이부분도 수정 가능하도록 열어주세요. 대신 다른 계정이
//       수정하거나, 날짜가 다른 경우에는 사유를 적도록»
//       결정(권고안): 날짜는 그 기록의 작업일과 견준다 · 작업자는 계정 이름에서 고른다
//
// 작업자 본인이 작업일로 맞추는 것은 사유 없이 되고, 남이 고치거나 작업일과 다른
// 날이면 사유 없이는 막히는지, 미래 날 · 없는 이름 · 종류 바꾸기가 막히는지 본다.
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

let DOC = null;
async function doc(t, m) {
  return (DOC ??= t.val(
    `insert into mfg_doc (product_code, op_code, kind, doc_no, title, revision, registered_by, form)
     values ('BS-TEST', 'WS-DX2401-03', 'BR', 'F706-BS-03', '서명 시험 기록서', 'Rev.00', $1,
             '{"page":{"w":842,"h":595},"pages":[{"texts":[],"tables":[]}]}'::jsonb)
     returning id`, [m.admin]));
}

/* 작업일을 사흘 전으로 둔 기록 (발행일보다 앞서게 - 종이를 늦게 옮겨 적은 배치와 같다) */
async function record(t, m) {
  const wo = await newWorkOrder(t, m);
  await t.setActor(m.admin);
  const pr = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id, started_at)
     values ($1,$2,1,current_date,$3, now()) returning id`,
    [wo.id, m.ops['WS-DX2401-03'], m.worker]);
  await t.setActor(null);
  /* 강제 정정이 한 것처럼 작업일을 옮긴다 (발행일 규칙 0052 는 소유자 권한으로 비켜 둔다) */
  await t.rows(`alter table process_record disable trigger process_record_workdate`);
  await t.rows(`update process_record set work_date = current_date - 3 where id = $1`, [pr]);
  await t.rows(`alter table process_record enable trigger process_record_workdate`);
  return { wo, pr, workDate: await t.val(`select (current_date - 3)::text`) };
}

const sign = (t, pr, d, field, kind, value, why = null) => t.rows(
  `insert into br_entry (process_record_id, doc_id, field, value, entered_by, sign, why)
   values ($1,$2,$3,$4,current_user_id(),$5,$6)
   on conflict (process_record_id, doc_id, field)
     do update set value = excluded.value, sign = excluded.sign, why = excluded.why`,
  [pr, d, field, value, kind, why]);

const nameOf = (t, id) => t.val(`select full_name from app_user where id = $1`, [id]);

export default [

{
  id: 'BS-01', expect: '통과',
  name: '작업자 본인이 서명 일자를 작업일로 맞춘다 (발행일보다 앞서도) · 작업(검사)자 이름을 고른다 → 사유 없이',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { pr, workDate } = await record(t, m);
    const other = await nameOf(t, m.worker2);
    await asUser(t, m.worker, async () => {
      await sign(t, pr, d, 'p0t1r2c5', 'date', workDate);
      await sign(t, pr, d, 'p0t1r2c4', 'worker', other);
    });
    const rows = await t.rows(
      `select field, value, sign, why from br_entry where process_record_id = $1 order by field`, [pr]);
    t.eq(rows.map((x) => [x.field, x.value, x.sign, x.why]),
      [['p0t1r2c4', other, 'worker', null], ['p0t1r2c5', workDate, 'date', null]], '서명 두 칸');
  },
},

{
  id: 'BS-02', expect: '거부',
  name: '작업자 본인이라도 작업일과 다른 날을 사유 없이 적음',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { pr } = await record(t, m);
    const today = await t.val(`select current_date::text`);
    await asUser(t, m.worker, () => t.rejects(() => sign(t, pr, d, 'p0t1r2c5', 'date', today),
      { message: '사유를 적으십시오' }));
  },
},

{
  id: 'BS-03', expect: '통과',
  name: '작업일과 다른 날도 사유를 적으면 된다 → 사유가 줄과 감사추적에 남는다',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { pr } = await record(t, m);
    const today = await t.val(`select current_date::text`);
    await asUser(t, m.worker, () => sign(t, pr, d, 'p0t1r2c5', 'date', today, '  종이에 오늘 날짜로 서명함 '));
    t.eq(await t.val(`select why from br_entry where process_record_id = $1`, [pr]),
      '종이에 오늘 날짜로 서명함', '사유 (앞뒤 빈칸 걷음)');
    t.ok(await t.val(
      `select exists (select 1 from audit_log where table_name = 'br_entry'
                       and new_value->>'why' = '종이에 오늘 날짜로 서명함')`), '감사추적');
  },
},

{
  id: 'BS-04', expect: '거부',
  name: '생산관리자가 남의 기록 서명을 사유 없이 고침 (작업일과 같은 날이어도)',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { pr, workDate } = await record(t, m);
    const mgr = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1, 'PROD_MGR')`, [mgr]);
    await asUser(t, mgr, () => t.rejects(() => sign(t, pr, d, 'p0t1r2c5', 'date', workDate),
      { message: '작업자가 아닌 계정' }));
  },
},

{
  id: 'BS-05', expect: '통과',
  name: '생산관리자가 사유와 함께 고친다 · 비우면(시스템 값으로) 사유 없이 되돌린다',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { pr } = await record(t, m);
    const mgr = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1, 'PROD_MGR')`, [mgr]);
    const who = await nameOf(t, m.worker2);
    await asUser(t, mgr, async () => {
      await sign(t, pr, d, 'p0t1r2c4', 'worker', who, '순환 작업자가 한 공정');
      await sign(t, pr, d, 'p0t1r2c4', 'worker', '');
    });
    const r = await t.rows(`select value, why, entered_by::text as by from br_entry where process_record_id = $1`, [pr]);
    t.eq(r[0], { value: '', why: null, by: mgr }, '되돌린 줄');
  },
},

{
  id: 'BS-06', expect: '거부',
  name: '아직 오지 않은 날',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { pr } = await record(t, m);
    const tomorrow = await t.val(`select (current_date + 2)::text`);
    await asUser(t, m.worker, () => t.rejects(
      () => sign(t, pr, d, 'p0t1r2c5', 'date', tomorrow, '미리 적음'), { message: '아직 오지 않은' }));
  },
},

{
  id: 'BS-07', expect: '거부',
  name: '계정에 없는 이름 · 날짜 모양이 아닌 일자',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { pr } = await record(t, m);
    await asUser(t, m.worker, async () => {
      await t.rejects(() => sign(t, pr, d, 'p0t1r2c4', 'worker', '없는사람', '대신 적음'),
        { message: '사용 중인 계정' });
      await t.rejects(() => sign(t, pr, d, 'p0t1r2c5', 'date', '11/05', '종이에 맞춤'),
        { message: 'YYYY-MM-DD' });
    });
  },
},

{
  id: 'BS-08', expect: '거부',
  name: '서명 칸의 종류를 바꿈 (작업(검사)자 칸을 일자 칸으로)',
  async run(t) {
    const m = await master(t);
    const d = await doc(t, m);
    const { pr, workDate } = await record(t, m);
    const me = await nameOf(t, m.worker);
    await asUser(t, m.worker, async () => {
      await sign(t, pr, d, 'p0t1r2c4', 'worker', me);
      await t.rejects(() => sign(t, pr, d, 'p0t1r2c4', 'date', workDate), { message: '종류는 바꿀 수 없' });
    });
  },
},

];
