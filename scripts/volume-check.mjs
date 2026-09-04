/**
 * 자료가 쌓여도 화면이 서는가
 *
 *   npm run build
 *   npm run volume            (기본 300배치)
 *   VOLUME_BATCHES=600 npm run volume
 *
 * ── 무엇을 묻는가 ─────────────────────────────────────────────────────────
 * 다른 시험은 전부 **적은 자료**를 본다. 시연 자료가 배치 6건이고, 빈 DB
 * 검사는 배치 한둘이다. 그 상태에서 화면이 뜨는 것은 첫날 뜬다는 뜻이지
 * 3년 뒤에도 뜬다는 뜻이 아니다.
 *
 * 3인 현장에서 배치가 한 달에 예닐곱이면 5년에 400건 안팎이다. 그때
 * 공정 기록은 5천 줄, 자재 투입은 3천 줄, 인쇄 대장은 2천 줄이 된다.
 * **그 자리에서 어느 화면이 느려지는지 아무도 본 적이 없다.**
 *
 * 그래서 배치를 쌓아 두고 화면마다 시간을 잰다. 두 번 잰다 - 적을 때 한 번,
 * 쌓은 뒤 한 번. **늘어난 배수**가 시간보다 정직한 신호다. 자료가 30배로
 * 늘었는데 시간이 30배가 되면 줄마다 훑고 있다는 뜻이고, 그대로면 색인이
 * 일하고 있다는 뜻이다. 기계마다 절대 시간은 다르지만 배수는 덜 흔들린다.
 *
 * ── 무엇을 못 잡는가 ──────────────────────────────────────────────────────
 * 맞는지는 보지 않는다. 그건 규칙 시험과 인쇄 대조가 본다. 여기서 보는 것은
 * **얼마나 걸리는가** 하나다. 그리고 이 노트북의 embedded-postgres 는 운영
 * 서버가 아니다 - 절대 시간을 운영 약속으로 읽지 말 것.
 *
 * ── 안전 ──────────────────────────────────────────────────────────────────
 * DB 를 만들고 지운다. **localhost 가 아니면 거부한다.** 이름도
 * dhr_volume_check 하나로 고정한다.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB = 'dhr_volume_check';
const PORT = process.env.VOLUME_PORT ?? '3193';
const BATCHES = Number(process.env.VOLUME_BATCHES ?? 300);
const SMALL = 10;                       // 처음 잴 때의 배치 수

/** 이만큼을 넘으면 사람이 기다린다고 느낀다. 넘으면 실패다. */
const CEILING_MS = 3000;
/** 늘어난 배수가 이보다 크면 줄마다 훑고 있다는 뜻이다. */
const GROWTH_WARN = 8;

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
const dbUrl = new URL(given); dbUrl.pathname = `/${DB}`;
const env = { ...process.env, DATABASE_URL: dbUrl.toString() };

console.log(`\n자료가 쌓여도 화면이 서는가 (배치 ${SMALL} → ${BATCHES})\n`);

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`drop database if exists ${DB}`);
await admin.query(`create database ${DB} encoding 'UTF8' template template0 locale 'C'`);

const c = new pg.Client({ connectionString: dbUrl.toString() });
let srv;
let bad = 1;

