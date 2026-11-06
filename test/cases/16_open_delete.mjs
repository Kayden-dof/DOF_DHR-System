// =============================================================================
// 16_open_delete.mjs - 감사추적 비우기 · 쓰지 않은 계정 지우기 (0122)
// 근거: 사용자 지시 2026-11-06 (생산팀 내부 운영 시스템, GMP 는 별도 시스템)
//
// 열린 길은 함수 둘뿐이고, 한 줄씩 지우는 길은 그대로 막혀 있는지를 함께 본다.
// 감사추적을 실제로 비우므로 08_purge 바로 앞에서 돈다 (run.mjs).
// =============================================================================

/* 응용이 하는 그대로 부른다: app_role 로 내려가 app.user_id 를 세운다 */
async function asUser(t, userId, fn) {
  await t.rows(`select set_config('app.user_id', $1, false)`, [userId ?? '']);
  try {
    return await t.asRole('app_role', fn);
  } finally {
    await t.rows(`select set_config('app.user_id', '', false)`);
  }
}

async function sysAdmin(t) {
  const id = await t.newUser();
  await t.rows(`insert into user_role (user_id, role) values ($1, 'SYS_ADMIN')`, [id]);
  return id;
}

let itemSeq = 0;

export default [

{
  id: 'DEL-01', expect: '거부',
  name: '시스템관리자가 아닌 계정의 감사추적 비우기',
  async run(t) {
    const mgr = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1, 'PROD_MGR')`, [mgr]);
    await asUser(t, mgr, () =>
      t.rejects(() => t.rows(`select purge_logs()`), { message: '시스템관리자만' }));
  },
},

{
  id: 'DEL-02', expect: '권한 거부',
  name: 'app_role 이 비우기 설정을 스스로 켜고 audit_log DELETE',
  async run(t) {
    await t.asRole('app_role', async () => {
      await t.rows(`select set_config('dhr.purge_logs', 'on', false)`);
      try {
        await t.rejects(() => t.rows(`delete from audit_log`), { code: '42501' });
      } finally {
        await t.rows(`select set_config('dhr.purge_logs', '', false)`);
      }
    });
  },
},

{
  id: 'DEL-03', expect: '거부',
  name: '표 소유자가 비우기 함수 밖에서 audit_log DELETE',
  async run(t) {
    await t.rejects(() => t.rows(`delete from audit_log`), { message: 'S03' });
  },
},

{
  id: 'DEL-04', expect: '통과',
  name: '시스템관리자의 감사추적 비우기 → 비운 사실 1줄만 남는다',
  async run(t) {
    const admin = await sysAdmin(t);
    await t.rows(`insert into login_attempt (login_code) values ('99999')`);
    const before = await t.val(`select count(*)::int from audit_log`);
    t.ok(before > 1, '비우기 전에 감사기록이 있어야 한다');

    const n = await asUser(t, admin, () => t.val(`select purge_logs()`));
    t.eq(Number(n), before, '지운 건수');

    const left = await t.rows(`select table_name, action, actor_id::text as actor_id,
                                      (new_value->>'deleted')::int as deleted
                                 from audit_log`);
    t.eq(left.length, 1, '남은 줄');
    t.eq(left[0].action, 'PURGE', '남은 줄의 작업');
    t.eq(left[0].actor_id, admin, '남은 줄의 수행자');
    t.eq(left[0].deleted, before, '남은 줄에 적힌 건수');
    t.eq(await t.val(`select count(*)::int from login_attempt`), 0, '로그인 실패 기록');
  },
},

{
  id: 'DEL-05', expect: '거부',
  name: '비우기가 끝난 뒤 소유자의 audit_log DELETE (설정이 남지 않는다)',
  async run(t) {
    await t.rejects(() => t.rows(`delete from audit_log`), { message: 'S03' });
    t.ok(await t.val(`select count(*)::int from audit_log`) > 0, '감사기록이 남아 있어야 한다');
  },
},

{
  id: 'DEL-06', expect: '거부',
  name: '감사추적에 수행자로 남은 계정 삭제',
  async run(t) {
    const admin = await sysAdmin(t);
    const worker = await t.newUser();
    /* worker 가 무언가를 바꾼다 - 감사추적에 수행자로 찍힌다 */
    await asUser(t, worker, () =>
      t.rows(`update app_user set full_name = full_name where id = $1`, [worker]));
    t.eq(await t.val(`select user_unused($1)`, [worker]), false, '판정');
    await asUser(t, admin, () =>
      t.rejects(() => t.rows(`select delete_unused_user($1)`, [worker]),
                { message: '남긴 기록' }));
    t.eq(await t.val(`select count(*)::int from app_user where id = $1`, [worker]), 1, '계정이 남는다');
  },
},

{
  id: 'DEL-07', expect: '거부',
  name: '다른 표가 가리키는 계정 삭제 (채번 규칙 등록자)',
  async run(t) {
    const admin = await sysAdmin(t);
    const reg = await t.newUser();
    itemSeq += 1;
    /* 수행자 없이 넣어 감사추적이 아니라 참조만으로 막히는지 본다 */
    const item = await t.val(
      `insert into item (code, name, type, purchase_uom, usage_uom)
       values ($1, $2, 'REAGENT', 'EA', 'EA') returning id`,
      [`DELT-${itemSeq}`, `삭제시험품목${itemSeq}`]);
    await t.rows(
      `insert into numbering_rule (target, item_id, pattern, reset, effective_from, registered_by)
       values ('MATERIAL_LOT', $1, 'DT-{SEQ:3}', 'NEVER', current_date, $2)`, [item, reg]);
    t.eq(await t.val(`select count(*)::int from audit_log where actor_id = $1`, [reg]), 0,
         '수행자로 남은 줄');
    t.eq(await t.val(`select user_unused($1)`, [reg]), false, '판정');
    await asUser(t, admin, () =>
      t.rejects(() => t.rows(`select delete_unused_user($1)`, [reg]), { message: '남긴 기록' }));
  },
},

{
  id: 'DEL-08', expect: '통과',
  name: '쓰지 않은 계정 삭제 → 역할과 함께 지워지고 감사추적에 남는다',
  async run(t) {
    const admin = await sysAdmin(t);
    const idle = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1, 'WORKER')`, [idle]);
    t.eq(await t.val(`select user_unused($1)`, [idle]), true, '판정');

    await asUser(t, admin, () => t.rows(`select delete_unused_user($1)`, [idle]));

    t.eq(await t.val(`select count(*)::int from app_user where id = $1`, [idle]), 0, '계정');
    t.eq(await t.val(`select count(*)::int from user_role where user_id = $1`, [idle]), 0, '역할');
    t.eq(await t.val(
      `select count(*)::int from audit_log
        where table_name = 'app_user' and record_id = $1 and action = 'DELETE'
          and actor_id = $2`, [idle, admin]), 1, '계정 삭제 기록');
    t.eq(await t.val(
      `select count(*)::int from audit_log
        where table_name = 'user_role' and record_id = $1 and action = 'DELETE'`, [idle]), 1,
      '역할 회수 기록');
    t.eq(await t.val(
      `select count(*)::int from audit_log
        where table_name = 'app_user' and record_id = $1 and action = 'DELETE'
          and old_value->>'pin_hash' <> '(감춤)'`, [idle]), 0, '삭제 기록에 비밀번호 해시가 감춰진다');
  },
},

