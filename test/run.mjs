// =============================================================================
// run.mjs - 적격성 시험(OQ) 실행기
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
  '04_rules_m1_m4.mjs': '[§8.1] S01 S02 S04 S05 · 구조 · 소요량',
  '05_genealogy.mjs':   '[§8.3] 계보 정확성 · 재고',
  '06_review.mjs':      '[§8.5] 검토 지원',
  '07_immutable.mjs':   '[§1 §10] 적힌 사실 고쳐 쓰기 차단 (1차 감사)',
  '09_review2.mjs':     '[§4.9 §7] 인쇄 · 회차 · 반납 (2차 검수)',
  '10_review3.mjs':     '[§4.2 §7 §8.2] 규격 · 비밀 · 재고 · 근거 (3차 검수)',
  '11_deviation.mjs':   '[§9.1] 일탈 대장',
  '12_model_scheme.mjs': '[§4.2 §7] 형명 체계 · 규격 문구 (M5-4)',
  '13_cost.mjs':        '[§9 M4] 공수 · 설비 원가',
  '14_purchase.mjs':    '[§4.4] 발주와 입고 · 나눠 들어오기',
  '15_review_more.mjs': '[§8.5] 검토 표시가 넓어진 갈래',
  '16_solution.mjs':    '[§2 §4.4] 원액 로트 · S02 두 갈래',
  '17_force_correct.mjs': '[0128] 구성표 양의 범위 · 잠긴 기록의 강제 정정',
  '18_no_lot.mjs':      '[0129] 로트 없이 쓰는 소모품 · 개정본 복사',
  '19_br_form.mjs':     '[0130] 제조기록서 양식 모양',
  '20_br_entry.mjs':    '[0132] 현장에서 적는 제조기록서 칸',
  '21_rule_harden.mjs': '[0133~0135 · 0160 · 0166] 설비 여럿 · 출하 승인(출고는 막지 않음) · 멸균 보고서 생략 · 대조 해제 · 시행일 · 사용기간 · 표준서 밖',
  '22_timeline.mjs':    '[0137] 공정 시간표 · 배치 계획 · 판에 묶인 문서',
  '23_split_op.mjs':    '[0138] 형명이 갈리는 공정 · 이 판의 형명',
  '24_record_fix.mjs':  '[0139] 마감 전 기록의 일차 · 작업일 · 시각 고치기',
  '25_br_sign.mjs':     '[0140] 제조기록서 서명 칸 고치기 · 사유',
  '26_wo_issued.mjs':   '[0141] 작업 지시 발행 일시를 종이 지시서에 맞춤',
  '27_end_before_start.mjs': '[0142] 종료 시각이 시작 시각보다 앞서도 막지 않음',
  '28_consumable_stock.mjs': '[0144] 로트 없이 쓰는 소모품 입고 · 공정 마감 자동 차감',
  '29_solution_br_entry.mjs': '[0145] PBS 제조기록서를 원액 로트에 적는다',
  '30_carry_open.mjs':  '[0146] 여러 날 공정을 끝나는 일차로 넘긴다',
  '31_end_day_move.mjs': '[0148 · 0150] 여러 날 공정은 마감하면 끝나는 일차로 간다 · 종료를 고치면 따라간다',
  '32_process_skip.mjs': '[0149] 제품 로트의 재단 이후 공정 건너뛰기',
  '33_lot_delete.mjs':   '[0151] 쓰지 않은 제조번호 지우기',
  '36_flag_returns.mjs': '[0154] 구간 이탈은 반납을 뺀 양으로 본다',
  '37_force_br.mjs':     '[0155] 관리자 기록서 정정 · «-» 사용 안 함은 기입 누락이 아니다',
  '35_idle_lock_off.mjs': '[0153] 관리자는 자기 자동 잠금을 끈다 · 역할을 거두면 다시 잠긴다',
  '38_lock_minutes.mjs': '[0157] 자동 잠금 시간을 본인이 고른다 · 현장은 30분까지',
  '39_model_udi.mjs':    '[0158] 형명 체계를 제품에 잇는다 · 형명의 UDI-DI',
  '41_po_number.mjs':    '[0163] 발주번호도 채번 규칙으로',
  '42_order_plan.mjs':   '[0164] 주문에서 생산 계획 · 자재 소요',
  '43_order_plan_lib.mjs': '[0164] 배치 나누기 · 날짜 놓기',
  '44_force_issue.mjs':  '[0165] 관리자 강제 투입',
  '40_sales_order.mjs':  '[0159] 수주 장부 · 출고는 주문 줄로 · 형명 일괄 검토',
  // 감사추적을 실제로 비우므로 08 바로 앞이다.
  '16_open_delete.mjs': '[0122]  감사추적 비우기 · 쓰지 않은 계정 지우기',
  // 실제로 자료를 비우므로 반드시 마지막이다.
  '08_purge.mjs':       '[§1 §10] 시연 자료 비우기 · S03 의 좁은 문',
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

  /*
   * 이 보고서가 무엇의 근거인지 정확히 적는다.
   *
   * M0~M4 배포가 끝난 뒤에도 제목과 범위란이 "M0" 로 남아 있었고, 같은
   * 보고서가 이관 0001~0061 전부를 적용했다고 적고 있었다 (3차 검수 결함 6).
   * 범위를 좁게 적은 보고서를 넓은 근거로 쓰면 그건 근거가 아니다.
   *
   * 엔진도 함께 적는다. PGlite 는 메모리에서 도는 개발용이고 운영은 별개의
   * PostgreSQL 이다. 어느 엔진에서 돌았는지가 보고서에 없으면 그 결과가
   * 운영에 대해 무엇을 말하는지 알 수 없다.
   */
  const onPglite = db.target.startsWith('PGlite');

  say(RULE);
  say(' DOF DHR 지원 시스템 - 적격성 시험 (OQ)');
  say(' 범위      : S01~S05 · 감사추적 · 채번 · 계보 · 재고 · 검토 지원 ·');
  say('             불변성 · 인쇄 대장 · 규격 표기 · 기준값 근거');
  say(` 실행 일시 : ${now} (Asia/Seoul)`);
  say(` 대상 DB   : ${db.target}`);
  say(` 엔진      : ${version.split(' on ')[0]}`);
  say(` 마이그레이션: ${files.length}개 (${files[0]} ~ ${files[files.length - 1]})`);
  if (onPglite) {
    say('');
    say(' * 이 실행은 메모리 엔진(PGlite)에서 돌았습니다. 개발 중 회귀 시험입니다.');
    say('   정본 OQ 는 운영과 같은 PostgreSQL 에 대고 한 번 이상 돌린 것이어야 합니다.');
    say('     DATABASE_URL=postgres://... node test/run.mjs');
  }
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
  say('   · 인쇄 충실성 (§8.2)             →  test/print.mjs      (실제 서버 · 실제 자료 필요)');
  say('   · 화면이 그려지는지               →  scripts/smoke.mjs   (실제 서버 · 실제 자료 필요)');
  say(RULE);

  // --- 보고서 저장 ----------------------------------------------------------
  const stamp = now.replace(/[-: ]/g, '').slice(0, 15);
  const dir = path.join(ROOT, 'reports');
  mkdirSync(dir, { recursive: true });
  /* 파일 이름도 범위를 말한다. 엔진이 무엇이었는지가 파일 이름에 있어야 
     보고서를 모아 놓고도 어느 것이 정본인지 가려낼 수 있다 */
  const engine = onPglite ? 'PGLITE' : 'PG';
  const file = path.join(dir, `OQ-${engine}-${stamp}.txt`);
  writeFileSync(file, out.join('\n') + '\n', 'utf8');
  console.log(`\n보고서: ${path.relative(ROOT, file)}`);

  await db.close();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
