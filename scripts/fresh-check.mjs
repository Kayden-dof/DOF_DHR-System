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
 * ── 심은 뒤에도 한 번 더 훑는다 ──────────────────────────────────────────
 * 처음에는 빈 상태만 봤다. 그런데 M5-4 가 형명 체계를 요구하게 만든 뒤로
 * scripts/seed-demo.mjs 가 빈 DB 에서 멈춰 있었고, 이 검사는 자료를 심지 않아
 * 그것을 못 봤다 (2026-09-01). 빈 설치가 서는 것과 그 위에 자료를 심을 수
 * 있는 것은 다른 물음이다.
 *
 * 그래서 두 번 훑는다 - 아무것도 없는 상태에서 한 번, 시연 자료를 심은 뒤에
 * 한 번. 심기가 깨지면 두 번째에서 멈춘다.
 *
 * ── 배치 하나를 끝까지 흘린다 ────────────────────────────────────────────
 * 화면이 서는 것과 **일이 되는 것**은 또 다른 물음이다. 5차 감사가 "빈 DB 에서
 * 배치 하나를 끝까지 흘려 본 적이 없다" 를 닿지 않은 곳으로 적었다 - 위의 두
 * 훑기는 화면이 그려지는지만 보지, 발행하고 기록하고 재단해 출고까지 가는지는
 * 묻지 않는다.
 *
 * 그래서 세 번째로 seed-flow 를 돌린다. 그것이 쓰는 문장은 화면이 쓰는 것과
 * 같고 규칙을 우회하지 않는다 - S04 인쇄 잠금도 그대로 걸린다. 흐른 뒤에
 * 다시 훑고, **종이 일곱 장이 실제로 나오는지**까지 본다. 종이가 정본인
 * 시스템에서 화면만 서는 것은 절반이다 (§7).
 *
 * ── 두 번째 품목을 세운다 ────────────────────────────────────────────────
 * 위의 셋은 전부 **DX2401 모양의 자료**로 본다. 빈 DB 에서 시작하기는 하지만
 * 심는 것이 DX2401 이므로, 형명 자리 수가 다르거나 재단 분기가 없는 품목에서
 * 무엇이 어긋나는지는 한 번도 묻지 않았다. §2.0 의 판단 기준은 "다른 제조소가
 * 받아 쓸 수 있는가" 인데 **다른 제조소의 품목이 시험에 없었다.**
 *
 * 그래서 네 번째로 seed-second 를 돌린다 - 형명 자리도 공정 구조도 자재
 * 기준도 DX2401 과 다른 품목을 하나 더 세우고, 그 배치도 끝까지 흘리고,
 * **그 품목의 종이도 뽑는다.** 두 품목이 한 설치에 함께 서는지도 거기서 나온다.
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

  /* --- 4) 빈 상태로 전 화면을 두드린다 ------------------------------------ */
  const sweep = (label, extra = {}) => {
    console.log(`\n[${label}]`);
    const r = spawnSync(process.execPath,
      [path.join(ROOT, 'scripts', 'smoke.mjs'), base],
      { env: { ...env, ...extra }, cwd: ROOT, encoding: 'utf8' });
    process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return r.status ?? 1;
  };
  /*
   * 빈 설치는 **이관이 심는 계정**으로 훑는다 (4차 감사 A4).
   *
   * 전에는 시연 계정(100200 · 200100)으로 훑었다. 빈 DB 에 그 계정이 없으니
   * 세션이 서지 않아 전 경로가 307 이 되었고, smoke 가 307 을 통과로 세었다.
   * §8.0 이 "§2.0 을 묻는 유일한 자리" 라고 적은 이 훑기가 화면을 한 장도
   * 그려 보지 않은 채 통과를 찍고 있었다.
   *
   * 작업자 계정은 이관이 심지 않는다. 현장 훑기는 건너뛴다고 말하고 건너뛴다.
   */
  bad = sweep('빈 설치', { SMOKE_ADMIN_CODE: '000000', SMOKE_WORKER_CODE: '-' });

  /* --- 5) 시연 자료를 심고 다시 두드린다 ----------------------------------- */
  if (bad === 0) {
    console.log('\n[시연 자료 심기]');
    const sd = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'seed-demo.mjs')],
      { env, cwd: ROOT, encoding: 'utf8' });
    if (sd.status !== 0) {
      process.stdout.write(sd.stdout);
      process.stderr.write(sd.stderr);
      console.error('\n  빈 DB 에 시연 자료를 심지 못했습니다.');
      bad = 1;
    } else {
      /* 심은 줄 수만 보인다. 비밀번호는 찍지 않는다 */
      process.stdout.write(sd.stdout.split('\n')
        .filter((l) => /^(품목|설비|공수|밸리|자재|형명|배치|제품|기록)/.test(l.trim()))
        .map((l) => `  ${l.trim()}`).join('\n') + '\n');
      bad = sweep('시연 자료를 심은 뒤');
    }
  }

  /* --- 6) 배치 하나를 끝까지 흘리고 종이를 뽑아 본다 ----------------------- */
  if (bad === 0) {
    console.log('\n[배치 하나를 끝까지]');
    const sf = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'seed-flow.mjs')],
      { env, cwd: ROOT, encoding: 'utf8' });
    if (sf.status !== 0) {
      process.stdout.write(sf.stdout);
      process.stderr.write(sf.stderr);
      console.error('\n  빈 DB 에서 세운 설정으로 배치를 끝까지 흘리지 못했습니다.');
      bad = 1;
    } else {
      process.stdout.write(sf.stdout.split('\n')
        .filter((l) => l.trim())
        .slice(-8).map((l) => `  ${l.trim()}`).join('\n') + '\n');
      bad = sweep('배치를 흘린 뒤');
      if (bad === 0) bad = await papers(base, env, '종이');
    }
  }

  /* --- 7) DX2401 과 다르게 생긴 품목을 하나 더 세운다 --------------------- */
  if (bad === 0) {
    console.log('\n[두 번째 품목]');
    const sc = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'seed-second.mjs')],
      { env, cwd: ROOT, encoding: 'utf8' });
    process.stdout.write((sc.stdout ?? '').split('\n')
      .filter((l) => l.trim()).map((l) => `  ${l.trim()}`).join('\n') + '\n');
    if (sc.stderr) process.stderr.write(sc.stderr);
    if (sc.status !== 0) {
      console.error('\n  두 번째 품목이 서지 않았습니다.');
      bad = 1;
    } else {
      bad = sweep('두 품목이 함께 있는 상태');
      if (bad === 0) bad = await papers(base, env, '두 번째 품목의 종이', 'CG3100');
    }
  }
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
  ? '\n빈 DB 에서 세운 설정으로 배치가 끝까지 흐르고, 종이가 나옵니다.\n'
    + '서로 다르게 생긴 두 품목이 한 설치에 함께 섭니다.\n'
  : '\n위에서 멈춘 자리를 보십시오.\n');
