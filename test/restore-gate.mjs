/**
 * 복구 문턱이 실제로 막는가 (OQ ⑨ · 사용자 물음 2026-09-01)
 *
 *   npm run build && npx next start -p 3100 &
 *   node --env-file=.env.local test/restore-gate.mjs [http://localhost:3100]
 *
 * ── 왜 따로 있는가 ────────────────────────────────────────────────────────
 * 복구는 이 시스템에서 가장 위험한 단추다. 지금 있는 기록을 통째로 갈아
 * 끼우고, 끝나면 되돌릴 방법이 없다.
 *
 * 그런데 그 앞을 지키는 것들 - 시스템관리자만, 성한 파일만, 되돌릴 길이 있을
 * 때만, 파일 이름을 적었을 때만 - 은 응용 계층에 있다. DB 규칙 시험(test/run)
 * 도 화면 시험(smoke)도 권한 시험(access)도 이것을 보지 않는다.
 *
 * 만든 사람이 한 번 눌러 본 것이 전부인 채로 두지 않는다. 이 세션에서 그런
 * 확인을 여러 번 만났고, 그때마다 헛돌고 있었다 (§8.0.1).
 *
 * ── 마지막 하나는 실제로 되돌린다 ─────────────────────────────────────────
 * 막는 것만 확인하고 통과시키면, 아무것도 안 하는 문이라도 전건 통과한다.
 * 그래서 끝에서 실제로 자료를 바꾸고 되돌려 원래대로 오는지 본다.
 *
 * 대상 DB 의 자료를 실제로 갈아 끼우므로 운영을 가리키지 않는다.
 */
import pg from 'pg';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomBytes, scryptSync, createDecipheriv, createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { sessionCookie } from '../scripts/session-cookie.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const URL_ = process.env.DATABASE_URL ?? '';

if (!/localhost|127\.0\.0\.1/.test(URL_)) {
  console.error('이 시험은 대상 DB 의 자료를 실제로 갈아 끼웁니다.');
  console.error('localhost 가 아닌 DB 를 가리킬 수 없습니다.');
  process.exit(2);
}

const c = new pg.Client({ connectionString: URL_ });
await c.connect();

const one = async (q, p) => (await c.query(q, p)).rows[0];

const users = {};
for (const role of ['SYS_ADMIN', 'PROD_MGR']) {
  users[role] = await one(
    `select u.id, u.full_name, u.login_code from app_user u
       join user_role x on x.user_id = u.id
      where x.role = $1::role_code and u.is_active and u.can_login
        and not exists (select 1 from user_role y
                         where y.user_id = u.id and y.role <> $1::role_code)
      order by u.login_code limit 1`, [role]);
}
if (!users.SYS_ADMIN || !users.PROD_MGR) {
  console.error('시스템관리자와 생산관리자 계정이 하나씩 필요합니다.');
  process.exit(2);
}

/*
 * 시험용 비밀번호를 이 계정에 새로 건다.
 *
 * 재인증이 붙으면서 본인 비밀번호 없이는 아무것도 못 하게 됐다. 사람의 진짜
 * 비밀번호를 시험에 적어 둘 수는 없으므로, 시험이 스스로 하나 걸고 쓴다.
 * 훈련용 DB 만 가리키므로(위 localhost 확인) 여기서 바꾸는 것은 시연 계정이다.
 *
 * **세션을 만들기 전에 건다.** 비밀번호를 바꾸면 그 이전에 발급된 세션이
 * 무효가 된다 (lib/session.ts · pin_changed_at). 순서를 뒤집었더니 시험이
 * 만든 세션이 곧바로 죽어 전 항목이 로그인 화면을 보고 있었다. 앱은 옳게
 * 돌고 있었고 재는 쪽이 틀렸다.
 */
