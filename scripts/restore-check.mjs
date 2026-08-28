/* ---------------------------------------------------------------------------
   복구 훈련 (적대적 감사 2026-08-28 지적 9)

     node scripts/restore-check.mjs                     가장 최근 백업으로
     node scripts/restore-check.mjs dhr-20260828-...gz  백업 지정

   해 보지 않은 절차는 절차가 아니다. 이 파일이 그 "해 보는 것"이다.

   백업을 빈 DB 에 실제로 되살리고, 되살린 것이 원본과 같은지 대조하고,
   걸린 시간을 잰다. 그 시간이 실제 RTO 다.

   ── 어디에 되살리는가 ─────────────────────────────────────────────────────
   로컬 embedded-postgres 안에 dhr_restore 라는 별도 DB 를 만들어 쓴다.
   운영에도, 개발용 dhr 에도 손대지 않는다. 훈련이 자료를 망가뜨리면 훈련이
   아니라 사고다. 돌 때마다 지우고 새로 만든다.

   ── 왜 트리거를 끄고 넣는가 ───────────────────────────────────────────────
   되살리는 동안에는 session_replication_role 을 replica 로 둔다. 감사추적 ·
   S03 · S04 · 0052 불변 트리거가 전부 잠시 물러난다.

   이것이 §10 이 금지한 예외 경로인가: 아니다. 여기는 응용이 아니라 복구
   도구이고, 대상은 빈 DB 이며, DB 주인 권한으로 돈다. pg_restore 가 하는
   일과 같다. 트리거를 켜 둔 채로 넣으면 이미 일어난 일을 다시 일어나게
   하는 셈이라 - 감사추적이 두 벌이 되고, 잠긴 묶음은 아예 들어가지 못하고,
   작업일 검사가 과거 기록을 거부한다. 되살린 것이 원본과 달라진다.

   대신 넣은 뒤에 다시 켜고, 원본과 같은지 해시로 대조한다.
--------------------------------------------------------------------------- */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUPS = path.join(ROOT, 'backups');
const ADMIN_URL = process.env.RESTORE_ADMIN_URL
  ?? 'postgres://postgres:postgres@localhost:54330/postgres';
const TARGET_DB = 'dhr_restore';

/* --- 백업 고르기 -------------------------------------------------------- */
let name = process.argv[2];
if (!name) {
  const found = existsSync(BACKUPS)
    ? readdirSync(BACKUPS).filter((f) => f.endsWith('.ndjson.gz')).sort().pop()
    : undefined;
  if (!found) {
    console.error('backups/ 에 백업이 없습니다. 먼저 scripts/backup.mjs 를 돌리십시오.');
    process.exit(2);
  }
  name = found;
}
const dataPath = path.join(BACKUPS, path.basename(name));
const manPath = dataPath.replace(/\.ndjson\.gz$/, '.manifest.json');
if (!existsSync(dataPath) || !existsSync(manPath)) {
  console.error(`백업이나 목록을 찾지 못했습니다: ${dataPath}`);
  process.exit(2);
}

const man = JSON.parse(readFileSync(manPath, 'utf8'));
const RULE = '='.repeat(78);

