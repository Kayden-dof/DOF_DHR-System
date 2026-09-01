/**
 * 권한 매트릭스 - 어느 역할이 어느 화면에 들어가는가 (사용자 요청 2026-09-01)
 *
 *   npm run build
 *   node --env-file=.env.local scripts/access-matrix.mjs [http://localhost:3100]
 *
 * ── 코드를 읽어 적지 않는다 ───────────────────────────────────────────────
 * 화면마다 requireUser · hasRole · blocksViewer · blocksReadOnly 가 제각기
 * 걸려 있고, 그 위에 머리줄 차림표가 역할별로 다르게 그려진다. 읽어서 표로
 * 옮기면 어느 한 줄을 놓치거나, 나중에 코드가 바뀌어도 표는 그대로 남는다.
 *
 * 그래서 **실제로 두드린다.** 역할마다 계정 하나로 세션을 만들어 전 화면을
 * 요청하고, 돌아온 것을 그대로 적는다.
 *
 *   열림    화면이 그려졌다
 *   막힘    권한 없음 안내가 나왔다 (주소로 들어가도 볼 수 없다)
 *   내보냄  로그인이나 다른 화면으로 넘겼다 (307)
 *
 * ── 화면 안의 표를 여기서 지킨다 (사용자 요청 2026-09-01) ─────────────────
 * 같은 표가 이제 앱 안에도 있다 (/settings/access · lib/access.ts). 거기 적힌
 * 것은 **선언**이고 진짜는 각 화면의 판정이라, 둘이 갈라지면 그 화면이
 * 거짓말을 한다 - 사람이 그것을 믿고 계정을 만들기 때문에 없느니만 못하다.
 *
 * 그래서 두드릴 목록을 lib/access.ts 에서 그대로 읽어 온다. 목록이 하나라
 * "재는 것과 적힌 것이 서로 다른 화면"이 될 수 없고, 한 칸이라도 다르면
 * 아래에서 멈춘다.
 *
 * ── 처음 판에서 셋을 틀렸다 (2026-09-01) ──────────────────────────────────
 *   · 로그인할 수 없는 QP 계정을 골라 품질책임자 줄이 전부 "내보냄" 이 됐다.
 *     can_login=false 면 세션 자체가 서지 않는다 (lib/session.ts).
 *   · Denied 문구를 "볼 수 없습니다" 로 찾았는데 실제로는 "권한 없음" 이다.
 *     그 뒤 낱말로 찾는 것 자체를 그만뒀다 - 설정 > 권한 화면이 범례에서 그
 *     낱말을 정당하게 쓰자 제가 막힌 것으로 잡혔다. 지금은 Denied 부품에 달린
 *     data-denied 표를 본다.
 *   · 차림표를 머리줄에서만 찾아, 하위 차림표에 있는 화면이 전부 "차림표 밖"
 *     으로 나왔다.
 *
 * 재는 도구가 틀리면 표가 통째로 거짓말이 된다. 그래서 아래에 스스로 확인하는
 * 줄을 둔다 - 셋 다 열려야 하는 조합과 셋 다 막혀야 하는 조합을 먼저 본다.
 */
import fs from 'node:fs';
import pg from 'pg';
import { sessionCookie } from './session-cookie.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3100';

const ROLES = [
  ['SYS_ADMIN', '시스템관리자'],
  ['PROD_MGR',  '생산관리자'],
  ['WORKER',    '작업자'],
  ['QP',        '품질책임자'],
  ['VIEWER',    '경영열람'],
];

/* --- 화면 목록을 앱에서 읽어 온다 ---------------------------------------- */
const MARK = { '●': '열림', 'X': '막힘', '-': '내보냄' };

const src = fs.readFileSync(new URL('../lib/access.ts', import.meta.url), 'utf8');
const SCREENS = [...src.matchAll(
  /\{\s*group:\s*'([^']*)',\s*label:\s*'([^']*)',\s*path:\s*'([^']*)',\s*marks:\s*'([^']*)'\s*\}/g,
)].map(([, group, label, path, marks]) => ({ group, label, path, marks }));

/*
 * 못 읽었는데 조용히 넘어가면 대조가 0건이 되고, 그건 "전부 맞았다" 와 구별이
 * 안 된다. 이 세션에서 그런 헛도는 확인을 이미 여러 번 만났다 (§8.0.1).
 */
if (SCREENS.length < 20) {
  console.error(`lib/access.ts 에서 화면 목록을 읽지 못했습니다 (${SCREENS.length}건). `
    + 'ACCESS_ROWS 의 모양이 바뀌었는지 봐 주세요.');
  process.exit(2);
}
const badMarks = SCREENS.filter((s) => s.marks.length !== ROLES.length
  || [...s.marks].some((ch) => !(ch in MARK)));
if (badMarks.length) {
  console.error('marks 가 다섯 글자(● X -)가 아닙니다: '
    + badMarks.map((s) => s.path).join(' · '));
  process.exit(2);
}