const PIN = '918273';
const PASS = 'dhr-lock-시험-2026';
{
  const salt = randomBytes(16);
  const key = scryptSync(PIN, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  await c.query(
    'update app_user set pin_hash = $2, pin_changed_at = null where id = $1',
    [users.SYS_ADMIN.id,
     `scrypt$${1 << 15}$8$1$${salt.toString('base64')}$${key.toString('base64')}`]);
}
await c.query('select login_ok($1)', [users.SYS_ADMIN.login_code]);

const admin = { cookie: sessionCookie(users.SYS_ADMIN.id) };
const other = { cookie: sessionCookie(users.PROD_MGR.id) };

const results = [];
const check = (id, what, cond, detail = '') => {
  results.push({ id, what, ok: !!cond, detail });
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${id.padEnd(7)} ${what}${detail ? '   ' + detail : ''}`);
};

async function post(who, file, name, fields = {}) {
  const fd = new FormData();
  fd.set('file', new File([file], name), name);
  fd.set('passphrase', PASS);
  fd.set('pin', PIN);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const r = await fetch(`${BASE}/api/restore`, {
    method: 'POST', headers: { cookie: who.cookie }, body: fd,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

console.log('\n[문턱]  복구 앞을 지키는 것들\n');

/* --- 0. 성한 백업 하나를 뜬다. 뒤의 시험들이 이것을 비튼다 -------------- */
const dl = (who, fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fetch(`${BASE}/api/backup`, { method: 'POST', headers: { cookie: who.cookie }, body: fd });
};
const got = await dl(admin, { pin: PIN, passphrase: PASS });
const good = Buffer.from(await got.arrayBuffer());
const goodName = (got.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/)?.[1];
check('RG-00', '시스템관리자가 백업을 뜬다', got.status === 200 && good.length > 0,
      `${goodName} · ${(good.length / 1024).toFixed(0)}KB`);
if (got.status !== 200) process.exit(1);

/* --- 1. 누가 부를 수 있는가 -------------------------------------------- */
const r1 = await dl(other, { pin: PIN, passphrase: PASS });
check('RG-01', '생산관리자는 백업을 뜨지 못한다', r1.status === 403, `${r1.status}`);

const r2 = await post(other, good, goodName, { mode: 'inspect' });
check('RG-02', '생산관리자는 살펴보지도 못한다', r2.status === 403, `${r2.status}`);

/*
 * 리다이렉트를 따라가지 않는다.
 *
 * 처음 판은 그냥 fetch 했고, 서버가 /login 으로 넘긴 것을 따라가 그 화면의
 * 200 을 보고 "로그인 없이 백업이 나온다" 고 했다. 재는 도구가 겁을 준 셈이다.
 * 응답 그 자체를 봐야 한다.
 */
const r3 = await fetch(`${BASE}/api/backup`, { method: 'POST', body: new FormData(), redirect: 'manual' });
check('RG-03', '로그인 없이 백업을 뜨지 못한다',
      (r3.status >= 300 && r3.status < 400) || r3.status === 401 || r3.status === 403,
      `${r3.status} → ${r3.headers.get('location') ?? ''}`);

/* --- 2. 어떤 파일을 받아들이는가 ---------------------------------------- */
const notGz = await post(admin, Buffer.from('그냥 글자'), 'x.gz', { mode: 'inspect' });
check('RG-04', 'gzip 이 아닌 파일은 거부한다', notGz.status === 400, notGz.body.error ?? '');

const noMan = gzipSync(Buffer.from('#table item 0\n'));
const r5 = await post(admin, noMan, 'noman.gz', { mode: 'inspect' });
check('RG-05', '목록(#manifest)이 없으면 거부한다', r5.status === 400, r5.body.error ?? '');

/*
 * 잠긴 파일을 시험이 스스로 연다.
 *
 * 앱의 lib/backup-lock.ts 를 부르지 않고 짜임을 다시 짠다. 같은 것을 두 번
 * 짜서 견주는 것이 시험의 값이다 - 앱이 짜임을 바꾸면 여기가 깨지고, 그것이
 * 알아야 할 일이다.
 */
function openLocked(buf, pass) {
  const magic = Buffer.from('DHRBAK1', 'ascii');
  if (!buf.subarray(0, 7).equals(magic)) throw new Error('잠긴 파일이 아니다');
  const hl = buf.readUInt16BE(7);
  const head = JSON.parse(buf.subarray(9, 9 + hl).toString('utf8'));
  const key = scryptSync(pass, Buffer.from(head.salt, 'base64'), 32,
    { N: head.N, r: head.r, p: head.p, maxmem: 64 * 1024 * 1024 });
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(head.iv, 'base64'));
  d.setAuthTag(buf.subarray(9 + hl, 9 + hl + 16));
  return Buffer.concat([d.update(buf.subarray(9 + hl + 16)), d.final()]);
}

let plain;
try {
  plain = openLocked(good, PASS);
  check('RG-16', '정한 암호로 파일이 열린다', plain.length > 0,
        `${(plain.length / 1024).toFixed(0)}KB`);
} catch (e) {
  check('RG-16', '정한 암호로 파일이 열린다', false, e.message);
  plain = Buffer.alloc(0);
}

let wrongOk = false;
try { openLocked(good, PASS + 'x'); wrongOk = true; } catch { /* 열리면 안 된다 */ }
check('RG-17', '다른 암호로는 열리지 않는다', !wrongOk);

const nicked = Buffer.from(good);
nicked[nicked.length - 20] ^= 0xff;
let nickOk = false;
try { openLocked(nicked, PASS); nickOk = true; } catch { /* 열리면 안 된다 */ }
check('RG-18', '한 바이트만 건드려도 열리지 않는다', !nickOk);

const r18 = await post(admin, nicked, goodName, { mode: 'inspect' });
check('RG-19', '손댄 잠금 파일은 서버도 열지 않는다', r18.status === 400, r18.body.error ?? '');

/* 성한 백업의 한 줄을 비튼다. 목록의 해시와 어긋나야 한다 */
const text = gunzipSync(plain).toString('utf8').split('\n');
const at = text.findIndex((l, i) => i > 1 && l.startsWith('{'));
const tampered = [...text];
tampered[at] = tampered[at].replace(/"([^"]{4,})"/, '"손댄값"');
const bad = gzipSync(Buffer.from(tampered.join('\n'), 'utf8'));

const r6 = await post(admin, bad, 'tampered.ndjson.gz', { mode: 'inspect' });
check('RG-06', '손댄 파일은 살펴보기에서 흠으로 잡는다',
      r6.status === 200 && (r6.body.flaws?.length ?? 0) > 0,
      `흠 ${r6.body.flaws?.length ?? 0}건`);

const r7 = await post(admin, bad, 'tampered.ndjson.gz', { mode: 'apply', confirm: 'tampered.ndjson.gz' });
check('RG-07', '손댄 파일로는 되돌리지 않는다', r7.status === 400, r7.body.error ?? '');

/* --- 3. 확인 문구 ------------------------------------------------------- */
const r8 = await post(admin, good, goodName, { mode: 'apply', confirm: '' });
check('RG-08', '확인 문구가 비면 되돌리지 않는다', r8.status === 400, r8.body.error ?? '');

const r9 = await post(admin, good, goodName, { mode: 'apply', confirm: '되돌린다' });
check('RG-09', '확인 문구가 다르면 되돌리지 않는다', r9.status === 400, r9.body.error ?? '');

/* --- 이 서버가 뜬 백업인가 (4차 감사 D4) ------------------------------- */
/*
 * 한 줄을 고치고 **그 표의 해시를 다시 셈해 목록에 적으면** 전에는 흠 0건으로
 * 통과했다. 파일이 스스로와 맞는지만 봤기 때문이다. 이제 목록에 서버 서명이
 * 붙으므로 목록을 손대면 서명이 어긋난다.
 */
{
  const t2 = gunzipSync(plain).toString('utf8').split(String.fromCharCode(10));
  const man = JSON.parse(t2[0].slice(10));
  const at2 = t2.findIndex((l, i) => i > 1 && l.startsWith('{'));
  let tbl = null;
  for (let i = at2; i > 0; i -= 1) {
    if (t2[i].startsWith('#table ')) { tbl = t2[i].split(' ')[1]; break; }
  }
  t2[at2] = t2[at2].replace(/"([^"]{4,})"/, '"지어낸값"');

  const rows = [];
  let cur = null;
  for (let i = 1; i < t2.length; i += 1) {
    const l = t2[i];
    if (!l) continue;
    if (l.startsWith('#table ')) { cur = l.split(' ')[1]; continue; }
    if (cur === tbl) rows.push(l);
  }
  const h = createHash('sha256');
  for (const r of rows) h.update(r).update(String.fromCharCode(10));
  man.tables[tbl].sha256 = h.digest('hex');

  const forged = gzipSync(Buffer.from(
    '#manifest ' + JSON.stringify(man) + String.fromCharCode(10)
    + t2.slice(1).join(String.fromCharCode(10)), 'utf8'));

  const rf = await post(admin, forged, 'forged.ndjson.gz', { mode: 'inspect' });
  const named = (rf.body.flaws ?? []).some((f) => f.table === '(목록)');
  check('RG-22', '목록까지 고친 백업도 서명이 어긋나 잡힌다',
        rf.status === 200 && named, `흠 ${(rf.body.flaws ?? []).length}건`);

  const rf2 = await post(admin, forged, 'forged.ndjson.gz',
    { mode: 'apply', confirm: 'forged.ndjson.gz' });
  check('RG-23', '그 파일로는 되돌리지 않는다', rf2.status === 400, rf2.body.error ?? '');
}

/* --- 약한 파일 암호 (4차 감사 G5) -------------------------------------- */
{
  const weak = await dl(admin, { pin: PIN, passphrase: 'password' });
  const wb = await weak.json().catch(() => ({}));
  check('RG-24', '너무 흔한 파일 암호는 거부한다', weak.status === 400, wb.error ?? '');
}

const r20 = await post(admin, good, goodName, { mode: 'apply', confirm: goodName, pin: '000000' });
check('RG-20', '본인 비밀번호가 틀리면 되돌리지 않는다', r20.status === 401, r20.body.error ?? '');
await c.query('select login_ok($1)', [users.SYS_ADMIN.login_code]);

const r21 = await post(admin, good, goodName, { mode: 'inspect', passphrase: 'wrong-pass-9999' });
check('RG-21', '파일 암호가 틀리면 살펴보지도 못한다', r21.status === 400, r21.body.error ?? '');

/* --- 4. 되돌릴 길이 없으면 막는가 --------------------------------------- */
/*
 * 백업 대장을 잠시 과거로 밀어 "최근 백업 없음" 상태를 만든다. 대장은 지울 수
 * 없으므로(0078) 시각만 뒤로 옮겼다가 되돌린다. 소유자로 붙어 있어 가능하다.
 */
await c.query(`alter table backup_log disable trigger backup_log_audit`);
await c.query(`update backup_log set taken_at = taken_at - interval '2 days'`);
const r10 = await post(admin, good, goodName, { mode: 'apply', confirm: goodName });
check('RG-10', '최근 백업이 없으면 되돌리지 않는다', r10.status === 400, r10.body.error ?? '');
await c.query(`update backup_log set taken_at = taken_at + interval '2 days'`);
await c.query(`alter table backup_log enable trigger backup_log_audit`);

/* --- 5. 여기까지 아무것도 안 바뀌었는가 --------------------------------- */
const probe = await one(`select name from supplier order by code limit 1`);
check('RG-11', '거부된 시도들이 자료를 건드리지 않았다',
      !probe.name.includes('문턱시험'), probe.name);

/* --- 6. 실제로 되돌아오는가 --------------------------------------------- */
/*
 * 막는 것만 보고 통과시키면 아무것도 안 하는 문이라도 전건 통과한다.
 * 자료를 바꾸고 되돌려 원래대로 오는지 본다.
 */
const before = probe.name;
await c.query(`update supplier set name = name || ' 문턱시험'
                where code = (select code from supplier order by code limit 1)`);
const dirty = (await one(`select name from supplier order by code limit 1`)).name;
check('RG-12', '되돌리기 전에 자료를 바꿔 둔다', dirty !== before, dirty);

const r13 = await post(admin, good, goodName, { mode: 'apply', confirm: goodName });
check('RG-13', '성한 파일 · 문구 · 최근 백업이 갖춰지면 되돌아간다',
      r13.status === 200 && r13.body.restored === true,
      r13.status === 200 ? `${r13.body.rowsBefore} → ${r13.body.rowsAfter}행 · ${r13.body.ms}ms`
        : (r13.body.error ?? ''));

const back = (await one(`select name from supplier order by code limit 1`)).name;
check('RG-14', '바꿔 둔 값이 되돌아왔다', back === before, back);

const rl = await one(`select count(*)::int n from restore_log`);
check('RG-15', '되돌린 사실이 복구 대장에 남았다', rl.n > 0, `${rl.n}건`);

/* --- 보고서 ------------------------------------------------------------- */
const pass = results.filter((r) => r.ok).length;
const rule = '='.repeat(78);
const stamp = (await one(
  `select to_char(timezone('Asia/Seoul', now()), 'YYYYMMDDHH24MISS') s,
          to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD HH24:MI:SS') t`));
const eng = (await one('select version() v')).v.split(' on ')[0];
await c.end();

const lines = [
  rule,
  ' DOF DHR 지원 시스템 - 복구 문턱 시험 (OQ ⑨)',
  ' 근거      : 사내문서/OQ 프로토콜.md §4.9',
  ` 실행 일시 : ${stamp.t} (Asia/Seoul)`,
  ` 대상      : ${BASE}`,
  ` 엔진      : ${eng}`,
  rule, '',
  ...results.map((r) => ` ${r.id.padEnd(8)} ${r.what.padEnd(46)} ${r.ok ? 'PASS' : 'FAIL'}`
    + (r.detail ? `   ${r.detail}` : '')),
  '', rule,
  ` 합계 ${results.length}건 · 통과 ${pass} · 실패 ${results.length - pass}`,
  rule, '',
];
if (!existsSync('reports')) mkdirSync('reports');
const out = path.join('reports', `OQ-RESTORE-${stamp.s}.txt`);
writeFileSync(out, lines.join('\n'), 'utf8');

console.log(`\n합계 ${results.length}건 · 통과 ${pass} · 실패 ${results.length - pass}`);
console.log(`보고서: ${out}`);
process.exit(pass === results.length ? 0 : 1);
