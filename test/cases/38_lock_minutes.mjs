// =============================================================================
// 38_lock_minutes.mjs - 자동 잠금 시간을 본인이 고른다 (0157)
// 근거: 사용자 2026-11-25 «본인 계정 설정.. 그런곳에 잠금 설정 시간 이런거 설정할수있는 기능»
//
// 본인은 관리 화면 · 현장 화면 잠금 시간을 정해 둔 값 가운데에서 고르고 비울 수 있고 감사추적에
// 남는지, 목록 밖 값 · 현장 30분 초과 · 남의 계정은 막는지, 관리 역할을 잃은 뒤 끄기 값이 남아
// 있어도 시간은 고칠 수 있는지 본다.
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

const set = (t, actor, target, col, v) => asUser(t, actor, () =>
  t.rows(`update app_user set ${col} = $2 where id = $1`, [target, v]));

const read = (t, id) => t.one(
  `select idle_lock_desk_min as desk, idle_lock_pad_min as pad from app_user where id = $1`, [id]);

export default [

{
  id: 'LM-01', expect: '통과',
  name: '본인은 관리 화면 · 현장 화면 잠금 시간을 고르고 비우며, 바꾼 것이 감사추적에 남는다',
  async run(t) {
    const me = await person(t, 'WORKER', 'VIEWER');
    t.eq(await read(t, me), { desk: null, pad: null }, '처음에는 기본값');

    await set(t, me, me, 'idle_lock_desk_min', 120);
    await set(t, me, me, 'idle_lock_pad_min', 5);
    t.eq(await read(t, me), { desk: 120, pad: 5 }, '고른 값');
    const a = await t.one(
      `select actor_id::text as by, old_value->>'idle_lock_pad_min' as was, new_value->>'idle_lock_pad_min' as now
         from audit_log where table_name = 'app_user' and record_id = $1 and action = 'UPDATE'
        order by id desc limit 1`, [me]);
    t.eq([a?.by, a?.was, a?.now], [me, null, '5'], '감사추적');

    await set(t, me, me, 'idle_lock_desk_min', null);
    t.eq(await read(t, me), { desk: null, pad: 5 }, '비우면 기본값으로');
  },
},

{
  id: 'LM-02', expect: '거부',
  name: '정해 둔 값 밖 · 현장 30분 초과 · 남의 계정 잠금 시간',
  async run(t) {
    const me = await person(t, 'WORKER');
    await t.rejects(() => set(t, me, me, 'idle_lock_desk_min', 7), { code: '23514' });
    await t.rejects(() => set(t, me, me, 'idle_lock_desk_min', 240), { code: '23514' });
    await t.rejects(() => set(t, me, me, 'idle_lock_pad_min', 45), { code: '23514' });
    await t.rejects(() => set(t, me, me, 'idle_lock_pad_min', 60), { code: '23514' });

    const admin = await person(t, 'SYS_ADMIN');
    await t.rejects(() => set(t, admin, me, 'idle_lock_pad_min', 30), { message: '본인만' });
    await t.rejects(() => set(t, admin, me, 'idle_lock_desk_min', 60), { message: '본인만' });
    t.eq(await read(t, me), { desk: null, pad: null }, '그대로');
  },
},

{
  id: 'LM-03', expect: '통과',
  name: '관리 역할을 잃어 끄기 값이 힘을 잃은 뒤에도 잠금 시간은 고친다',
  async run(t) {
    const me = await person(t, 'PROD_MGR', 'WORKER');
    await set(t, me, me, 'idle_lock_off', true);
    await t.rows(`delete from user_role where user_id = $1 and role = 'PROD_MGR'`, [me]);
    t.eq(await t.val(`select idle_lock_off($1)`, [me]), false, '역할이 없으니 잠금');

    await t.resolves(() => set(t, me, me, 'idle_lock_pad_min', 30));
    t.eq((await read(t, me)).pad, 30, '시간은 고쳐진다');
    await t.rejects(() => set(t, me, me, 'idle_lock_off', false).then(() =>
      set(t, me, me, 'idle_lock_off', true)), { message: '시스템관리자 · 생산관리자만' });
  },
},

];
