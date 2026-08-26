/* ---------------------------------------------------------------------------
   시연 자료 재구성

     node --env-file=.env.local scripts/demo.mjs

   로컬 개발 DB를 비우고 마이그레이션부터 다시 올린 뒤 기준정보와 배치 하나를
   끝까지 밀어 넣는다. 화면을 손보는 동안 모든 화면에 실제 자료가 차 있어야
   빈 화면만 보고 다 됐다고 착각하지 않는다.

   localhost가 아니면 거부한다. 기록은 지워지지 않는 것이 원칙이므로 이 도구는
   개발 장비 밖으로 나가면 안 된다.
--------------------------------------------------------------------------- */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL ?? '';

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('로컬 DB가 아닙니다. 이 도구는 개발 장비에서만 씁니다.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

console.log('스키마 비우기');
await client.query(`drop schema if exists public cascade`);
await client.query(`create schema public`);
await client.query(`drop role if exists app_role`);
await client.end();

// 자식 프로세스에 로컬 주소를 못 박는다. deploy-db 는 .env.deploy 의
// MIGRATION_DATABASE_URL 을 우선하므로, 비워 두면 원격으로 가 버린다.
const childEnv = { ...process.env, MIGRATION_DATABASE_URL: url, DATABASE_URL: url };

const run = (label, args) => {
  console.log(`\n${label}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: childEnv });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('마이그레이션', [path.join(ROOT, 'scripts', 'deploy-db.mjs')]);
run('기준정보', [path.join(ROOT, 'scripts', 'seed-demo.mjs')]);
run('전 공정 진행', [path.join(ROOT, 'scripts', 'seed-flow.mjs')]);

console.log('\n시연 자료를 다시 만들었습니다.');
