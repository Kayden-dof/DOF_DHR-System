// =============================================================================
// pg.mjs — 실제 PostgreSQL 서버를 띄워 전체 시험을 돌린다
//
//   npm run test:pg
//
// PGlite는 백엔드가 하나라 §8.1의 "동시 세션 2개" 시험이 성립하지 않는다.
// embedded-postgres가 공식 PostgreSQL 18 바이너리를 관리자 권한 없이 띄운다.
//
// [initdb 인코딩 주의]
//   이 장비의 Windows 사용자명이 한글이라 initdb의 post-bootstrap 단계가
//   CP949 바이트를 UTF8 클러스터에 밀어넣다가 죽는다
//   (FATAL: invalid byte sequence for encoding "UTF8": 0xb1).
//   클러스터는 SQL_ASCII로 만들고 시험 DB만 template0에서 UTF8로 뽑는다.
//   시험 대상 스키마가 도는 DB는 UTF8이므로 검증 값은 그대로 유효하다.
// =============================================================================

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR  = path.join(ROOT, '.pgdata');
const PORT = Number(process.env.PGPORT ?? 54329);
const URL_ = `postgres://postgres:postgres@localhost:${PORT}/dhr`;

rmSync(DIR, { recursive: true, force: true });

const server = new EmbeddedPostgres({
  databaseDir: DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: false,
  initdbFlags: ['--encoding=SQL_ASCII', '--no-locale', '--lc-messages=C'],
  onLog: () => {},
  onError: () => {},
});

function run(script) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'test', script)], {
      cwd: ROOT, stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: URL_ },
    });
    p.on('close', (code) => resolve(code ?? 1));
  });
}

console.log(`PostgreSQL 기동 (포트 ${PORT}) ...`);
await server.initialise();
await server.start();

const admin = new pg.Client({
  connectionString: `postgres://postgres:postgres@localhost:${PORT}/postgres`,
});
await admin.connect();
await admin.query(`create database dhr encoding 'UTF8' template template0 locale 'C'`);
const v = (await admin.query('select version()')).rows[0].version;
const mc = (await admin.query('show max_connections')).rows[0].max_connections;
await admin.end();
console.log(`${v.split(',')[0]} · max_connections=${mc}\n`);

let code = 0;
try {
  code |= await run('run.mjs');
  console.log('');
  code |= await run('concurrency.mjs');
} finally {
  console.log('\nPostgreSQL 정지 ...');
  await server.stop();
  rmSync(DIR, { recursive: true, force: true });
}
process.exit(code);
