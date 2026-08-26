// =============================================================================
// run.mjs — M0 적격성 시험 실행기
//
//   node test/run.mjs                     PGlite(메모리)에 마이그레이션을 올려 실행
//   DATABASE_URL=postgres://... node test/run.mjs   실제 서버에 대고 실행
//
// 출력이 그대로 OQ 각본이 되도록 규칙 번호와 기대 결과를 함께 찍는다 (§8.1).
// 실운영 DB를 가리키지 말 것. 시험 데이터가 그대로 남는다.
// =============================================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCtx, pad } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SECTIONS = {
  '01_users.mjs':     '[§4.1]  사용자 · 역할',
  '02_s03_audit.mjs': '[§5]    S03 삭제 금지 · 감사추적',
  '03_numbering.mjs': '[§4.10] 채번 규칙',
};

// ---------------------------------------------------------------------------
async function openDb() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return {
      target: url.replace(/\/\/[^@]*@/, '//***@'),
      exec:  (sql) => client.query(sql),
      query: (sql, params = []) => client.query(sql, params).then((r) => r.rows),
      close: () => client.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  return {
    target: 'PGlite (메모리)',
    exec:  (sql) => db.exec(sql),
    query: (sql, params = []) => db.query(sql, params).then((r) => r.rows),
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------------------
const out = [];
const say = (line = '') => { out.push(line); console.log(line); };

const RULE = '='.repeat(96);
const THIN = '-'.repeat(96);

async function main() {
  const db = await openDb();

  // --- 마이그레이션 ---------------------------------------------------------
  const mdir = path.join(ROOT, 'db', 'migrations');
  const files = readdirSync(mdir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try {
      await db.exec(readFileSync(path.join(mdir, f), 'utf8'));
    } catch (e) {
      console.error(`마이그레이션 실패: ${f}\n  ${e.message}`);
      await db.close();
      process.exit(2);
    }
  }

  const version = (await db.query('select version()'))[0].version;
  const now = (await db.query(
    `select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD HH24:MI:SS') as s`))[0].s;

  // --- 픽스처 ---------------------------------------------------------------
  const admin = (await db.query(
    `insert into app_user (login_code, full_name, pin_hash)
     values ('1001', '시험관리자', '$argon2id$test$') returning id`))[0].id;
  await db.query(`insert into user_role (user_id, role) values ($1,'SYS_ADMIN')`, [admin]);

  const ctx = makeCtx(db, { admin });

  // --- 실행 -----------------------------------------------------------------
  say(RULE);
  say(' DOF DHR 지원 시스템 — M0 적격성 시험 (OQ)');
  say(' 범위      : §4.1 사용자·권한 / §4.10 채번 / §5 S03 감사추적 / §8 시험 요건');
  say(` 실행 일시 : ${now} (Asia/Seoul)`);
  say(` 대상 DB   : ${db.target}`);
  say(` 엔진      : ${version.split(' on ')[0]}`);
  say(` 마이그레이션: ${files.join(', ')}`);
  say(RULE);

  let pass = 0;
  const failures = [];

  for (const file of Object.keys(SECTIONS)) {
    const cases = (await import(`./cases/${file}`)).default;
    say('');
    say(`${SECTIONS[file]}   (${cases.length}건)`);
    say(THIN);

    for (const c of cases) {
      let status = 'PASS', detail = '';
      try {
        await c.run(ctx);
        pass += 1;
      } catch (e) {
        status = 'FAIL';
        detail = e.message;
        failures.push({ id: c.id, name: c.name, detail });
      } finally {
        // 시험이 중간에 죽어도 다음 시험이 오염되지 않게 세션 상태를 되돌린다.
        try { await db.exec('reset role; reset timezone'); } catch { /* noop */ }
      }
      say(` ${pad(c.id, 8)}${pad(c.name, 62)}${pad('기대 ' + c.expect, 18)}${status}`);
      if (detail) say(`          └─ ${detail}`);
    }
  }

  const total = pass + failures.length;
  say('');
  say(RULE);
  say(` 합계 ${total}건 · 통과 ${pass} · 실패 ${failures.length}`);
  if (failures.length) {
    say('');
    for (const f of failures) say(` FAIL  ${f.id}  ${f.name}\n         ${f.detail}`);
  }
  say(RULE);
  say('');
  say(' 이 실행에 포함되지 않은 §8 항목');
  say('   · 동시 세션 2개에서 각 50회 채번  →  test/concurrency.mjs (실제 서버 필요)');
  say('   · S01 S02 S04 S05, 인쇄 충실성, 계보 정확성, 소요량 계산  →  M1 이후');
  say(RULE);

  // --- 보고서 저장 ----------------------------------------------------------
  const stamp = now.replace(/[-: ]/g, '').slice(0, 15);
  const dir = path.join(ROOT, 'reports');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `OQ-M0-${stamp}.txt`);
  writeFileSync(file, out.join('\n') + '\n', 'utf8');
  console.log(`\n보고서: ${path.relative(ROOT, file)}`);

  await db.close();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
