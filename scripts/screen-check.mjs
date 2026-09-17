/* ---------------------------------------------------------------------------
   계정별 화면 배정이 실제로 서는가 (§2.0 · 0116)

     npm run screen

   ── 무엇을 묻는가 ─────────────────────────────────────────────────────────
   `npm run access` 는 **역할 기본값**을 잰다 (150칸). 그 위에 관리자가 계정마다
   여닫는 층이 하나 더 생겼고, 그 층은 저 검사가 보지 않는다.

   여기서 묻는 것은 넷이다.

     닫으면    차림표에서 사라지고 주소로 들어가도 막히는가
     열면      역할이 막던 화면이 실제로 열리는가
     되돌리면  손대기 전과 똑같아지는가
     못 하는 것 자기 것 바꾸기 · 지어낸 주소 · 배정 없이 대장에 닿기

   ── 왜 "열면" 을 따로 묻는가 ──────────────────────────────────────────────
   닫는 것은 한 자리(문지기)에서 되지만 여는 것은 그렇지 않다. 화면마다 제
   역할 판정을 들고 있어서, 그것을 공통 판정으로 바꾸지 않으면 **메뉴에는
   나오는데 눌러도 안 열린다.** 실제로 그 상태를 한 번 지났다 (구역 레이아웃
   셋이 역할로 구역 전체를 막고 있었다).

   ── 자국을 남기지 않는다 ──────────────────────────────────────────────────
   시험이 바꾼 배정은 전부 역할 기본값으로 되돌린다. 행은 남지만(§10 기록은
   지우지 않는다) 판정은 손대기 전과 같아진다. 감사추적에는 시험이 만진 자국이
   남으므로 **localhost 만 본다.**
--------------------------------------------------------------------------- */
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';
import { sessionCookie } from './session-cookie.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3100';

if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE)) {
  console.error('이 시험은 화면 배정을 바꿔 보고 되돌립니다.');
  console.error(`  대상: ${BASE}`);
  console.error('');
  console.error('localhost 가 아닌 곳을 가리킬 수 없습니다.');
  process.exit(2);
}

const url = process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await c.connect();
const v = async (s, p = []) => Object.values((await c.query(s, p)).rows[0] ?? {})[0];

let bad = 0;
const ok = (cond, what, extra = '') => {
  if (!cond) bad += 1;
  console.log(`  ${cond ? '맞음' : '★ 틀림'}  ${what}${extra ? ' · ' + extra : ''}`);
};

const admin = await v(
  `select u.id from app_user u join user_role r on r.user_id = u.id
    where r.role = 'SYS_ADMIN' and u.can_login limit 1`);
if (!admin) { console.error('시스템관리자 계정이 없습니다'); process.exit(2); }

/** 배정을 정한다. 화면을 거치지 않고 DB 함수로 - 여기서 재는 것은 판정이다 */
async function assign(user, path, open) {
  await c.query('begin');
  await c.query('set local role app_role');
  await c.query("select set_config('app.user_id', $1, true)", [admin]);
  try {
    await c.query('select set_user_screen($1::uuid, $2::text, $3::boolean, null)',
                  [user, path, open]);
  } finally {
    await c.query('commit');
  }
}

/** 그 사람으로 그 화면을 열어 본다 */
async function probe(user, path) {
  const r = await fetch(BASE + path,
                        { headers: { cookie: sessionCookie(user) }, redirect: 'manual' });
  if (r.status !== 200) return { how: 'away', to: r.headers.get('location') };
  const t = await r.text();
  return { how: /data-denied/.test(t) ? 'blocked' : 'open' };
}

/** 머리줄 차림표에 그 주소가 있는가 */
async function inMenu(user, path) {
  const home = await (await fetch(BASE + '/', { headers: { cookie: sessionCookie(user) } })).text();
  const bar = home.slice(0, home.indexOf('</header>') + 1);
  return bar.includes(`href="${path}"`);
}

console.log('\n계정별 화면 배정이 서는가 (§2.0 · 0116)\n');

const before = Number(await v('select count(*)::int from user_screen where is_open is not null'));
if (before > 0) {
  console.log(`  건너뜀  배정이 이미 ${before}건 있습니다. 시험은 깨끗한 상태에서 돕니다.\n`);
  await c.end();
  process.exit(0);
}

