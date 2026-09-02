/* ---------------------------------------------------------------------------
   DB 초기화 (임시 도구 · 실운영 착수 전까지만)

     node scripts/reset-db.mjs                        로컬 · 계획만 보여 준다
     node scripts/reset-db.mjs --erase --demo         로컬 비우고 시연 자료
     node scripts/reset-db.mjs --prod --erase         운영 비우고 빈 상태로
     node scripts/reset-db.mjs --prod --erase --base  운영 비우고 기준정보만 (배치 없음)
     node scripts/reset-db.mjs --prod --erase --demo  운영 비우고 시연 자료

   --erase 대신 환경변수 RESET_DB=ERASE 도 같은 뜻이다. 플래그를 둔 이유는
   PowerShell 에서 VAR=값 접두 문법이 없기 때문이다.

   2026-08-27 대표 시연을 위해 운영 DB에 시연 자료를 넣기로 하면서, 실운영을
   시작할 때 그 자료를 일괄 정리할 길이 함께 필요해졌다 (사용자 지시).

   ── 왜 "선택 삭제"가 아니라 전체 초기화인가 ────────────────────────────────
   이 시스템에는 삭제가 없다 (S03 · §10 "DELETE FROM - 어떤 표에도"). 시연
   배치만 골라 지우는 기능을 만들면 그게 곧 기록 삭제 경로가 되고, 계보가
   서로 얽혀 있어 반쪽만 지운 DB는 어차피 검증할 수 없다. 정직한 방법은
   스키마를 통째로 비우고 마이그레이션부터 다시 세우는 것 하나다.

   ── 왜 앱이 아니라 여기인가 ────────────────────────────────────────────────
   앱과 app_role 에는 삭제 권한 자체가 없고, 그 사실이 검증 대상이다. 이 도구는
   DB 소유자 접속 정보(.env.deploy)를 가진 운영자만, 이 장비에서만 쓸 수 있다.

   ── 실운영 착수 시 ─────────────────────────────────────────────────────────
   1) node scripts/reset-db.mjs --prod --erase   로 시연 자료를 비운다
   2) 화면에서 실제 계정·기준정보를 등록한다
   3) **이 파일을 저장소에서 지운다.** 실기록이 생긴 뒤에는 존재하면 안 되는
      도구다. docs/BACKLOG.md 에 같은 내용이 적혀 있다
--------------------------------------------------------------------------- */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROD = process.argv.includes('--prod');
const DEMO = process.argv.includes('--demo');
const BASE = process.argv.includes('--base');
const ERASE = process.env.RESET_DB === 'ERASE' || process.argv.includes('--erase');

