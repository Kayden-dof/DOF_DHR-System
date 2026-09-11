/* ---------------------------------------------------------------------------
   망 경계 검사

     node scripts/net-check.mjs [http://localhost:3100]

   세 가지를 묻는다.

     ① 접속지 규칙이 실제로 가르는가   - lib/net.ts 를 직접 불러 대조한다
     ② 보안 머리글이 실제로 나가는가   - 도는 서버에서 받아 읽는다
     ③ 비밀이 저장소에 들어 있는가     - 추적되는 파일을 훑는다

   ③ 이 이 검사의 이유다. "코드를 빼도 밖에서는 운영할 수 없다" 는 말은
   **코드에 비밀이 없을 때만** 성립한다. 접속 문자열 하나가 커밋에 섞이면
   앞의 두 겹은 아무 뜻이 없다.

   ② 는 서버가 없으면 볼 수 없다. 그때는 통과라고 하지 않고 멈춘다 -
   아무것도 안 보고 통과라고 말하는 검사가 가장 나쁘다 (§8.0.1).
--------------------------------------------------------------------------- */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readAllow, allows, readAddr, clientIp } from '../lib/net.ts';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const ROOT = process.cwd();

let pass = 0;
const fails = [];
const ok = (name) => { pass += 1; console.log(`  o ${name}`); };
const bad = (name, why) => {
  fails.push(`${name} - ${why}`);
  console.log(`  X ${name} - ${why}`);
};
const is = (name, got, want) => (got === want ? ok(name) : bad(name, `${got} (기대 ${want})`));

/* ---------------------------------------------------------------------------
   ① 접속지 규칙
--------------------------------------------------------------------------- */
console.log('\n접속지 규칙');

const ALLOW = readAllow('203.0.113.9, 198.51.100.0/24 2001:db8:abcd::/48');
is('규칙 3개를 읽는다', ALLOW.rules.length, 3);
is('못 읽은 조각 없음', ALLOW.bad.length, 0);
is('오타는 버리지 않고 돌려준다', readAllow('203.0.113.999').bad.length, 1);
is('마스크가 범위를 넘으면 규칙이 아니다', readAllow('203.0.113.0/33').bad.length, 1);

const R = ALLOW.rules;
const yes = (ip) => (allows(R, ip) ? ok(`통과 ${ip || '(빈 값)'}`) : bad(`통과 ${ip}`, '막혔다'));
const no = (ip) => (allows(R, ip) ? bad(`차단 ${ip}`, '통과했다') : ok(`차단 ${ip || '(빈 값)'}`));

yes('203.0.113.9');
no('203.0.113.10');
yes('198.51.100.1');
yes('198.51.100.255');
no('198.51.101.1');
yes('2001:db8:abcd:1::5');
no('2001:db8:abce::5');
/* IPv4-매핑으로 와도 IPv4 규칙이 알아본다 */
yes('::ffff:203.0.113.9');
no('');
no('그냥글자');
no('203.0.113');

/* /0 은 전부를 연다. 적어 넣은 사람의 뜻이므로 그대로 따른다 */
const ALL = readAllow('0.0.0.0/0').rules;
is('0.0.0.0/0 은 전부 통과', allows(ALL, '8.8.8.8'), true);
is('0.0.0.0/0 이 IPv6 까지 열지는 않는다', allows(ALL, '2001:db8::1'), false);

/* 접속지를 어디서 읽는가 - Vercel 이 채운 것이 먼저다 */
is('Vercel 머리글을 먼저 읽는다',
   clientIp(new Headers({
     'x-forwarded-for': '1.2.3.4',
     'x-vercel-forwarded-for': '203.0.113.9',
   })), '203.0.113.9');