console.log(RULE);
console.log(' DOF DHR 복구 훈련');
console.log(`  백업    ${path.basename(dataPath)}`);
console.log(`  뜬 시각 ${man.taken_at}  ·  ${man.total_rows}행  ·  표 ${Object.keys(man.tables).length}개`);
console.log(`  되살릴 곳 ${TARGET_DB} (로컬 · 매번 새로 만든다)`);
console.log(RULE);

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}초`;
const step = (s) => console.log(`\n[${el()}] ${s}`);

/* --- 1. 빈 DB 세우기 ---------------------------------------------------- */
step('빈 DB 를 세운다');
const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(
  `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`, [TARGET_DB]);
await admin.query(`drop database if exists ${TARGET_DB}`);
await admin.query(`create database ${TARGET_DB}`);
await admin.end();

const url = ADMIN_URL.replace(/\/[^/]*$/, `/${TARGET_DB}`);
const c = new pg.Client({ connectionString: url });
await c.connect();

/* --- 2. 스키마 --------------------------------------------------------- */
step(`스키마를 올린다 (이관 ${man.migrations.length}개)`);
const mdir = path.join(ROOT, 'db', 'migrations');
const here = readdirSync(mdir).filter((f) => f.endsWith('.sql')).sort();

/*
 * 백업을 뜬 시점의 이관 목록과 지금 목록을 견준다.
 * 달라도 멈추지 않는다 - 백업이 오래됐으면 다른 것이 정상이다. 다만 무엇이
 * 다른지는 눈에 보여야 한다.
 */
const added = here.filter((f) => !man.migrations.includes(f));
const gone = man.migrations.filter((f) => !here.includes(f));
if (added.length) console.log(`  백업 이후 늘어난 이관 : ${added.join(', ')}`);
if (gone.length)  console.log(`  백업에는 있으나 지금 없는 이관 : ${gone.join(', ')}`);

for (const f of here) {
  try {
    await c.query(readFileSync(path.join(mdir, f), 'utf8'));
  } catch (e) {
    console.error(`  이관 실패 ${f}\n    ${e.message}`);
    await c.end();
    process.exit(1);
  }
}
console.log('  올렸다');

/* --- 3. 자료 --------------------------------------------------------- */
step('자료를 넣는다 (트리거는 잠시 물러난다)');
await c.query(`set session_replication_role = 'replica'`);

let table = null;
let batch = [];
const loaded = {};

async function flush() {
  if (!table || batch.length === 0) return;
  /*
   * 문자열 그대로 jsonb 에 넘긴다. 자바스크립트가 해석하지 않으므로
   * numeric 자릿수가 깎이지 않는다 (backup.mjs 와 같은 이유).
   */
  await c.query(
    `insert into public.${table}
     select (jsonb_populate_record(null::public.${table}, j))::public.${table}.*
       from unnest($1::text[]) t(s), lateral (select s::jsonb) v(j)`,
    [batch]).catch(async (e) => {
      /* 일부 판에서 위 형태가 안 먹으면 한 줄씩 넣는다 */
      if (e.code !== '42601' && e.code !== '42P01' && e.code !== '42804') throw e;
      for (const s of batch) {
        await c.query(
          `insert into public.${table}
           select * from jsonb_populate_record(null::public.${table}, $1::jsonb)`, [s]);
      }
    });
  loaded[table] = (loaded[table] ?? 0) + batch.length;
  batch = [];
}

const rl = createInterface({
  input: createReadStream(dataPath).pipe(createGunzip()),
  crlfDelay: Infinity,
});

const hashes = {};
for await (const line of rl) {
  if (line.startsWith('#table ')) {
    await flush();
    table = line.split(' ')[1];
    loaded[table] = 0;
    hashes[table] = createHash('sha256');
    continue;
  }
  if (!line) continue;
  hashes[table].update(line).update('\n');
  batch.push(line);
  if (batch.length >= 500) await flush();
}
await flush();

/* 다음 번호가 이어지도록 시퀀스를 맞춘다. 빠뜨리면 키가 충돌한다 */
for (const [col, s] of Object.entries(man.sequences ?? {})) {
  await c.query(`select setval($1, $2, true)`, [s.seq, s.last]);
}

await c.query(`set session_replication_role = 'origin'`);
const restoreSec = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`  ${Object.values(loaded).reduce((a, b) => a + b, 0)}행`);

/* --- 4. 대조 --------------------------------------------------------- */
step('되살린 것이 원본과 같은지 대조한다');

/* 백업이 UTC 로 찍었으므로 여기서도 UTC 로 읽는다 (backup.mjs 참조) */
await c.query(`set time zone 'UTC'`);

const fail = [];
const ok = (cond, label, detail = '') => {
  console.log(`  ${cond ? '일치' : '불일치'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!cond) fail.push(label);
};

