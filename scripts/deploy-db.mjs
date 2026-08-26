// =============================================================================
// deploy-db.mjs — 원격 DB(Supabase 등)에 M0 스키마를 올린다
//
//   node scripts/deploy-db.mjs
//
// .env.local 또는 환경변수의 DATABASE_URL을 쓴다. 마이그레이션 6종을 순서대로
// 적용하고, 계정이 하나도 없으면 초기 시스템관리자를 만든다.
//
// 마이그레이션은 전부 재실행 가능하다(create ... if not exists / or replace /
// drop trigger if exists). 여러 번 돌려도 안전하다.
//
// 초기 관리자 비밀번호는 인자로 받지 않는다. 무작위로 만들어 화면에 한 번만
// 찍고 저장하지 않는다. 로그인 후 즉시 바꿀 것.
// =============================================================================

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hashPin } from './pin.mjs';
import { pgSsl } from './pgssl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env.deploy 를 먼저 읽는다. 로컬 개발용 .env.local 은 scripts/dev.mjs 가
// 매번 덮어쓰므로 원격 접속 정보는 따로 둔다 —— 섞이면 로컬 개발 중에 운영
// DB를 가리키는 사고가 난다.
for (const f of ['.env.deploy', '.env.local']) {
  const envPath = path.join(ROOT, f);
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const URL_ = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!URL_) {
  console.error(
    'DATABASE_URL이 없다.\n' +
    '  .env.deploy 에 넣고 다시 실행할 것.\n' +
    '  Supabase 대시보드 → Connect → Session pooler(포트 5432) URI를 쓴다.',
  );
  process.exit(2);
}

const client = new pg.Client({ connectionString: URL_, ssl: pgSsl(URL_, ROOT) });

const mask = URL_.replace(/\/\/[^@]*@/, '//***@');
console.log(`대상 : ${mask}`);

await client.connect();

const info = await client.query(
  `select version() as v, current_user as u, current_database() as d,
          to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD HH24:MI:SS') as t`,
);
console.log(`엔진 : ${info.rows[0].v.split(' on ')[0]}`);
console.log(`접속 : ${info.rows[0].u} @ ${info.rows[0].d}`);
console.log(`시각 : ${info.rows[0].t} (Asia/Seoul)\n`);

// --- 마이그레이션 -------------------------------------------------------------
const mdir = path.join(ROOT, 'db', 'migrations');
for (const f of readdirSync(mdir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await client.query(readFileSync(path.join(mdir, f), 'utf8'));
    console.log(`  적용  ${f}`);
  } catch (e) {
    console.error(`  실패  ${f}\n        ${e.message}`);
    await client.end();
    process.exit(1);
  }
}

// --- 확인 ---------------------------------------------------------------------
const check = await client.query(`
  select
    (select count(*)::int from pg_tables where schemaname = 'public'
      and tablename in ('app_user','user_role','audit_log','numbering_rule','numbering_counter')) as tables,
    (select count(*)::int from pg_roles where rolname = 'app_role')                                as app_role,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('next_number','preview_number','render_number','trg_audit','has_role','current_user_id')) as funcs,
    (select count(*)::int from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon','authenticated','service_role'))         as api_grants,
    (select count(*)::int from app_user)                                                            as users
`);
const c = check.rows[0];
console.log(`\n  표 ${c.tables}/5 · app_role ${c.app_role ? '있음' : '없음'} · 함수 ${c.funcs}/6`);
console.log(`  API 역할(anon 등) 권한 ${c.api_grants}건 ${c.api_grants === 0 ? '— 노출 없음' : '⚠ 남아 있음'}`);

if (c.tables !== 5 || !c.app_role || c.funcs < 6) {
  console.error('\n스키마가 온전하지 않다. 위 오류를 확인할 것.');
  await client.end();
  process.exit(1);
}

// --- 초기 관리자 ---------------------------------------------------------------
if (c.users === 0) {
  const loginCode = process.env.SEED_LOGIN_CODE || '1001';
  const pin = String(randomInt(100000, 1000000));
  const id = (
    await client.query(
      `insert into app_user (login_code, full_name, pin_hash) values ($1,$2,$3) returning id`,
      [loginCode, process.env.SEED_FULL_NAME || '초기 관리자', await hashPin(pin)],
    )
  ).rows[0].id;
  await client.query(`insert into user_role (user_id, role) values ($1,'SYS_ADMIN')`, [id]);

  console.log('\n  ──────────────────────────────────────────');
  console.log(`   초기 시스템관리자  로그인 ${loginCode} / 비밀번호 ${pin}`);
  console.log('   이 값은 저장되지 않는다. 지금 적어 두고');
  console.log('   로그인 후 사용자 화면에서 즉시 변경할 것.');
  console.log('  ──────────────────────────────────────────');
} else {
  console.log(`  계정 ${c.users}건 — 초기 관리자 생성을 건너뛴다.`);
}

console.log('\n완료. 다음은 채번 규칙 등록이다 (현황 화면이 미등록 대상을 알려준다).');
await client.end();