/** 표에 적힌 것. 두드려 잰 것과 이것을 견준다 */
const declared = {};
for (const [i, [role]] of ROLES.entries()) {
  declared[role] = Object.fromEntries(SCREENS.map((s) => [s.path, MARK[s.marks[i]]]));
}

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? undefined
    : { rejectUnauthorized: false },
});
await c.connect();

const users = {};
for (const [role] of ROLES) {
  /* 로그인할 수 있는 계정만 고른다. can_login=false 면 세션이 서지 않아
     전 화면이 "내보냄" 으로 나오고, 그건 역할의 권한이 아니라 계정의 상태다 */
  const r = await c.query(
    `select u.id, u.login_code, u.full_name from app_user u
       join user_role x on x.user_id = u.id
      where x.role = $1::role_code and u.is_active and u.can_login
        and not exists (select 1 from user_role y
                         where y.user_id = u.id and y.role <> $1::role_code)
      order by u.login_code limit 1`, [role]);
  if (r.rows[0]) users[role] = r.rows[0];
}
await c.end();

const missing = ROLES.filter(([r]) => !users[r]).map(([, k]) => k);
if (missing.length) {
  console.error(`역할만 하나 가진 로그인 가능 계정이 없습니다: ${missing.join(' · ')}`);
  process.exit(2);
}

async function probe(cookie, path) {
  const r = await fetch(BASE + path, { headers: { cookie }, redirect: 'manual' });
  if (r.status === 307 || r.status === 308) return { mark: '내보냄', html: '' };
  if (r.status !== 200) return { mark: `오류 ${r.status}`, html: '' };
  const html = await r.text();
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '');
  return { mark: /data-denied/.test(body) ? '막힘' : '열림', html };
}

const result = {};
const menus = {};
for (const [role, label] of ROLES) {
  const cookie = sessionCookie(users[role].id);
  result[role] = {};
  for (const s of SCREENS) {
    const { mark, html } = await probe(cookie, s.path);
    result[role][s.path] = mark;
    /* 머리줄 차림표는 열린 화면 아무 데서나 한 번만 읽으면 된다 */
    if (mark === '열림' && !menus[role]) {
      const head = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
      const hits = [...head.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
      const seen = new Set();
      menus[role] = SCREENS
        .filter((x) => hits.includes(x.path) && !seen.has(x.path) && seen.add(x.path))
        .map((x) => x.label);
    }
  }
  console.error(`  ${label}  (${users[role].login_code} ${users[role].full_name})`);
}

/* --- 재는 도구를 먼저 확인한다 ------------------------------------------- */
const musts = [
  ['SYS_ADMIN', '/settings/users', '열림'],
  ['WORKER',    '/work',           '열림'],
  ['WORKER',    '/settings/users', '내보냄'],
  ['VIEWER',    '/board/cost',     '열림'],
  ['QP',        '/board/cost',     '막힘'],
];
const wrong = musts.filter(([r, p, want]) => result[r][p] !== want);
if (wrong.length) {
  console.error('\n재는 도구가 틀렸습니다. 아래가 기대와 다릅니다:');
  for (const [r, p, want] of wrong) {
    console.error(`  ${r} × ${p} : ${want} 를 기대했으나 ${result[r][p]}`);
  }
  process.exit(1);
}

/* --- 화면 안의 표와 대조한다 --------------------------------------------- */
const drift = [];
for (const [role] of ROLES) {
  for (const s of SCREENS) {
    if (result[role][s.path] !== declared[role][s.path]) {
      drift.push([role, s.path, declared[role][s.path], result[role][s.path]]);
    }
  }
}
if (drift.length) {
  console.error(`\nlib/access.ts 의 표가 실제와 다릅니다 (${drift.length}칸).`);
  console.error('설정 > 권한 화면이 이 표를 그대로 그리므로, 고치지 않으면 화면이'
    + ' 사실과 다른 것을 말합니다.\n');
  for (const [role, path, want, got] of drift) {
    console.error(`  ${role} × ${path} : 표에는 ${want}, 실제로는 ${got}`);
  }
  process.exit(1);
}
console.error(`\n  lib/access.ts 와 대조 · ${ROLES.length * SCREENS.length}칸 일치`);

/* --- 표 ------------------------------------------------------------------ */
console.log('\n| 화면 | 주소 | ' + ROLES.map(([, k]) => k).join(' | ') + ' |');
console.log('|---|---|' + ROLES.map(() => '---').join('|') + '|');
for (const s of SCREENS) {
  console.log(`| ${s.label} | \`${s.path}\` | `
    + ROLES.map(([r]) => result[r][s.path]).join(' | ') + ' |');
}

console.log('\n\n### 역할별 머리줄 차림표\n');
for (const [role, label] of ROLES) {
  console.log(`- **${label}** · ${(menus[role] ?? []).join(' · ') || '(관리 화면 없음)'}`);
}