/* ── 1. 닫으면 사라지고 막힌다 ───────────────────────────────────────── */
console.log('[1] 닫으면 사라지고 막힌다');
{
  const mgr = await v(`select u.id from app_user u join user_role r on r.user_id = u.id
                        where r.role = 'PROD_MGR' and u.can_login limit 1`);
  const P = '/material';
  ok((await probe(mgr, P)).how === 'open', '처음에는 열린다');
  ok(await inMenu(mgr, P), '처음에는 차림표에 있다');

  await assign(mgr, P, false);
  const shut = await probe(mgr, P);
  ok(shut.how === 'away' && shut.to === '/no-access', '주소로 들어가면 막힌다', shut.to ?? shut.how);
  ok(!(await inMenu(mgr, P)), '차림표에서 사라진다');

  await assign(mgr, P, null);
  ok((await probe(mgr, P)).how === 'open', '되돌리면 다시 열린다');
  ok(await inMenu(mgr, P), '되돌리면 차림표에 다시 있다');
}

/* ── 2. 열면 역할이 막던 화면이 열린다 ───────────────────────────────── */
//
// 닫는 것은 문지기 한 자리에서 되지만 여는 것은 화면마다 판정을 고쳐야 한다.
// 그 고침이 빠지면 여기서 걸린다.
console.log('\n[2] 열면 역할이 막던 화면이 열린다');
for (const [label, role, path] of [
  ['품질책임자', 'QP', '/board/cost'],       // 기본 막힘
  ['작업자', 'WORKER', '/board'],            // 기본 내보냄
  ['경영열람', 'VIEWER', '/material'],       // 기본 막힘 · 구역 레이아웃이 있다
]) {
  const who = await v(`select u.id from app_user u join user_role r on r.user_id = u.id
                        where r.role = $1 and u.can_login limit 1`, [role]);
  if (!who) { console.log(`  건너뜀  ${label} 계정이 없습니다`); continue; }

  const shut = await probe(who, path);
  ok(shut.how !== 'open', `${label} × ${path} · 처음에는 못 연다`, shut.how);

  await assign(who, path, true);
  ok((await probe(who, path)).how === 'open', `${label} × ${path} · 열어 주면 열린다`);

  await assign(who, path, null);
  ok((await probe(who, path)).how === shut.how, `${label} × ${path} · 되돌리면 원래대로`);
}

/* ── 3. 못 하는 것 ───────────────────────────────────────────────────── */
console.log('\n[3] 못 하는 것');
{
  let threw = false;
  try { await assign(admin, '/settings/access', false); } catch { threw = true; }
  ok(threw, '자기 배정은 바꿀 수 없다');

  const mgr = await v(`select u.id from app_user u join user_role r on r.user_id = u.id
                        where r.role = 'PROD_MGR' and u.can_login limit 1`);
  const n = Number(await v('select count(*)::int from user_screen'));
  await assign(mgr, '/지어낸주소', false);
  /*
   * DB 는 아는 주소인지 묻지 않는다 - 그 판단은 화면이 한다 (actions.ts).
   * 여기서는 그런 칸이 생겨도 **아무 화면도 가리지 않는다** 는 것만 본다.
   */
  ok((await probe(mgr, '/material')).how === 'open', '모르는 주소는 아무것도 가리지 않는다');
  await assign(mgr, '/지어낸주소', null);
  ok(Number(await v('select count(*)::int from user_screen')) >= n, '행은 지워지지 않는다');
}

/* ── 4. 자국을 남기지 않는다 ─────────────────────────────────────────── */
console.log('\n[4] 뒤처리');
{
  const left = Number(await v('select count(*)::int from user_screen where is_open is not null'));
  ok(left === 0, '시험이 바꾼 배정을 전부 되돌렸다', `남은 배정 ${left}건`);
}

console.log('');
console.log('='.repeat(70));
console.log(bad === 0
  ? '관리자가 배정한 대로 화면이 열리고 닫힙니다.'
  : `${bad}건이 어긋납니다.`);
console.log('='.repeat(70));

await c.end();
process.exit(bad === 0 ? 0 : 1);
