/**
 * 새 설치가 서는가 (§2.0 · M5 완료 판정)
 *
 *   npm run build
 *   node --env-file=.env.local scripts/fresh-check.mjs
 *
 * ── 무엇을 묻는가 ─────────────────────────────────────────────────────────
 * §2.0 이 정한 것은 하나다 - **다른 제조소가 이 프로그램을 코드를 고치지 않고
 * 받아 쓸 수 있는가.** M5 의 완료 판정도 그 문장이다.
 *
 * 그 말은 시험으로 답해야 한다. 지금 있는 시험은 전부 자료가 들어 있는 DB 를
 * 본다 - 품목 47종, 배치 6건, 로고 한 장. 그 상태에서 도는 것은 이미 셋업이
 * 끝난 제조소가 쓴다는 뜻이지, 아무것도 없는 곳에서 시작할 수 있다는 뜻이
 * 아니다.
 *
 * 그래서 **빈 DB 를 만들어 이관만 올리고 전 화면을 두드린다.** 화면 하나가
 * 자료가 없다고 던지면 새로 받은 제조소는 첫날 그 화면에서 막힌다.
 *
 * 실제로 이 검사를 만들면서 확인한 것 - 빈 설치에서도 전 화면이 서고, 설정
 * 차례표가 무엇이 비었는지 낱낱이 짚는다 (2026-09-01).
 *
 * ── 안전 ──────────────────────────────────────────────────────────────────
 * DB 를 만들고 지운다. 그래서 **localhost 가 아니면 거부한다.** 이름도
 * dhr_fresh_check 하나로 고정한다 - 다른 DB 를 지울 길을 두지 않는다.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB = 'dhr_fresh_check';
const PORT = process.env.FRESH_PORT ?? '3190';

const given = process.env.DATABASE_URL;
if (!given) {
  console.error('DATABASE_URL 이 없습니다. --env-file=.env.local 로 주십시오.');
  process.exit(2);
}

const u = new URL(given);
if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname)) {
  console.error(`이 검사는 DB 를 만들고 지웁니다. localhost 에서만 돕니다 (${u.hostname}).`);
  process.exit(2);
}

if (!existsSync(path.join(ROOT, '.next'))) {
  console.error('빌드가 없습니다. 먼저 npm run build 를 돌리십시오.');
  process.exit(2);
}

const adminUrl = new URL(given); adminUrl.pathname = '/postgres';
const freshUrl = new URL(given); freshUrl.pathname = `/${DB}`;

console.log('\n새 설치가 서는가 (§2.0 · M5)\n');

/* --- 1) 빈 DB ------------------------------------------------------------ */
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`drop database if exists ${DB}`);
await admin.query(`create database ${DB}`);
console.log(`  빈 DB ${DB} 를 만들었습니다`);

const env = { ...process.env, DATABASE_URL: freshUrl.toString() };
let srv;
let bad = 1;

try {
  /* --- 2) 이관만 올린다. 시연 자료는 넣지 않는다 ------------------------- */
  const dep = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'deploy-db.mjs')],
    { env, cwd: ROOT, encoding: 'utf8' });
  if (dep.status !== 0) {
    console.error(dep.stdout + dep.stderr);
    throw new Error('이관이 올라가지 않았습니다');
  }
  const applied = (dep.stdout.match(/ {2}적용 {2}/g) ?? []).length;
  console.log(`  이관 ${applied}건을 올렸습니다`);

  /* --- 3) 서버를 세운다 --------------------------------------------------- */
  srv = spawn(process.execPath,
    [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', PORT],
    { env, cwd: ROOT, stdio: 'ignore' });

  const base = `http://localhost:${PORT}`;
  let up = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`${base}/login`);
      if (r.status === 200) { up = true; break; }
    } catch { /* 아직 안 떴다 */ }
  }
  if (!up) throw new Error(`서버가 ${PORT} 에 뜨지 않았습니다`);
  console.log(`  서버를 ${PORT} 에 세웠습니다\n`);

  /* --- 4) 전 화면을 두드린다 ---------------------------------------------- */
  const sm = spawnSync(process.execPath,
    [path.join(ROOT, 'scripts', 'smoke.mjs'), base],
    { env, cwd: ROOT, encoding: 'utf8' });
  process.stdout.write(sm.stdout);
  if (sm.stderr) process.stderr.write(sm.stderr);
  bad = sm.status ?? 1;
} finally {
  if (srv) srv.kill();
  /* 죽는 데 잠깐 걸린다. 붙어 있으면 DB 를 못 지운다 */
  await new Promise((r) => setTimeout(r, 1500));
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`, [DB]);
  await admin.query(`drop database if exists ${DB}`);
  await admin.end();
  console.log(`\n  ${DB} 를 지웠습니다`);
}

console.log(bad === 0
  ? '\n아무것도 없는 DB 에서 전 화면이 섭니다. 새로 받은 제조소가 첫날 막히지 않습니다.\n'
  : '\n빈 설치에서 서지 않는 화면이 있습니다. 위 목록을 보십시오.\n');
process.exit(bad === 0 ? 0 : 1);
