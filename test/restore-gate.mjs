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
    `select u.id, u.full_name from app_user u
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
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const r = await fetch(`${BASE}/api/restore`, {
    method: 'POST', headers: { cookie: who.cookie }, body: fd,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

console.log('\n[문턱]  복구 앞을 지키는 것들\n');

/* --- 0. 성한 백업 하나를 뜬다. 뒤의 시험들이 이것을 비튼다 -------------- */
const got = await fetch(`${BASE}/api/backup`, { headers: { cookie: admin.cookie } });
const good = Buffer.from(await got.arrayBuffer());
const goodName = (got.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/)?.[1];
check('RG-00', '시스템관리자가 백업을 뜬다', got.status === 200 && good.length > 0,
      `${goodName} · ${(good.length / 1024).toFixed(0)}KB`);
if (got.status !== 200) process.exit(1);

/* --- 1. 누가 부를 수 있는가 -------------------------------------------- */
const r1 = await fetch(`${BASE}/api/backup`, { headers: { cookie: other.cookie } });
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
const r3 = await fetch(`${BASE}/api/backup`, { redirect: 'manual' });
check('RG-03', '로그인 없이 백업을 뜨지 못한다',
      r3.status === 307 || r3.status === 308 || r3.status === 401 || r3.status === 403,
      `${r3.status} → ${r3.headers.get('location') ?? ''}`);

/* --- 2. 어떤 파일을 받아들이는가 ---------------------------------------- */
const notGz = await post(admin, Buffer.from('그냥 글자'), 'x.gz', { mode: 'inspect' });
check('RG-04', 'gzip 이 아닌 파일은 거부한다', notGz.status === 400, notGz.body.error ?? '');

const noMan = gzipSync(Buffer.from('#table item 0\n'));
const r5 = await post(admin, noMan, 'noman.gz', { mode: 'inspect' });
check('RG-05', '목록(#manifest)이 없으면 거부한다', r5.status === 400, r5.body.error ?? '');

/* 성한 백업의 한 줄을 비튼다. 목록의 해시와 어긋나야 한다 */
const text = gunzipSync(good).toString('utf8').split('\n');
const at = text.findIndex((l, i) => i > 1 && l.startsWith('{'));
const tampered = [...text];
tampered[at] = tampered[at].replace(/"([^"]{4,})"/, '"손댄값"');
const bad = gzipSync(Buffer.from(tampered.join('\n'), 'utf8'));

const r6 = await post(admin, bad, goodName, { mode: 'inspect' });
check('RG-06', '손댄 파일은 살펴보기에서 흠으로 잡는다',
      r6.status === 200 && (r6.body.flaws?.length ?? 0) > 0,
      `흠 ${r6.body.flaws?.length ?? 0}건`);

const r7 = await post(admin, bad, goodName, { mode: 'apply', confirm: goodName });
check('RG-07', '손댄 파일로는 되돌리지 않는다', r7.status === 400, r7.body.error ?? '');

/* --- 3. 확인 문구 ------------------------------------------------------- */
const r8 = await post(admin, good, goodName, { mode: 'apply', confirm: '' });
check('RG-08', '확인 문구가 비면 되돌리지 않는다', r8.status === 400, r8.body.error ?? '');

const r9 = await post(admin, good, goodName, { mode: 'apply', confirm: '되돌린다' });
check('RG-09', '확인 문구가 다르면 되돌리지 않는다', r9.status === 400, r9.body.error ?? '');

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
