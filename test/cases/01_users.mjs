// =============================================================================
// 01_users.mjs - 사용자 · 역할 시험
// 근거: CLAUDE.md §4.1, §1-4 "개발 계정에 품질 판정 역할을 부여하지 않는다"
// =============================================================================

export default [

{
  id: 'U-01', expect: '거부',
  name: 'login_code 중복 등록',
  async run(t) {
    await t.newUser({ login_code: '7001' });
    await t.rejects(() => t.newUser({ login_code: '7001' }), { code: '23505' });
  },
},

{
  id: 'U-02', expect: '거부',
  name: 'full_name 없이 계정 등록',
  async run(t) {
    await t.rejects(
      () => t.rows(`insert into app_user (login_code, full_name) values ('7002', null)`),
      { code: '23502' });
  },
},

{
  id: 'U-03', expect: '통과',
  name: 'QP 계정 등록 (pin_hash null, can_login false)',
  async run(t) {
    const id = await t.resolves(() => t.newUser({
      login_code: '7003', full_name: '품질책임자', pin_hash: null, can_login: false }));
    const u = await t.one(`select pin_hash, can_login from app_user where id = $1`, [id]);
    t.eq(u.pin_hash, null, 'pin_hash');
    t.eq(u.can_login, false, 'can_login');
  },
},

{
  id: 'U-04', expect: '거부',
  name: '개발 계정에 QP 역할 부여',
  async run(t) {
    const dev = await t.newUser({ is_developer: true });
    await t.rejects(
      () => t.rows(`insert into user_role (user_id, role) values ($1,'QP')`, [dev]),
      { code: 'P0001', message: '개발 계정에는 품질책임자 역할을' });
  },
},

{
  id: 'U-05', expect: '통과',
  name: '일반 계정에 QP 역할 부여',
  async run(t) {
    const u = await t.newUser();
    await t.resolves(
      () => t.rows(`insert into user_role (user_id, role) values ($1,'QP')`, [u]));
    t.eq(await t.val(`select count(*)::int from user_role where user_id = $1`, [u]), 1, '역할 수');
  },
},

{
  id: 'U-06', expect: '거부',
  name: 'QP 보유 계정을 개발 계정으로 전환 (역방향 경로 · 사양 보강)',
  async run(t) {
    const u = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1,'QP')`, [u]);
    await t.rejects(
      () => t.rows(`update app_user set is_developer = true where id = $1`, [u]),
      { code: 'P0001', message: '개발 계정으로 전환할 수 없습니다' });
  },
},

{
  id: 'U-07', expect: '통과',
  name: 'QP 회수 후 개발 계정 전환',
  async run(t) {
    const u = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1,'QP')`, [u]);
    await t.rows(`delete from user_role where user_id = $1 and role = 'QP'`, [u]);
    await t.resolves(
      () => t.rows(`update app_user set is_developer = true where id = $1`, [u]));
    t.eq(await t.val(`select is_developer from app_user where id = $1`, [u]), true, 'is_developer');
  },
},

{
  id: 'U-08', expect: '통과',
  name: '개발 계정에 QP 외 역할(SYS_ADMIN) 부여',
  async run(t) {
    const dev = await t.newUser({ is_developer: true });
    await t.resolves(
      () => t.rows(`insert into user_role (user_id, role) values ($1,'SYS_ADMIN')`, [dev]));
  },
},

{
  id: 'U-09', expect: '거부',
  name: '존재하지 않는 사용자에게 역할 부여',
  async run(t) {
    await t.rejects(
      () => t.rows(`insert into user_role (user_id, role)
                    values ('00000000-0000-0000-0000-000000000000','WORKER')`),
      { code: '23503' });
  },
},

{
  id: 'U-10', expect: '확인',
  name: 'current_user_id(): app.user_id 미설정 시 null',
  async run(t) {
    await t.setActor(null);
    t.eq(await t.val(`select current_user_id()`), null, 'current_user_id()');
  },
},

{
  id: 'U-11', expect: '확인',
  name: 'current_user_id(): 설정값 반환',
  async run(t) {
    const u = await t.newUser();
    await t.setActor(u);
    t.eq(await t.val(`select current_user_id()`), u, 'current_user_id()');
    await t.setActor(null);
  },
},

{
  id: 'U-12', expect: '확인',
  name: 'has_role(): 보유 역할 true, 미보유 역할 false',
  async run(t) {
    const u = await t.newUser();
    await t.rows(`insert into user_role (user_id, role) values ($1,'PROD_MGR')`, [u]);
    await t.setActor(u);
    t.eq(await t.val(`select has_role('PROD_MGR')`), true,  `has_role('PROD_MGR')`);
    t.eq(await t.val(`select has_role('QP')`),       false, `has_role('QP')`);
    await t.setActor(null);
    t.eq(await t.val(`select has_role('PROD_MGR')`), false, '세션 미설정 시');
  },
},

];