try {
  await c.connect();

  /* --- 1) 이관과 기준정보 ------------------------------------------------- */
  const dep = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'deploy-db.mjs')],
    { env, cwd: ROOT, encoding: 'utf8' });
  if (dep.status !== 0) { console.error(dep.stdout + dep.stderr); throw new Error('이관 실패'); }

  const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'seed-demo.mjs')],
    { env: { ...env, SEED_BASE_ONLY: '1', DEMO_PIN: '123456' }, cwd: ROOT, encoding: 'utf8' });
  if (seed.status !== 0) { console.error(seed.stdout + seed.stderr); throw new Error('기준정보 실패'); }
  console.log('  이관과 기준정보를 세웠습니다');

  /* --- 2) 배치를 쌓는 도구 ------------------------------------------------ */
  const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
  const val = async (sql, p = []) => Object.values((await one(sql, p)) ?? {})[0];
  const all = async (sql, p = []) => (await c.query(sql, p)).rows;

  async function as(userId, fn) {
    await c.query('begin');
    try {
      await c.query('set local role app_role');
      await c.query(`select set_config('app.user_id', $1, true)`, [userId]);
      const r = await fn();
      await c.query('commit');
      return r;
    } catch (e) { await c.query('rollback'); throw e; }
  }

  const users = Object.fromEntries(
    (await all(`select login_code, id from app_user`)).map((x) => [x.login_code, x.id]));
  const adminId = users['000000'];
  const mgr = users['100200'];
  const w1 = users['200100'];
  const w2 = users['200200'];
  await c.query(`select set_config('app.user_id', $1, false)`, [adminId]);

  const dm = await one(
    `select id, revision, item_id from device_master where verified_at is not null limit 1`);
  const ops = await all(
    `select o.id, o.seq, o.code, o.after_cutting,
            coalesce((select json_agg(b.component_item_id) from dmr_bom b
                       where b.operation_id = o.id), '[]'::json) as bom
       from dmr_operation o where o.device_master_id = $1 order by o.seq`, [dm.id]);
  const rawItem = await val(`select id from item where type = 'RAW' limit 1`);
  const sup = await val(`select id from supplier where status = 'APPROVED' order by code limit 1`);
  const fins = await all(`select id, code from item where type = 'FIN' order by code limit 3`);

  /* 자재는 한 번에 넉넉히 받아 둔다. 재고가 모자라 흐름이 끊기면 잰 값이 거짓이 된다 */
  const stock = {};
  for (const it of await all(`select id from item where type in ('REAGENT','PACK')`)) {
    const lot = await val(`select next_number('MATERIAL_LOT', $1)`, [it.id]);
    stock[it.id] = await val(
      `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no, coa_no,
         coa_date, received_at, registered_by, qty_received, qty_available)
       values ($1,$2,$3,$4,$5,current_date,now(),$6,1000000,1000000) returning id`,
      [it.id, lot, sup, 'SL-' + lot.slice(-4), 'COA-' + lot.slice(-4), adminId]);
  }

  /** 배치 하나를 발행부터 출고까지. 화면이 쓰는 문장과 같다. */
  /*
   * 배치를 며칠 간격으로 흩는가. 일차가 셋이므로 셋보다 넓어야 겹치지 않고,
   * 가장 최근 배치도 오늘보다 앞이어야 한다 (0052 · trg_pr_workdate).
   * 배치 수에서 거꾸로 잡는다 - 박아 두면 배치가 늘 때 조용히 미래로 샌다.
   */
  const STEP = 4;
  const SPAN = BATCHES * STEP + 10;

  async function makeBatch(n) {
    const back = SPAN - n * STEP;                 // 오늘에서 이만큼 앞
    const rawLot = await val(`select next_number('MATERIAL_LOT', $1)`, [rawItem]);
    const rawId = await val(
      `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no, coa_no,
         coa_date, received_at, registered_by, qty_received, qty_available, thickness_band)
       values ($1,$2,$3,$4,$5,current_date - ${back + 1},
               now() - '${back + 1} days'::interval,$6,30,0,'0510') returning id`,
      [rawItem, rawLot, sup, 'SL-' + rawLot.slice(-4), 'COA-' + rawLot.slice(-4), adminId]);

    const wo = await as(mgr, async () => {
      const woNo = await val(`select next_number('WORK_ORDER')`);
      const bNo = await val(`select next_number('BATCH')`);
      return val(
        `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
                                 material_lot_id, sheet_count, issued_by_prod, issued_by_qa,
                                 issued_at)
         values ($1,$2,$3,$4,$5,20,$6,$7,
                 timezone('Asia/Seoul', (timezone('Asia/Seoul', now()))::date - ${back}))
         returning id`, [woNo, bNo, dm.id, dm.revision, rawId, w1, mgr]);
    });

    /* 재단 전 공정 · 1~2일차 */
    const lots = [];
    let min = 480;
    for (const o of ops) {
      if (o.after_cutting && lots.length === 0) {
        /* 재단. 형명별로 갈린다 */
        for (let k = 0; k < (n % 3) + 1; k++) {
          const fin = fins[k % fins.length];
          lots.push(await as(mgr, () => val(
            `select cut_product_lot($1,$2,$3,$4,
               ((timezone('Asia/Seoul', now()))::date - ${back - 2})::date) as id`,
            [wo, fin.id, 40 + k * 10, 3])));
        }
      }
      const day = o.seq <= 6 ? 1 : o.seq <= 8 ? 2 : 3;
      const who = o.seq % 2 === 0 ? w1 : w2;
      const back2 = back - (day - 1);
      const at = (m) => `timezone('Asia/Seoul', ((timezone('Asia/Seoul', now()))::date - ${back2})`
        + ` + (${m} || ' minutes')::interval)`;
      min += 20;
      for (const plId of o.after_cutting ? lots : [null]) {
        const pr = await as(who, () => val(
          `insert into process_record (work_order_id, product_lot_id, operation_id, attempt,
             day_no, work_date, worker_id, started_at, ended_at)
           values ($1,$2,$3,1,$4,(timezone('Asia/Seoul', now()))::date - ${back2},$5,
                   ${at(min)}, ${at(min + 15)}) returning id`,
          [wo, plId, o.id, day, who]));
        for (const itemId of o.bom) {
          if (!stock[itemId]) continue;
          await as(who, () => c.query(
            `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
             values ($1,$2,1,$3)`, [pr, stock[itemId], who]));
        }
      }
    }

    /* 일차별 마감. 인쇄 대장과 잠금이 함께 쌓인다 (S04) */
    for (const day of [1, 2, 3]) {
      for (const who of [w1, w2]) {
        const rows = await all(
          `select pr.id from process_record pr
            where pr.work_order_id = $1 and pr.day_no = $2 and pr.worker_id = $3`,
          [wo, day, who]);
        if (rows.length === 0) continue;
        const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
        await as(who, async () => {
          await c.query(
            `insert into record_print (kind, work_order_id, day_no, worker_id, seq,
                                       data_hash, printed_by)
             values ('DAY_RECORD',$1,$2,$3,1,$4,$5)`, [wo, day, who, hash, who]);
          await c.query(
            `insert into day_lock (work_order_id, day_no, worker_id, locked_by)
             values ($1,$2,$3,$4) on conflict do nothing`, [wo, day, who, who]);
        });
      }
    }

    /* 출하 승인과 출고 */
    for (const plId of lots) {
      await as(mgr, () => c.query(
        `update product_lot set status = 'RELEASE_APPROVED', release_approved_by = '정품질',
                release_approved_on = (timezone('Asia/Seoul', now()))::date - ${back - 3}
          where id = $1`, [plId]));
    }
    const head = await one(
      `select id, qty_sample, qty_available, lot_no from product_lot where id = $1`, [lots[0]]);
    const bn = await val(`select batch_no from work_order where id = $1`, [wo]);
    await as(mgr, () => c.query(
      `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by,
                             release_request_no, unit_from, unit_to)
       values ($1,'시험 거래처',10,(timezone('Asia/Seoul', now()))::date - ${back - 4},$2,$3,$4,$5)`,
      [head.id, mgr, 'RR-' + bn + '-01', head.qty_sample + 1, head.qty_sample + 10]));
  }

  /* --- 3) 서버 ------------------------------------------------------------ */
  const grow = async (from, to) => {
    const t = Date.now();
    for (let n = from; n < to; n++) await makeBatch(n);
    return ((Date.now() - t) / 1000).toFixed(0);
  };
  console.log(`  배치 ${SMALL}건을 쌓는 데 ${await grow(0, SMALL)}초`);

  srv = spawn(process.execPath,
    [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', PORT],
    { env, cwd: ROOT, stdio: 'ignore' });
  const base = `http://localhost:${PORT}`;
  let up = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if ((await fetch(`${base}/login`)).status === 200) { up = true; break; } } catch { /* 아직 */ }
  }
  if (!up) throw new Error(`서버가 ${PORT} 에 뜨지 않았습니다`);

  const { sessionCookie } = await import('./session-cookie.mjs');
  const cookie = sessionCookie(mgr);

  /*
   * 인쇄 화면은 재지 않는다. 여는 것이 곧 대장에 남는 일이라 (§7 · §10)
   * 시간을 재려고 여러 번 열면 나가지 않은 종이가 쌓인다.
   */
  const SCREENS = [
    ['현황',        '/'],
    ['작업 지시',   '/production'],
    ['자재 로트',   '/material'],
    ['재고',        '/material/stock'],
    ['재고 증감',   '/material/movement'],
    ['출하 승인',   '/shipping'],
    ['출고',        '/shipping/ship'],
    ['계보 추적',   '/trace'],
    ['경영 현황',   '/board'],
    ['원가',        '/board/cost'],
    ['감사추적',    '/settings/audit'],
    ['현장',        '/work'],
  ];

  /** 세 번 재서 가운데 값을 쓴다. 첫 판은 예열이라 버린다. */
  async function time(p) {
    await fetch(base + p, { headers: { cookie } }).then((r) => r.text());
    const ms = [];
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      const r = await fetch(base + p, { headers: { cookie } });
      const html = await r.text();
      ms.push(Date.now() - t);
      if (r.status !== 200 || !/<h1[^>]*>/.test(html)) return { ms: -1, status: r.status };
    }
    return { ms: ms.sort((a, b) => a - b)[1], status: 200 };
  }

  const counts = async () => (await one(
    `select (select count(*) from work_order) wo,
            (select count(*) from process_record) pr,
            (select count(*) from material_issue) mi,
            (select count(*) from product_lot) pl,
            (select count(*) from audit_log) al`));

  const before = {};
  const c1 = await counts();
  for (const [name, p] of SCREENS) before[name] = await time(p);
  console.log(`\n  적을 때  배치 ${c1.wo} · 공정 기록 ${c1.pr} · 자재 투입 ${c1.mi}`
    + ` · 제품 로트 ${c1.pl} · 감사추적 ${c1.al}`);

  console.log(`\n  배치 ${BATCHES - SMALL}건을 더 쌓는 데 ${await grow(SMALL, BATCHES)}초`);
  const c2 = await counts();
  console.log(`  쌓은 뒤  배치 ${c2.wo} · 공정 기록 ${c2.pr} · 자재 투입 ${c2.mi}`
    + ` · 제품 로트 ${c2.pl} · 감사추적 ${c2.al}`);

  const rowGrowth = Number(c2.pr) / Math.max(1, Number(c1.pr));
  console.log(`\n  자료가 ${rowGrowth.toFixed(0)}배로 늘었습니다\n`);
  /*
   * 적을 때의 값은 고정 비용이 대부분이다 - 화면을 짓고 세션을 읽고 연결을
   * 얻는 데 드는 시간이 줄 수보다 크다. 그래서 배수는 실제 기울기보다 작게
   * 나온다. 배수를 상한으로 읽지 말고, 어느 화면이 가장 가파른가로 읽을 것.
   */
  console.log(`  ${'화면'.padEnd(12)}${'적을 때'.padStart(9)}${'쌓은 뒤'.padStart(9)}`
    + `${'배수'.padStart(8)}`);
  console.log('  ' + '-'.repeat(40));

  bad = 0;
  const slow = [];
  for (const [name, p] of SCREENS) {
    const a = before[name];
    const b = await time(p);
    if (a.ms < 0 || b.ms < 0) {
      console.log(`  ${name.padEnd(12)}${'못 그림'.padStart(9)}`);
      bad = 1;
      continue;
    }
    const g = b.ms / Math.max(1, a.ms);
    const over = b.ms > CEILING_MS;
    if (over) { bad = 1; slow.push([name, b.ms]); }
    console.log(`  ${name.padEnd(12)}${(a.ms + 'ms').padStart(9)}${(b.ms + 'ms').padStart(9)}`
      + `${(g.toFixed(1) + '배').padStart(8)}`
      + (over ? '   느림' : g > GROWTH_WARN ? '   줄마다 훑는 낌새' : ''));
  }

  if (slow.length) {
    console.log(`\n  ${CEILING_MS}ms 를 넘은 화면`);
    for (const [n, ms] of slow) console.log(`    ${n}  ${ms}ms`);
  }
} finally {
  if (srv) srv.kill();
  await new Promise((r) => setTimeout(r, 1500));
  await c.end().catch(() => {});
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`, [DB]);
  await admin.query(`drop database if exists ${DB}`);
  await admin.end();
  console.log(`\n  ${DB} 를 지웠습니다`);
}

console.log(bad === 0
  ? `\n배치 ${BATCHES}건에서도 전 화면이 ${CEILING_MS}ms 안에 섭니다.`
    + '\n이 노트북의 값입니다. 운영 서버의 약속으로 읽지 마십시오.\n'
  : '\n위에서 느린 자리를 보십시오.\n');
process.exit(bad === 0 ? 0 : 1);
