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
 * ── 처음 판에서 셋을 틀렸다 (2026-09-01) ──────────────────────────────────
 *   · 로그인할 수 없는 QP 계정을 골라 품질책임자 줄이 전부 "내보냄" 이 됐다.
 *     can_login=false 면 세션 자체가 서지 않는다 (lib/session.ts).
 *   · Denied 문구를 "볼 수 없습니다" 로 찾았는데 실제로는 "권한 없음" 이다.
 *   · 차림표를 머리줄에서만 찾아, 하위 차림표에 있는 화면이 전부 "차림표 밖"
 *     으로 나왔다.
 *
 * 재는 도구가 틀리면 표가 통째로 거짓말이 된다. 그래서 아래에 스스로 확인하는
 * 줄을 둔다 - 셋 다 열려야 하는 조합과 셋 다 막혀야 하는 조합을 먼저 본다.
 */
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

const SCREENS = [
  ['현황',        '/'],
  ['경영 현황',   '/board'],
  ['원가',        '/board/cost'],
  ['작업 지시',   '/production'],
  ['제품',        '/production/setup'],
  ['일탈',        '/production/deviation'],
  ['자재 로트',   '/material'],
  ['품목 (자재)', '/material/items'],
  ['발주',        '/material/orders'],
  ['재고',        '/material/stock'],
  ['증감 · 용액', '/material/movement'],
  ['설비',        '/equipment'],
  ['출하 승인',   '/shipping'],
  ['멸균 위탁',   '/shipping/steril'],
  ['출고',        '/shipping/ship'],
  ['계보 추적',   '/trace'],
  ['인쇄물',      '/trace/verify'],
  ['설정 개요',   '/settings'],
  ['회사 표시',   '/settings/brand'],
  ['채번 규칙',   '/settings/numbering'],
  ['품목 (설정)', '/settings/items'],
  ['공급자',      '/settings/suppliers'],
  ['제품표준서',  '/settings/dmr'],
  ['사용자',      '/settings/users'],
  ['감사추적',    '/settings/audit'],
  ['현장',        '/work'],
];

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
  return { mark: /권한 없음/.test(body) ? '막힘' : '열림', html };
}

const result = {};
const menus = {};
for (const [role, label] of ROLES) {
  const cookie = sessionCookie(users[role].id);
  result[role] = {};
  for (const [name, path] of SCREENS) {
    const { mark, html } = await probe(cookie, path);
    result[role][name] = mark;
    /* 머리줄 차림표는 열린 화면 아무 데서나 한 번만 읽으면 된다 */
    if (mark === '열림' && !menus[role]) {
      const head = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
      const hits = [...head.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
      const seen = new Set();
      menus[role] = SCREENS
        .filter(([, p]) => hits.includes(p) && !seen.has(p) && seen.add(p))
        .map(([n]) => n);
    }
  }
  console.error(`  ${label}  (${users[role].login_code} ${users[role].full_name})`);
}

/* --- 재는 도구를 먼저 확인한다 ------------------------------------------- */
const musts = [
  ['SYS_ADMIN', '사용자',   '열림'],
  ['WORKER',    '현장',     '열림'],
  ['WORKER',    '사용자',   '내보냄'],
  ['VIEWER',    '원가',     '열림'],
  ['QP',        '원가',     '막힘'],
];
const wrong = musts.filter(([r, s, want]) => result[r][s] !== want);
if (wrong.length) {
  console.error('\n재는 도구가 틀렸습니다. 아래가 기대와 다릅니다:');
  for (const [r, s, want] of wrong) {
    console.error(`  ${r} × ${s} : ${want} 를 기대했으나 ${result[r][s]}`);
  }
  process.exit(1);
}

/* --- 표 ------------------------------------------------------------------ */
console.log('\n| 화면 | 주소 | ' + ROLES.map(([, k]) => k).join(' | ') + ' |');
console.log('|---|---|' + ROLES.map(() => '---').join('|') + '|');
for (const [name, path] of SCREENS) {
  console.log(`| ${name} | \`${path}\` | `
    + ROLES.map(([r]) => result[r][name]).join(' | ') + ' |');
}

console.log('\n\n### 역할별 머리줄 차림표\n');
for (const [role, label] of ROLES) {
  console.log(`- **${label}** · ${(menus[role] ?? []).join(' · ') || '(관리 화면 없음)'}`);
}
