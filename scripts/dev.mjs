// =============================================================================
// dev.mjs - 로컬 개발 실행
//
//   npm run dev
//
// PostgreSQL 18을 띄우고(없으면 초기화·마이그레이션·시드), 이어서 next dev를
// 붙인다. Ctrl+C 하면 둘 다 내려간다.
//
// 데이터는 .pgdata-dev에 남는다. 지우려면 npm run dev:reset.
// =============================================================================

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { hashPin } from './pin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, '.pgdata-dev');
const PORT = Number(process.env.PGPORT ?? 54330);
const URL_ = `postgres://postgres:postgres@localhost:${PORT}/dhr`;

// 사내 사번이 6자리다. 첫 계정은 개발 계정으로 만든다 - 비밀번호 초기화가
// 개발 계정만 할 수 있는 일이라, 첫 계정이 개발 계정이 아니면 아무도 못 한다.
const SEED_LOGIN = '000000';
const SEED_PIN = '000000';

const fresh = !existsSync(DIR);

const server = new EmbeddedPostgres({
  databaseDir: DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
  // Windows 사용자명이 한글이면 UTF8 클러스터의 post-bootstrap이 죽는다.
  // 클러스터는 SQL_ASCII로 만들고 시험/개발 DB만 template0에서 UTF8로 뽑는다.
  initdbFlags: ['--encoding=SQL_ASCII', '--no-locale', '--lc-messages=C'],
  onLog: () => {},
  onError: () => {},
});

if (fresh) {
  console.log('PostgreSQL 초기화 …');
  await server.initialise();
}
await server.start();
console.log(`PostgreSQL 기동 · 포트 ${PORT}`);

const admin = new pg.Client({
  connectionString: `postgres://postgres:postgres@localhost:${PORT}/postgres`,
});
await admin.connect();
const exists = await admin.query(`select 1 from pg_database where datname = 'dhr'`);
if (exists.rowCount === 0) {
  await admin.query(`create database dhr encoding 'UTF8' template template0 locale 'C'`);
}
await admin.end();

// --- 마이그레이션 (idempotent) -----------------------------------------------
const db = new pg.Client({ connectionString: URL_ });
await db.connect();
const mdir = path.join(ROOT, 'db', 'migrations');
for (const f of readdirSync(mdir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.query(readFileSync(path.join(mdir, f), 'utf8'));
}
console.log('마이그레이션 적용 완료');

// --- 최초 관리자 -------------------------------------------------------------
const anyUser = await db.query(`select 1 from app_user limit 1`);
if (anyUser.rowCount === 0) {
  const id = (
    await db.query(
      `insert into app_user (login_code, full_name, pin_hash, is_developer)
       values ($1,$2,$3,true) returning id`,
      [SEED_LOGIN, '개발 계정', await hashPin(SEED_PIN)],
    )
  ).rows[0].id;
  await db.query(`insert into user_role (user_id, role) values ($1,'SYS_ADMIN')`, [id]);
  console.log(`개발 계정 생성 · 로그인 ${SEED_LOGIN} / 비밀번호 ${SEED_PIN}`);
  console.log('   (로컬 개발용이다. 운영에 이 값을 쓰지 말 것)');
}
await db.end();

// --- .env.local --------------------------------------------------------------
const envPath = path.join(ROOT, '.env.local');
let secret = '';
if (existsSync(envPath)) {
  secret = (readFileSync(envPath, 'utf8').match(/^SESSION_SECRET=(.+)$/m) ?? [])[1] ?? '';
}
if (!secret) secret = randomBytes(32).toString('hex');
writeFileSync(
  envPath,
  `# scripts/dev.mjs가 생성한다. 커밋 금지.\nDATABASE_URL=${URL_}\nSESSION_SECRET=${secret}\n`,
  'utf8',
);

// --- next dev ----------------------------------------------------------------
mkdirSync(path.join(ROOT, '.next'), { recursive: true });
const next = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--port', '3100'],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, DATABASE_URL: URL_, SESSION_SECRET: secret } },
);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  next.kill();
  await server.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
next.on('close', shutdown);
