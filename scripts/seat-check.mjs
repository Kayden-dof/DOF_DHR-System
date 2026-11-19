/* ---------------------------------------------------------------------------
   역할 고르기가 서는가 (사용자 요청 2026-11-20)

     npm run seat

   역할이 둘 이상인 계정은 로그인 직후 어느 역할로 들어갈지 고른다. 고른 역할이
   첫 화면 · 차림표 · 화면 문을 정한다 (lib/roles.ts seatOf). 저장 권한은 가진
   역할 전부로 그대로 본다 (사용자 결정 2026-11-20) - 그쪽 코드는 손대지 않았다.

   여기서 묻는 것은 다섯이다.

     고르기 전    어느 화면으로도 들이지 않고 고르는 창으로 보내는가
     작업자로     현장 화면이 첫 화면이고 관리 화면은 닫히는가
     관리자로     관리 화면이 첫 화면이고 차림표가 서는가
     못 넓힌다    가진 적 없는 역할을 쿠키에 적어도 넓어지지 않는가
     전과 같다    역할이 하나인 계정, 이 기능 전에 연 세션은 그대로인가

   쿠키는 lib/session.ts 와 같은 규칙으로 직접 만든다 (scripts/session-cookie.mjs).
   고르는 단추(서버 동작)를 누르는 것은 여기서 하지 않는다 - 그 결과가 쿠키의 r
   한 글자이고, 그 글자가 무엇을 여는지가 여기서 재는 것이다.

   ── 계정은 로컬에서만 만든다 ──────────────────────────────────────────────
   역할이 둘인 계정이 없으면 확인용으로 하나 세운다 (access-matrix 와 같은 방식).
   운영에 계정을 심는 도구가 되어서는 안 되므로 localhost 만 본다.
--------------------------------------------------------------------------- */
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { hashPin } from './pin.mjs';
import { sessionCookie } from './session-cookie.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const url = process.env.DATABASE_URL ?? '';

if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE)
    || !/@(localhost|127\.0\.0\.1)/.test(url)) {
  console.error('이 시험은 확인용 계정을 세웁니다. localhost 만 가리킬 수 있습니다.');
  console.error(`  화면: ${BASE}`);
  process.exit(2);
}

const c = new pg.Client({ connectionString: url });
await c.connect();
const v = async (s, p = []) => Object.values((await c.query(s, p)).rows[0] ?? {})[0];

let bad = 0;
const ok = (cond, what, extra = '') => {
  if (!cond) bad += 1;
  console.log(`  ${cond ? '맞음' : '★ 틀림'}  ${what}${extra ? ' · ' + extra : ''}`);
};

/** 확인용 계정. 없으면 세우고, 있으면 역할만 맞춘다 */
async function account(code, name, roles) {
  const id = (await c.query(
    `insert into app_user (login_code, full_name, pin_hash, can_login, is_active)
     values ($1, $2, $3, true, true)
     on conflict (login_code) do update set is_active = true, can_login = true
     returning id`,
    [code, name, await hashPin(randomBytes(16).toString('hex'))],
  )).rows[0].id;
  for (const r of roles) {
    await c.query(`insert into user_role (user_id, role) values ($1, $2::role_code)
                   on conflict do nothing`, [id, r]);
  }
  return id;
}

/* ── 0. 판정 함수 ──────────────────────────────────────────────────────
 *
 * 첫 화면과 고른 역할 해석은 순수 함수다 (lib/roles.ts). 화면을 거치지 않고
 * 바로 불러 본다 - 로그인 · 역할 고르기 · 비밀번호 바꾸기가 가는 곳이 이것이라
 * 쿠키로 화면을 두드려서는 닿지 않는다.
 */
console.log('\n역할 고르기가 서는가 (2026-11-20)\n');
console.log('[0] 판정 함수');
{
  const { homePath, seatOf } = await import(new URL('../lib/roles.ts', import.meta.url).href);
  for (const [roles, want] of [
    [['SYS_ADMIN'], '/'], [['PROD_MGR'], '/'], [['WORKER'], '/work'],
    [['VIEWER'], '/board'], [['QP'], '/production'], [[], '/no-role'],
    [['WORKER', 'PROD_MGR'], '/'],
  ]) {
    const got = homePath(roles);
    ok(got === want, `첫 화면 · ${roles.join('+') || '역할 없음'} → ${want}`, got);
  }
  const W = ['WORKER', 'PROD_MGR'];
  ok(!seatOf(W, undefined).pick && seatOf(W, undefined).seat.join() === W.join(),
     '겸직 · 고르지 않는 세션 → 가진 역할 전부');
  ok(seatOf(W, '').pick, '겸직 · 고르기 전 → 고른다');
  ok(seatOf(W, 'WORKER').seat.join() === 'WORKER' && !seatOf(W, 'WORKER').pick, '겸직 · 작업자로');
  ok(seatOf(W, 'QP').pick, '겸직 · 가진 적 없는 역할 → 다시 고른다');
  ok(seatOf(['WORKER'], 'PROD_MGR').seat.join() === 'WORKER'
     && !seatOf(['WORKER'], 'PROD_MGR').pick, '홑 역할 · 쿠키에 무엇이 있어도 가진 역할 그대로');
}

const both = await account('990101', '겸직 확인용', ['WORKER', 'PROD_MGR']);
const one = await v(
  `select u.id from app_user u join user_role r on r.user_id = u.id
    where u.can_login and u.is_active
    group by u.id having array_agg(r.role::text) = array['WORKER']
    limit 1`) ?? await account('990102', '작업자 확인용', ['WORKER']);