is('없으면 x-forwarded-for 의 첫 자리',
   clientIp(new Headers({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' })), '5.6.7.8');
is('아무것도 없으면 null', clientIp(new Headers()), null);
is('주소를 못 읽으면 null', readAddr('1.2.3.4.5'), null);

/* ---------------------------------------------------------------------------
   ② 보안 머리글
--------------------------------------------------------------------------- */
console.log('\n보안 머리글');

let res;
try {
  res = await fetch(`${BASE}/login`, { redirect: 'manual' });
} catch (e) {
  console.error(`\n서버에 닿지 못했습니다 (${BASE}) - ${e.message}`);
  console.error('머리글은 도는 서버에서만 볼 수 있습니다. npm run dev 를 켜고 다시 하십시오.');
  process.exit(1);
}

const want = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow',
};
for (const [k, v] of Object.entries(want)) is(k, res.headers.get(k), v);

const csp = res.headers.get('content-security-policy') ?? '';
for (const piece of [
  "default-src 'self'", "frame-ancestors 'none'", "form-action 'self'",
  "base-uri 'self'", "object-src 'none'",
]) {
  if (csp.includes(piece)) ok(`csp ${piece}`); else bad(`csp ${piece}`, '없다');
}

/* 검색에 올리지 않는다 */
const robotsRes = await fetch(`${BASE}/robots.txt`, { redirect: 'manual' });
const robots = await robotsRes.text().catch(() => '');
if (robots.includes('Disallow: /')) ok('robots.txt 가 전부 막는다');
else bad('robots.txt', robots.slice(0, 60).replace(/\s+/g, ' '));

/* 화면이 아닌 응답에도 같은 머리글이 붙는가 */
is('정적 응답에도 머리글이 붙는다', robotsRes.headers.get('x-content-type-options'), 'nosniff');

/* ---------------------------------------------------------------------------
   ③ 저장소에 비밀이 있는가

   추적되는 파일만 본다. 추적되지 않는 .env.local 에 비밀이 있는 것은 정상이다.
--------------------------------------------------------------------------- */
console.log('\n저장소의 비밀');

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter((f) => !/\.(woff2?|png|jpg|jpeg|ico|zip|crt|pdf)$/i.test(f));

/*
 * ── 헛경보를 내지 않는다 ──────────────────────────────────────────────────
 * 개발용 접속 문자열(`postgres:postgres@localhost`)과 도움말의 본보기
 * (`user:pw@host/db`)는 비밀이 아니다. 이런 것에 걸리는 검사는 곧 아무도
 * 읽지 않게 되고, 그러면 진짜가 섞여 들어와도 그 줄에 묻힌다.
 *
 * 가르는 자리는 **주소**다. 바깥 서버의 주소에는 점이 있다
 * (`db….supabase.co`). `localhost` 와 본보기의 `host` 에는 없다.
 */
const LOCAL_HOST = /^(127\.0\.0\.1|\[?::1\]?|[a-z0-9_-]+)$/i;

const SUSPECT = [
  [/postgres(ql)?:\/\/[^\s'"`<>]*:[^\s'"`<>@]+@([^\s'"`<>:/]+)/gi,
   '접속 문자열에 비밀번호가 박혀 있다',
   (m) => LOCAL_HOST.test(m[2])],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, 'JWT 로 보이는 값 (Supabase 열쇠)'],
  [/(SESSION_SECRET|PRINT_SECRET|CRON_SECRET|DEMO_PIN)\s*[=:]\s*['"]?[A-Za-z0-9+/=_-]{8,}/g,
   '열쇠 값이 적혀 있다'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '개인 열쇠 파일'],
];

/*
 * ── 이 검사가 실제로 잡는가 ───────────────────────────────────────────────
 * "비밀 없음" 은 둘 중 하나다 - 없거나, 검사가 아무것도 안 보거나 (§8.0.1).
 * 걸려야 하는 본보기와 걸리면 안 되는 본보기를 먼저 통과시킨다.
 */
const caught = (text) => SUSPECT.some(([re, , fine]) =>
  [...text.matchAll(re)].some((m) => !/[<{]/.test(m[0]) && !(fine && fine(m))));

for (const [sample, want, name] of [
  ['postgresql://postgres.abcd:Hunter2@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres',
   true, '진짜 접속 문자열을 잡는다'],
  ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTcwMH0',
   true, 'Supabase 열쇠를 잡는다'],
  ["SESSION_SECRET='3f8a2c91d4e7b60518af2c3d9e0b7146'", true, '열쇠 값을 잡는다'],
  ['postgres://postgres:postgres@localhost:54330/dhr', false, '개발용은 잡지 않는다'],
  ['DATABASE_URL=postgres://user:pw@host:5432/dbname', false, '도움말 본보기는 잡지 않는다'],
  ['DATABASE_URL=postgresql://<user>:<password>@<host>:6543/postgres',
   false, '꺾쇠 자리는 잡지 않는다'],
]) is(name, caught(sample), want);

const NUL = String.fromCharCode(0);
const hits = [];
for (const f of tracked) {
  let text;
  try { text = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  if (text.includes(NUL)) continue;                       /* 이진 파일 */
  for (const [re, why, fine] of SUSPECT) {
    for (const m of text.matchAll(re)) {
      /* <password> 처럼 꺾쇠로 감싼 자리는 본보기다 */
      if (/[<{]/.test(m[0])) continue;
      if (fine && fine(m)) continue;
      hits.push(`${f} - ${why} (${m[0].slice(0, 60)})`);
      break;
    }
  }
}
if (hits.length === 0) ok(`추적 파일 ${tracked.length}개에 비밀 없음`);
else hits.forEach((x) => bad('비밀이 들어 있다', x));

/* .env 류가 통째로 무시되는가 */
const ignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
if (ignore.includes('.env.*')) ok('.gitignore 가 .env.* 를 통째로 막는다');
else bad('.gitignore', '.env.* 가 없다 - 새 이름을 지을 때마다 적어야 한다');

/* ---------------------------------------------------------------------------
   맺음
--------------------------------------------------------------------------- */
console.log(`\n${pass}건 통과${fails.length ? ` · ${fails.length}건 실패` : ''}`);
if (fails.length) {
  for (const f of fails) console.log(`  ${f}`);
  process.exit(1);
}