{
  id: 'DEL-09', expect: '거부',
  name: '자기 계정 삭제',
  async run(t) {
    const admin = await sysAdmin(t);
    await asUser(t, admin, () =>
      t.rejects(() => t.rows(`select delete_unused_user($1)`, [admin]), { message: '자기 계정' }));
  },
},

{
  id: 'DEL-10', expect: '거부',
  name: '시스템관리자가 아닌 계정의 계정 삭제',
  async run(t) {
    const mgr = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1, 'PROD_MGR')`, [mgr]);
    const idle = await t.newUser();
    await asUser(t, mgr, () =>
      t.rejects(() => t.rows(`select delete_unused_user($1)`, [idle]), { message: '시스템관리자만' }));
    t.eq(await t.val(`select count(*)::int from app_user where id = $1`, [idle]), 1, '계정이 남는다');
  },
},

{
  id: 'DEL-11', expect: '권한 거부',
  name: '열람 역할의 비우기 · 계정 삭제 함수 호출',
  async run(t) {
    const exists = await t.val(`select count(*)::int from pg_roles where rolname = 'app_readonly'`);
    if (!exists) return;
    await t.asRole('app_readonly', async () => {
      await t.rejects(() => t.rows(`select purge_logs()`), { code: '42501' });
      await t.rejects(() => t.rows(
        `select delete_unused_user('00000000-0000-0000-0000-000000000000')`), { code: '42501' });
    });
  },
},

];
