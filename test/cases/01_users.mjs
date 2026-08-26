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

{
  id: 'U-13', expect: '예외',
  name: '비밀번호 초기화: 개발 계정이 아니면 남의 비밀번호를 못 바꾼다',
  async run(t) {
    const actor  = await t.newUser({ is_developer: false });
    const victim = await t.newUser();
    await t.setActor(actor);
    await t.rejects(
      () => t.rows(`update app_user set pin_hash = 'x' where id = $1`, [victim]),
      { code: 'P0001', message: '개발 계정만' });
    await t.setActor(null);
  },
},

{
  id: 'U-14', expect: '통과',
  name: '비밀번호 초기화: 개발 계정은 남의 비밀번호를 바꾼다',
  async run(t) {
    const actor  = await t.newUser({ is_developer: true });
    const victim = await t.newUser();
    await t.setActor(actor);
    await t.resolves(
      () => t.rows(`update app_user set pin_hash = 'reset' where id = $1`, [victim]));
    t.eq(await t.val(`select pin_hash from app_user where id = $1`, [victim]),
         'reset', 'pin_hash');
    await t.setActor(null);
  },
},

{
  id: 'U-15', expect: '통과',
  name: '비밀번호 초기화: 자기 비밀번호는 개발 계정이 아니어도 바꾼다',
  async run(t) {
    const me = await t.newUser({ is_developer: false });
    await t.setActor(me);
    await t.resolves(
      () => t.rows(`update app_user set pin_hash = 'mine' where id = $1`, [me]));
    t.eq(await t.val(`select pin_hash from app_user where id = $1`, [me]),
         'mine', 'pin_hash');
    await t.setActor(null);
  },
},

{
  id: 'U-16', expect: '통과',
  name: '비밀번호 초기화: 비밀번호 외의 항목은 이 규칙과 무관하다',
  async run(t) {
    const actor  = await t.newUser({ is_developer: false });
    const target = await t.newUser();
    await t.setActor(actor);
    await t.resolves(
      () => t.rows(`update app_user set full_name = '이름변경' where id = $1`, [target]));
    await t.setActor(null);
  },
},

{
  id: 'U-17', expect: '확인',
  name: '로그인 시도 제한: 5회 실패까지는 잠기지 않는다',
  async run(t) {
    const code = 'thr-a';
    for (let i = 0; i < 4; i += 1) await t.rows(`select login_fail($1)`, [code]);
    t.eq(await t.val(`select coalesce(login_lock_seconds($1), 0)`, [code]), 0, '4회 후');
  },
},

{
  id: 'U-18', expect: '확인',
  name: '로그인 시도 제한: 5회를 넘으면 잠긴다',
  async run(t) {
    const code = 'thr-b';
    for (let i = 0; i < 5; i += 1) await t.rows(`select login_fail($1)`, [code]);
    const sec = await t.val(`select coalesce(login_lock_seconds($1), 0)`, [code]);
    if (!(sec > 0 && sec <= 600)) {
      throw new Error(`잠금 남은 시간이 1~600초여야 하는데 ${sec}`);
    }
  },
},

{
  id: 'U-19', expect: '확인',
  name: '로그인 시도 제한: 들어오면 실패 기록이 지워진다',
  async run(t) {
    const code = 'thr-c';
    for (let i = 0; i < 6; i += 1) await t.rows(`select login_fail($1)`, [code]);
    await t.rows(`select login_ok($1)`, [code]);
    t.eq(await t.val(`select coalesce(login_lock_seconds($1), 0)`, [code]), 0, '성공 후');
  },
},

{
  id: 'U-20', expect: '확인',
  name: '로그인 시도 제한: 다른 사번은 잠기지 않는다',
  async run(t) {
    const code = 'thr-d';
    for (let i = 0; i < 6; i += 1) await t.rows(`select login_fail($1)`, [code]);
    t.eq(await t.val(`select coalesce(login_lock_seconds($1), 0)`, ['thr-e']), 0, '다른 사번');
  },
},

];