// 대상 결정. 운영은 .env.deploy 의 소유자 접속(5432)만 쓴다
for (const f of PROD ? ['.env.deploy'] : ['.env.local']) {
  const p = path.join(ROOT, f);
  if (!existsSync(p)) { console.error(`${f} 가 없습니다`); process.exit(2); }
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const url = PROD
  ? process.env.MIGRATION_DATABASE_URL
  : process.env.DATABASE_URL;
if (!url) { console.error('접속 주소가 없습니다'); process.exit(2); }
if (!PROD && !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('로컬 모드인데 주소가 로컬이 아닙니다. 운영은 --prod 를 명시할 것.');
  process.exit(2);
}

const mask = url.replace(/\/\/[^@]*@/, '//***@');
const client = new pg.Client({ connectionString: url, ssl: pgSsl(url, ROOT) });
await client.connect();

/*
 * 무엇이 지워지는지 먼저 보여 준다.
 *
 * 표가 아직 없을 수도 있다 (완전히 빈 DB). 그때는 셀 것이 없다고 말하고
 * 넘어간다 - 전에는 여기서 relation does not exist 로 죽어, 새 DB 에 처음
 * 세우는 길이 막혀 있었다.
 */
let counts = null;
try {
  counts = (await client.query(`
    select (select count(*) from app_user)      as 계정,
           (select count(*) from work_order)    as 배치,
           (select count(*) from product_lot)   as 제품로트,
           (select count(*) from material_lot)  as 자재로트,
           (select count(*) from audit_log)     as 감사기록`)).rows[0];
} catch {
  /* 스키마가 아직 없다 */
}

console.log(`대상   : ${PROD ? '운영 (Supabase)' : '로컬'} · ${mask}`);
if (counts) console.table([counts]);
else console.log('        (표가 아직 없습니다. 빈 DB 에 처음 세웁니다)');

if (!ERASE) {
  console.log('계획만 보여 주었습니다. 실제로 비우려면 --erase 를 붙이십시오:');
  console.log(`  node scripts/reset-db.mjs${PROD ? ' --prod' : ''} --erase${DEMO ? ' --demo' : BASE ? ' --base' : ''}`);
  await client.end();
  process.exit(0);
}

console.log('\n스키마를 비웁니다');
await client.query(`drop schema if exists public cascade`);
await client.query(`create schema public`);
/*
 * 역할은 못 내려도 넘어간다.
 *
 * 역할은 DB 가 아니라 클러스터에 딸린다. 같은 서버에 다른 DB 가 있고 그쪽이
 * 이 역할에 권한을 걸고 있으면 drop 이 거부된다. 그러면 **스키마를 지운
 * 뒤에 죽어** 다시 세울 수 없는 상태가 남는다 (C1 과 같은 모양이다).
 *
 * 이관이 create role if not exists 로 다시 세우므로 내리지 못해도 결과는
 * 같다. 못 내렸다고 말하고 넘어간다.
 */
for (const role of ['app_role', 'app_readonly']) {
  try {
    await client.query(`drop role if exists ${role}`);
  } catch (e) {
    console.log(`  ${role} 은 내리지 못했습니다 (다른 DB 가 쓰고 있습니다). 그대로 씁니다.`);
  }
}
await client.end();

// 마이그레이션부터 다시. deploy-db 가 초기 관리자까지 만든다
const childEnv = { ...process.env, MIGRATION_DATABASE_URL: url, DATABASE_URL: url };
/* ---------------------------------------------------------------------------
   자식에게 대상 표시를 넘긴다 (4차 감사 C1)

   deploy-db 에 "운영을 치려면 --prod 를 붙여라" 는 문턱을 넣었는데(2026-09-01)
   부르는 쪽이 따라오지 않았다. 그래서 이 스크립트는 운영의 public 스키마와 두
   역할을 **지운 다음**, 재구축을 인자 없이 불러 그 자리에서 종료 코드 2 로
   죽었다.

   사내문서/실무 착수 절차.md ② 가 지시하는 명령이 바로 그것이다. 문서대로
   치면 운영 DB 에 표도 뷰도 역할도 없는 상태가 남고 앱은 전 화면이 죽는다.
   지워지는 것은 지우기로 한 시연 자료이므로 기록 소실은 아니지만, 그 자리에서
   다시 세울 수 없다.

   도구를 고칠 때 부르는 쪽을 함께 보지 않은 것이다. 같은 모양이 세 번 있었다
   (백업 GET→POST 와 복구 화면의 앵커, logPrint 와 smoke).
--------------------------------------------------------------------------- */
const CHILD_ARGS = PROD ? ['--prod'] : [];

const run = (label, args, extraEnv = {}) => {
  console.log(`\n== ${label}`);
  const r = spawnSync(process.execPath, args,
    { cwd: ROOT, stdio: 'inherit', env: { ...childEnv, ...extraEnv } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('마이그레이션', [path.join(ROOT, 'scripts', 'deploy-db.mjs'), ...CHILD_ARGS]);
if (DEMO || BASE) {
  /*
   * --base 는 기준정보만 넣는다 (4차 감사 C2). 지어낸 자재 로트와 성적서
   * 번호는 시연(--demo)에만 들어간다. 실무 착수 절차 ② 가 --base 를
   * 지시하므로 그 길로 운영에 가짜 성적서가 들어가면 안 된다.
   */
  run('기준정보', [path.join(ROOT, 'scripts', 'seed-demo.mjs')],
      { SEED_DEMO_FORCE: '1', ...(BASE && !DEMO ? { SEED_BASE_ONLY: '1' } : {}) });
}
if (DEMO) {
  run('시연 전 공정', [path.join(ROOT, 'scripts', 'seed-flow.mjs')]);
}

console.log(`\n완료. ${DEMO
  ? '시연 자료가 다시 들어갔습니다 (계정 000000 등 · 비밀번호는 seed-demo.mjs 참조).'
  : BASE
    ? '기준정보만 있는 깨끗한 상태입니다 (배치 0건). 계정은 000000 등 시연 계정입니다.'
    : '빈 상태입니다. 위에 한 번 찍힌 초기 관리자 비밀번호를 지금 적어 두십시오.'}`);
