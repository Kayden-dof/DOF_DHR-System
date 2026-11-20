// =============================================================================
// 35_idle_lock_off.mjs - 관리자는 자기 계정의 자동 잠금을 끈다 (0153)
// 근거: 사용자 2026-11-20 «자동 잠금 기능을 관리자의 경우 개인 설정에서 끌수 있도록»
//
// 관리자(시스템관리자 · 생산관리자)가 자기 것을 끄면 판정(idle_lock_off)이 참이 되고 감사추적에
// 남는지, 작업자 · 열람자 · 남의 계정은 막는지, 관리 역할을 거두면 값이 남아도 판정이 거짓으로
// 돌아가는지 본다.
// =============================================================================

async function asUser(t, userId, fn) {
  await t.rows(`select set_config('app.user_id', $1, false)`, [userId ?? '']);
  try {
    return await t.asRole('app_role', fn);
  } finally {
    await t.rows(`select set_config('app.user_id', '', false)`);
  }
}

async function person(t, ...roles) {
  const id = await t.newUser();
  for (const r of roles) {
    await t.rows(`insert into user_role (user_id, role) values ($1, $2::role_code)`, [id, r]);
  }
  return id;
}

const setOff = (t, actor, target, off) => asUser(t, actor, () =>
  t.rows(`update app_user set idle_lock_off = $2 where id = $1`, [target, off]));

const judged = (t, id) => t.val(`select idle_lock_off($1)`, [id]);

export default [

{
  id: 'IL-01', expect: '통과',
  name: '시스템관리자 · 생산관리자는 자기 자동 잠금을 끄고 켜며, 바꾼 것이 감사추적에 남는다',
  async run(t) {
    for (const role of ['SYS_ADMIN', 'PROD_MGR']) {
      const me = await person(t, role);
      t.eq(await judged(t, me), false, `${role} 처음에는 잠금`);

      await setOff(t, me, me, true);
      t.eq(await judged(t, me), true, `${role} 끈 뒤`);
      const a = await t.one(
        `select actor_id::text as by, old_value->>'idle_lock_off' as was, new_value->>'idle_lock_off' as now
           from audit_log where table_name = 'app_user' and record_id = $1 and action = 'UPDATE'
          order by id desc limit 1`, [me]);
      t.eq([a?.by, a?.was, a?.now], [me, 'false', 'true'], `${role} 감사추적`);

      await setOff(t, me, me, false);
      t.eq(await judged(t, me), false, `${role} 다시 켠 뒤`);
    }
  },
},

{
  id: 'IL-02', expect: '거부',
  name: '작업자 · 열람자 · 품질책임자는 끄지 못하고, 관리자도 남의 것은 바꾸지 못한다',
  async run(t) {
    for (const role of ['WORKER', 'VIEWER', 'QP']) {
      const me = await person(t, role);
      await t.rejects(() => setOff(t, me, me, true), { message: '시스템관리자 · 생산관리자만' });
      t.eq(await judged(t, me), false, `${role} 그대로 잠금`);
    }
    const admin = await person(t, 'SYS_ADMIN');
    const other = await person(t, 'PROD_MGR');
    await t.rejects(() => setOff(t, admin, other, true), { message: '본인만' });
    await setOff(t, other, other, true);
    await t.rejects(() => setOff(t, admin, other, false), { message: '본인만' });
    t.eq(await judged(t, other), true, '남이 켜지 못함');
  },
},

{
  id: 'IL-03', expect: '통과',
  name: '관리 역할을 거두면 값이 남아 있어도 다시 잠기고, 본인은 언제든 다시 켠다',
  async run(t) {
    const me = await person(t, 'PROD_MGR', 'WORKER');
    await setOff(t, me, me, true);
    t.eq(await judged(t, me), true, '끈 뒤');

    await t.rows(`delete from user_role where user_id = $1 and role = 'PROD_MGR'`, [me]);
    t.eq(await t.val(`select idle_lock_off from app_user where id = $1`, [me]), true, '값은 남는다');
    t.eq(await judged(t, me), false, '역할이 없으니 잠금');

    await setOff(t, me, me, false);
    t.eq(await t.val(`select idle_lock_off from app_user where id = $1`, [me]), false, '켜는 것은 누구나');
    await t.rejects(() => setOff(t, me, me, true), { message: '시스템관리자 · 생산관리자만' });
  },
},

];