/* 4-1. 표마다 행 수와 내용 해시 */
let same = 0;
for (const [t, m] of Object.entries(man.tables)) {
  const n = Number((await c.query(`select count(*)::int n from public.${t}`)).rows[0].n);
  const h = createHash('sha256');
  for (const r of (await c.query(`select to_jsonb(x)::text j from public.${t} x`)).rows) {
    h.update(r.j).update('\n');
  }
  const hit = n === m.rows && h.digest('hex') === m.sha256;
  if (hit) same += 1;
  else fail.push(`${t} (원본 ${m.rows}행 · 복구 ${n}행)`);
}
ok(same === Object.keys(man.tables).length,
   `표 ${Object.keys(man.tables).length}개의 행 수와 내용 해시`,
   `일치 ${same}개`);

/* 4-2. 감사추적이 잘리지 않았는가 */
const al = (await c.query(
  `select count(*)::int n, coalesce(max(id),0) mx from audit_log`)).rows[0];
ok(Number(al.n) === man.tables.audit_log.rows,
   '감사추적 건수', `${al.n}건 · 최대 id ${al.mx}`);

/* 4-3. 계보가 실제로 이어지는가. 해시가 같아도 참조가 깨져 있을 수 있다 */
const gen = (await c.query(
  `select pl.lot_no, wo.batch_no, ml.lot_no raw
     from product_lot pl
     join work_order wo on wo.id = pl.work_order_id
     join material_lot ml on ml.id = wo.material_lot_id
    order by pl.lot_no limit 1`)).rows[0];
ok(!!gen, '제품 로트에서 원재료 로트까지 역추적',
   gen ? `${gen.lot_no} → ${gen.batch_no} → ${gen.raw}` : '');

/* 4-4. 인쇄물 자료 식별자가 그대로인가. 종이와 시스템을 잇는 고리다 */
const rp = (await c.query(
  `select count(*)::int n, count(distinct data_hash)::int d from record_print`)).rows[0];
ok(Number(rp.n) === man.tables.record_print.rows,
   '인쇄 이력과 자료 식별자', `${rp.n}건 · 식별자 ${rp.d}종`);

/* 4-5. 시퀀스가 이어지는가. 여기가 어긋나면 다음 채번이 충돌한다 */
let seqOk = true;
for (const [col, s] of Object.entries(man.sequences ?? {})) {
  const v = (await c.query(`select last_value from ${s.seq}`)).rows[0].last_value;
  if (String(v) !== String(s.last)) { seqOk = false; fail.push(`시퀀스 ${col}`); }
}
ok(seqOk, '시퀀스 현재값', Object.keys(man.sequences ?? {}).join(' · '));

/* 4-6. 규칙이 되살아나 있는가. 트리거를 껐다 켰으니 확인해야 한다 */
let guarded = false;
try {
  await c.query(`delete from item where false`);
  await c.query(`delete from item`);
} catch (e) {
  guarded = String(e.message).includes('S03');
}
ok(guarded, 'S03 삭제 차단이 되살아났는가');

/* 4-7. 시연 자료 표시. 있으면 삭제 문이 열린 상태다 */
const demo = (await c.query(`select count(*)::int n from demo_marker`)).rows[0].n;
if (Number(demo) > 0) {
  console.log('  주의  시연 자료 표시가 들어 있습니다. 이 복구본에서는 비우기 문이 열려 있습니다');
}

await c.end();

/* --- 결과 ------------------------------------------------------------- */
const total = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${RULE}`);
if (fail.length === 0) {
  console.log(` 복구 확인 완료 · 되살린 자료가 백업과 같습니다`);
} else {
  console.log(` 어긋난 항목 ${fail.length}건`);
  for (const f of fail) console.log(`   · ${f}`);
}
console.log(` 되살리는 데 ${restoreSec}초 · 대조까지 ${total}초`);
console.log(` 이 시간이 실제 RTO 입니다. 사내문서/백업과 복구.md 에 적으십시오.`);
console.log(RULE);
process.exit(fail.length ? 1 : 0);