/** 그 쿠키로 그 주소를 연다. 넘기면 어디로 넘겼는지, 그리면 본문을 */
async function open(path, cookie) {
  const r = await fetch(BASE + path, { headers: { cookie }, redirect: 'manual' });
  if (r.status !== 200) return { to: r.headers.get('location') ?? `HTTP ${r.status}` };
  return { html: await r.text() };
}

/** 넘긴 곳. 주소가 통째로 오기도 하고 경로만 오기도 한다 */
const where = (x) => (x.to ?? '그렸다').replace(BASE, '');

const SWITCH = '역할 바꾸기';

/* ── 1. 고르기 전 ──────────────────────────────────────────────────── */
console.log('\n[1] 고르기 전에는 고르는 창으로 보낸다');
{
  const k = sessionCookie(both, '');
  for (const p of ['/', '/work', '/production', '/settings']) {
    const x = await open(p, k);
    ok(where(x) === '/login', `${p} → 고르는 창`, where(x));
  }
  const login = await open('/login', k);
  const h = login.html ?? '';
  ok(/data-role-picker/.test(h), '로그인 화면에 고르는 창이 뜬다', where(login));
  ok(h.includes('생산관리자') && h.includes('작업자'), '가진 역할 둘이 다 나온다');
  ok(!/name="login_code"/.test(h), '고르는 동안 사번 입력판은 그리지 않는다');
}

/* ── 2. 작업자로 ───────────────────────────────────────────────────── */
console.log('\n[2] 작업자로 고르면 현장 화면이 첫 화면이다');
{
  const k = sessionCookie(both, 'WORKER');
  ok(where(await open('/', k)) === '/work', '/ → 현장 화면', where(await open('/', k)));
  const work = await open('/work', k);
  ok(!!work.html, '현장 화면이 열린다', where(work));
  ok((work.html ?? '').includes(SWITCH), '이름 옆에 역할 바꾸기가 있다');
  ok(!/href="\/"[^>]*>\s*관리 화면/.test(work.html ?? ''), '관리 화면 단추는 없다');
  for (const p of ['/production', '/material', '/settings']) {
    const x = await open(p, k);
    ok(where(x) === '/work', `${p} → 현장 화면으로 돌려보낸다`, where(x));
  }
  ok(where(await open('/login', k)) === '/', '로그인 화면은 첫 화면으로 넘긴다');
}

/* ── 3. 관리자로 ───────────────────────────────────────────────────── */
console.log('\n[3] 생산관리자로 고르면 관리 화면이 첫 화면이다');
{
  const k = sessionCookie(both, 'PROD_MGR');
  const home = await open('/', k);
  const h = home.html ?? '';
  ok(!!home.html, '관리 화면이 열린다', where(home));
  ok(h.includes('href="/production"') && h.includes('href="/material"'), '차림표가 선다');
  ok(h.includes(SWITCH), '이름 옆에 역할 바꾸기가 있다');
  ok(!/href="\/work"[^>]*>\s*현장 화면/.test(h), '현장 화면 단추는 역할 바꾸기가 대신한다');
  const meta = (h.match(/qd-rail-user-meta[^>]*>([\s\S]*?)<\/span>/) ?? [])[1] ?? '';
  ok(meta.includes('생산관리자') && !meta.includes('작업자'), '이름 아래에 고른 역할만 적는다',
     meta.replace(/<[^>]+>/g, '').trim());
}

/* ── 4. 못 넓힌다 ──────────────────────────────────────────────────── */
console.log('\n[4] 가진 적 없는 역할을 적어도 넓어지지 않는다');
{
  const x = await open('/', sessionCookie(both, 'SYS_ADMIN'));
  ok(where(x) === '/login', '역할이 둘인 계정 · 없는 역할 → 다시 고른다', where(x));

  const y = await open('/', sessionCookie(one, 'PROD_MGR'));
  ok(where(y) === '/work', '역할이 하나인 계정 · 없는 역할 → 가진 역할 그대로', where(y));
  const z = await open('/production', sessionCookie(one, 'PROD_MGR'));
  ok(where(z) === '/work', '관리 화면은 여전히 닫혀 있다', where(z));
}

/* ── 5. 전과 같다 ──────────────────────────────────────────────────── */
console.log('\n[5] 역할이 하나인 계정과 이 기능 전에 연 세션은 그대로다');
{
  const k = sessionCookie(one);
  ok(where(await open('/', k)) === '/work', '작업자 하나 · / → 현장 화면');
  const work = await open('/work', k);
  ok(!!work.html && !(work.html ?? '').includes(SWITCH), '작업자 하나 · 역할 바꾸기가 없다');

  const old = sessionCookie(both);
  const home = await open('/', old);
  ok(!!home.html, '겸직 · 옛 세션 · 관리 화면이 그대로 열린다', where(home));
  ok(/href="\/work"[^>]*>\s*현장 화면/.test(home.html ?? ''), '겸직 · 옛 세션 · 현장 화면 단추도 그대로');
}

/*
 * 확인용 계정을 닫아 둔다. 열어 두면 다른 검사가 "작업자 계정" 을 찾다가 이
 * 겸직 계정을 집는다 (npm run screen 이 실제로 그랬다). 다음에 돌 때 다시 연다.
 */
await c.query(`update app_user set is_active = false, can_login = false
                where login_code in ('990101', '990102')`);

console.log('');
console.log('='.repeat(70));
console.log(bad === 0
  ? '고른 역할대로 첫 화면과 차림표가 섭니다.'
  : `${bad}건이 어긋납니다.`);
console.log('='.repeat(70));

await c.end();
process.exit(bad === 0 ? 0 : 1);
