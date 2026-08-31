/* ---------------------------------------------------------------------------
   백업 (적대적 감사 2026-08-28 지적 9)

     node --env-file=.env.deploy scripts/backup.mjs          운영
     node scripts/backup.mjs --local                          로컬
     node scripts/backup.mjs --out D:/백업                    받을 자리 지정

   ── 왜 pg_dump 가 아닌가 ──────────────────────────────────────────────────
   이 컴퓨터에 pg_dump 가 없다. embedded-postgres 가 딸려 오지만 initdb ·
   pg_ctl · postgres 셋뿐이고, 있다 해도 18 판이라 운영(17.6)과 어긋난다.
   백업 도구를 쓰려고 도구를 설치해야 하면 그 백업은 언젠가 안 돌게 된다.

   그래서 node 와 pg 드라이버만으로 뜬다. 이미 있는 것으로만 돌아가므로
   설치가 필요 없고, 어느 컴퓨터에서든 같은 명령으로 뜬다.

   ── 어떻게 뜨는가 ─────────────────────────────────────────────────────────
   표마다 to_jsonb(t)::text 로 한 줄에 한 행씩 받는다. text 로 받는 것이
   중요하다. JSON 을 자바스크립트가 해석하면 numeric 이 배정도 실수로 바뀌어
   자릿수가 조용히 깎인다. 여기서는 문자열을 받아 문자열로 적고, 되돌릴 때도
   문자열 그대로 jsonb 에 넘긴다. 우리 쪽에서 해석하는 일이 없다.

   ── 무엇을 함께 적는가 ────────────────────────────────────────────────────
   표마다 행 수와 내용 해시를 적는다. 해시가 있어야 "되살렸다"가 아니라
   "같은 것을 되살렸다"를 말할 수 있다. scripts/restore-check.mjs 가 이 값과
   대조한다.

   이 파일은 자료를 읽기만 한다. 어느 DB 도 고치지 않는다.
--------------------------------------------------------------------------- */
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, existsSync, statSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const LOCAL = argv.includes('--local');
const url = LOCAL
  ? (process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54330/dhr')
  : (process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL);

if (!url) {
  console.error('DATABASE_URL 이 없습니다. --env-file 로 .env.deploy 를 주십시오.');
  process.exit(2);
}

const outDir = arg('--out') ?? path.join(ROOT, 'backups');
mkdirSync(outDir, { recursive: true });

const c = new pg.Client({ connectionString: url, ssl: pgSsl(url, ROOT) });
await c.connect();

const info = (await c.query(
  `select version() v, current_database() d,
          to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD"T"HH24:MI:SS') t,
          to_char(timezone('Asia/Seoul', now()), 'YYYYMMDD-HH24MISS') stamp`)).rows[0];

console.log(`대상 : ${url.replace(/\/\/[^@]*@/, '//***@')}`);
console.log(`엔진 : ${info.v.split(' on ')[0]}`);
console.log(`시각 : ${info.t} (Asia/Seoul)\n`);

/*
 * 한 시점의 자료를 뜬다.
 *
 * 표를 하나씩 따로 읽으면 읽는 사이에 다른 표가 바뀔 수 있다. 그러면 계보가
 * 어긋난 백업이 나온다 - 공정 기록은 있는데 그 배치가 없는 식이다.
 * 되돌릴 수 없는 자료를 다루므로 한 트랜잭션 안에서 전부 읽는다.
 */
await c.query('begin isolation level repeatable read read only');

/*
 * 시각을 UTC 로 찍는다.
 *
 * to_jsonb 는 timestamptz 를 세션 시각대로 옮겨 적는다. 그러면 같은 순간이
 * 운영에서는 +00, 로컬에서는 +09 로 찍혀 글자가 달라지고, 내용 해시가
 * 어긋난다. 실제로 첫 운영 훈련에서 표 16개가 이것 때문에 불일치로 나왔다 -
 * 자료는 멀쩡한데 보는 자리가 달랐을 뿐이었다.
 *
 * 해시는 순간을 가리켜야지 보는 자리를 가리키면 안 된다.
 */
await c.query(`set local time zone 'UTC'`);

const tables = (await c.query(
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows.map((r) => r.relname);

const manifest = {
  version: 1,
  taken_at: info.t,
  database: info.d,
  engine: info.v.split(' on ')[0],
  migrations: readdirSync(path.join(ROOT, 'db', 'migrations'))
    .filter((f) => f.endsWith('.sql')).sort(),
  tables: {},
  sequences: {},
};

/* 되살린 뒤 다음 번호가 이어지도록 시퀀스 현재값도 적는다 */
for (const s of (await c.query(
  `select c.relname tbl, a.attname col,
          pg_get_serial_sequence('public.' || c.relname, a.attname) seq
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and pg_get_serial_sequence('public.' || c.relname, a.attname) is not null`)).rows) {
  manifest.sequences[`${s.tbl}.${s.col}`] = {
    seq: s.seq,
    last: (await c.query(`select last_value from ${s.seq}`)).rows[0].last_value,
  };
}

const stamp = info.stamp;
const dataPath = path.join(outDir, `dhr-${stamp}.ndjson.gz`);

/* 표마다 한 줄에 한 행. 앞에 어느 표인지 적는 머리줄을 둔다 */
async function* lines() {
  for (const t of tables) {
    /*
       * 줄 순서를 못 박는다.
       *
       * order by 없이 읽으면 물리적 순서로 나온다. 그 순서는 보장되지 않는다 -
       * 원본은 오래 쓰면서 갱신과 청소로 자리가 바뀌고, 복구본은 파일에서 차례로
       * 넣은 그대로다. 그래서 같은 자료인데 해시가 달라진다.
       *
       * 실제로 그랬다. 복구 훈련이 audit_log 443행을 두고 "어긋났다" 고 했는데,
       * 정렬해 대 보니 다른 줄이 0개였다 (2026-09-01). 헛경보를 내는 훈련은 곧
       * 무시당하고, 그러면 진짜 실패를 놓친다.
       *
       * 기본키로 정렬하지 않는다. 표마다 키가 달라 여기서 알 수 없다. 줄 자체를
       * 정렬하면 어느 표든 한 가지로 정해진다.
       */
    const rows = (await c.query(
      `select to_jsonb(x)::text as j from public.${t} x order by j`)).rows;
    const h = createHash('sha256');
    for (const r of rows) h.update(r.j).update('\n');

    manifest.tables[t] = { rows: rows.length, sha256: h.digest('hex') };
    console.log(`  ${t.padEnd(24)} ${String(rows.length).padStart(6)}행`);

    yield `#table ${t} ${rows.length}\n`;
    for (const r of rows) yield `${r.j}\n`;
  }
}

await pipeline(Readable.from(lines()), createGzip({ level: 9 }), createWriteStream(dataPath));
await c.query('commit');
await c.end();

/*
 * 목록은 자료를 다 뜬 뒤에 적는다. 위 반복문이 해시를 채우기 때문이다.
 * 목록이 없으면 그 백업은 대조할 수 없으므로 반쪽짜리다.
 */
manifest.total_rows = Object.values(manifest.tables).reduce((a, x) => a + x.rows, 0);
manifest.data_file = path.basename(dataPath);
manifest.data_sha256 = await fileHash(dataPath);

const manPath = path.join(outDir, `dhr-${stamp}.manifest.json`);
const { writeFileSync } = await import('node:fs');
writeFileSync(manPath, JSON.stringify(manifest, null, 2), 'utf8');

const mb = (statSync(dataPath).size / 1024 / 1024).toFixed(2);
console.log(`\n  자료  ${dataPath}  (${mb} MB · ${manifest.total_rows}행)`);
console.log(`  목록  ${manPath}`);
console.log('\n되살릴 수 있는지 지금 확인하십시오:');
console.log(`  node scripts/restore-check.mjs ${path.basename(dataPath)}`);

async function fileHash(p) {
  const { createReadStream } = await import('node:fs');
  const h = createHash('sha256');
  await pipeline(createReadStream(p), h);
  return h.digest('hex');
}