process.exit(bad === 0 ? 0 : 1);

/* ---------------------------------------------------------------------------
   종이가 실제로 나오는가 (§7)

   화면이 서는 것과 종이가 나오는 것은 다르다. 인쇄 경로는 자료를 다시 모아
   쪽을 나누고 자료 식별자를 만드는데, 그 자리에서 자료가 비어 던지면 화면
   훑기는 그것을 못 본다 - 훑기가 인쇄 경로를 열지 않기 때문이다.
   (제조기록서는 여는 것만으로 묶음이 잠기므로 여기서 열지 않는다. 그것은
   seed-flow 가 이미 흐르며 뽑았고, 인쇄 충실성은 test/print.mjs 가 본다.)
--------------------------------------------------------------------------- */
async function papers(base, env, label, productCode = null) {
  const { default: pgLib } = await import('pg');
  const c = new pgLib.Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  const id = async (sql, p = []) => (await c.query(sql, p)).rows[0]?.id ?? null;
  /*
   * 어느 배치의 종이인지 고른다. 품목을 주지 않으면 가장 먼저 발행된 것이다.
   * 두 번째 품목을 세운 뒤에는 **그 품목의 배치**를 집어야 한다 - 아니면 새
   * 품목의 종이를 한 장도 안 뽑고 통과를 찍는다.
   */
  const wo = productCode
    ? await id(
      `select w.id from work_order w
         join device_master dm on dm.id = w.device_master_id
        where dm.product_code = $1 order by w.issued_at limit 1`, [productCode])
    : await id(`select id from work_order order by issued_at limit 1`);
  /*
   * 제품 로트와 자재 로트는 **고른 배치의 것**이어야 한다.
   *
   * 전에는 배치와 무관하게 가장 이른 것을 집었다. 출하 승인 요청서는
   * sel 로 받은 로트만 그리므로, 다른 배치의 로트를 주면 표가 빈 채로
   * 200 이 나오고 길이도 넉넉해서 통과였다 - 종이에 아무 로트도 없는데
   * 나왔다고 적고 있었다 (2026-09-04).
   */
  /* 같은 날 만들어진 로트가 여럿이므로 로트번호까지 걸어 순서를 못박는다 */
  const pl = await id(`select id from product_lot where work_order_id = $1
                        order by manufactured_on, lot_no limit 1`, [wo]);
  const ml = await id(`select ml.id from work_order w join material_lot ml
                         on ml.id = w.material_lot_id where w.id = $1`, [wo]);
  const eq = await id(`select id from equipment limit 1`);
  const admin = await id(`select id from app_user where login_code = '100200'`);
  /*
   * 종이가 **그 배치의 값을 담고 있는지**도 함께 본다.
   *
   * 200 과 <h1> 만 보면 다른 품목의 종이가 나와도 통과다. 실제로 두 번째
   * 품목을 붙일 때 이 검사는 DX2401 배치만 집고 있었고, 새 품목의 종이를
   * 한 장도 안 뽑은 채 통과를 찍었다 (2026-09-04).
   *
   * 규격 문구는 spec_label 하나에서만 온다 (§7 · §10). 그러니 종이에 그
   * 문구가 있는지 물으면 형명 체계까지 함께 확인된다.
   */
  const meta = (await c.query(
    `select w.batch_no, spec_label(i.code) as spec
       from product_lot pl
       join work_order w on w.id = pl.work_order_id
       join item i on i.id = pl.item_id
      where pl.id = $1`, [pl])).rows[0] ?? {};
  await c.end();

  const { sessionCookie } = await import('./session-cookie.mjs');
  const cookie = sessionCookie(admin);

  const want = [
    ['작업 지시서',      `/print/work-order/${wo}`,   meta.batch_no],
    ['라벨요청서',       `/print/label-request/${wo}`, meta.spec],
    ['편철 표지',        `/print/cover/${wo}`,        meta.batch_no],
    ['자재 라벨',        `/print/label/${ml}`],
    /* 이 종이는 배치 단위다. 어느 로트를 몇 개 내보내는지는 sel 로 실린다 */
    ['출하 승인 요청서', `/print/release-request/${wo}?sel=${pl}:1`, meta.spec],
    ['설비 사용 기록',   `/print/equipment-log/${eq}`],
  ];

  console.log(`\n[${label}]`);
  let bad = 0;
  for (const [name, path_, carries] of want) {
    if (/(null|undefined)/.test(path_)) {
      console.log(`  못 뽑음  ${name.padEnd(18)} 대상이 없습니다`);
      bad = 1;
      continue;
    }
    const r = await fetch(base + path_, { headers: { cookie } });
    const html = await r.text();
    /* 200 만으로는 모자란다. 부품이 서버에서 죽으면 그 자리가 비고 200 이 된다 */
    const drawn = /<h1[^>]*>/.test(html) && html.length > 4000;
    /* 그리고 그 배치의 값이 실제로 실려 있어야 한다 */
    const held = !carries || html.includes(carries);
    const ok = r.status === 200 && drawn && held;
    if (!ok) bad = 1;
    console.log(`  ${ok ? '나옴  ' : '못 나옴'}  ${name.padEnd(18)}`
      + `${r.status} · ${html.length.toLocaleString()}자`
      + (carries ? `  ${held ? '담김' : '안 담김'} "${carries}"` : ''));
  }
  return bad;
}
