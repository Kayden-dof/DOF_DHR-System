// =============================================================================
// mutation.mjs - 시험이 실제로 무엇을 잡는지 확인한다
//
//   DATABASE_URL=postgres://... node test/mutation.mjs
//
// 근거: CLAUDE.md §8.1 · §8.0
//
// ── 왜 필요한가 ─────────────────────────────────────────────────────────────
// "206건 전건 통과" 는 두 가지 중 하나를 뜻한다. 규칙이 막고 있거나, 시험이
// 아무것도 안 보고 있거나. 통과만으로는 둘을 가릴 수 없다.
//
// 2026-09-01 하루에 그런 것이 셋 나왔다. 서명란 대조는 낱말이 종이 다른 곳에도
// 있어 서명란을 통째로 떼도 통과했고, 복구 훈련은 물리적 순서로 해시해 헛경보를
// 냈고, 현황 목록은 숫자와 다른 키로 묶었다. 전부 "확인해 준다는 도구" 였다.
//
// 그래서 거꾸로 묻는다. **규칙을 없애면 그 시험이 실패하는가.**
// 실패하지 않으면 그 시험은 통과해도 아무것도 증명하지 않는다.
//
// ── 어디에 대고 도는가 ──────────────────────────────────────────────────────
// 넘겨받은 DB 를 **망가뜨린다.** 운영이나 개발용 DB 를 가리키지 말 것.
// 훈련용 빈 DB 를 따로 만들어 쓴다. 각 항목은 트랜잭션 안에서 망가뜨리고
// 되돌리므로 서로 오염되지 않는다.
// =============================================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCtx, pad } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.DATABASE_URL;

if (!URL_) {
  console.error(
    '이 훈련은 DB 를 망가뜨린다. 훈련용 빈 DB 를 지정할 것.\n' +
    '  DATABASE_URL=postgres://user:pw@host:5432/dhr_mut node test/mutation.mjs\n\n' +
    '운영이나 개발용 DB 를 가리키지 말 것.');
  process.exit(2);
}

/* ---------------------------------------------------------------------------
   무엇을 없애고, 그때 어느 시험이 실패해야 하는가

   sql   : 규칙을 없애는 조작
   cases : 그때 반드시 실패해야 하는 시험 번호
--------------------------------------------------------------------------- */
const MUTATIONS = [
  { id: 'M-S01', rule: 'S01 자재 로트 공란 금지',
    sql: `alter table material_issue alter column material_lot_id drop not null`,
    cases: ['S01-01'] },

  { id: 'M-S02', rule: 'S02 성적서 번호 필수',
    sql: `alter table material_lot alter column coa_no drop not null`,
    cases: ['S02-01'] },

  { id: 'M-S03', rule: 'S03 삭제 금지 (권한)',
    sql: `grant delete on material_issue, process_record, work_order, audit_log to app_role`,
    cases: ['S03-01', 'S03-02'] },

  { id: 'M-S03t', rule: 'S03 삭제 금지 (트리거)',
    sql: `drop trigger if exists audit_log_no_delete on audit_log`,
    cases: ['S03-06'] },

  { id: 'M-S04', rule: 'S04 인쇄 후 잠금',
    sql: `drop trigger if exists process_record_s04 on process_record;
          drop trigger if exists material_issue_s04 on material_issue`,
    cases: ['S04-01', 'S04-02'] },

  { id: 'M-LOAD', rule: '장입 경고가 제품표준서를 본다 (0087)',
    /* 옛 셈법으로 되돌린다. 30과 WS-02 가 박혀 있던 그대로 */
    sql: `create or replace function work_order_warnings(
            p_material_lot uuid, p_sheets int, p_device_master uuid default null)
          returns table (kind text, detail text)
          language plpgsql stable as $x$
          begin
            if p_sheets > 30 then
              kind := '장입 상한 초과';
              detail := format('장입 %s장. WS-02 배치 상한은 30장입니다', p_sheets);
              return next;
            end if;
          end $x$`,
    cases: ['WARN-01'] },

  { id: 'M-SCHEME', rule: '완제품 생성기가 체계를 고른다 (0086)',
    /* 조용히 가장 먼저 등록한 체계를 고르던 그대로 */
    sql: `create or replace function generate_finished_items(
            p_sizes text[], p_bands text[], p_exclude text[] default '{}',
            p_name_prefix text default null, p_shelf_months int default 12,
            p_scheme uuid default null)
          returns table (item_code text, item_name text, was_created boolean)
          language plpgsql as $x$
          declare sc record;
          begin
            select * into sc from model_scheme where is_active
              order by registered_at limit 1;
            item_code := sc.prefix || p_sizes[1] || p_bands[1];
            item_name := sc.prefix; was_created := false;
            return next;
          end $x$`,
    cases: ['MS-06', 'MS-07'] },

  { id: 'M-SPECNOTE', rule: '완제품 규격을 못 만들면 사실을 적는다 (0088)',
    /* 빈 문자열로 되돌린다. 종이에 빈 칸이 나가던 그대로 */
    sql: `create or replace function spec_label(p_code text)
          returns text language plpgsql stable
          set search_path = pg_catalog, public, pg_temp as $x$
          declare p record; out_ text;
          begin
            select s.spec_pattern into out_ from model_scheme s
             where s.is_active and left(p_code, length(s.prefix)) = s.prefix
               and exists (select 1 from model_parts(p_code))
             order by length(s.prefix) desc limit 1;
            if out_ is null then return ''; end if;
            for p in select * from model_parts(p_code) loop
              out_ := replace(out_, '{' || p.seq || '}', p.shown);
            end loop;
            return out_;
          end $x$`,
    cases: ['MS-08'] },

  { id: 'M-OPEN', rule: '종료 없는 공정을 품은 채 마감 금지 (0085)',
    sql: `drop trigger if exists day_lock_open on day_lock`,
    cases: ['S04-05', 'S04-06'] },

  { id: 'M-S05', rule: 'S05 자재 미기록 시 진행 불가',
    sql: `create or replace function complete_process(p_pr uuid)
          returns void language plpgsql security definer
          set search_path = pg_catalog, public, pg_temp as $fn$
          begin
            update process_record set ended_at = coalesce(ended_at, now()) where id = p_pr;
          end $fn$`,
    cases: ['S05-01'] },

  { id: 'M-SCOPE', rule: '재단 전후 공정 범위',
    sql: `drop trigger if exists process_record_scope on process_record`,
    cases: ['ST-01', 'ST-02'] },

  { id: 'M-DEV', rule: '개발 계정에 QP 금지 (역할을 거는 쪽)',
    sql: `drop trigger if exists user_role_no_dev on user_role`,
    cases: ['U-04'] },

  /*
   * 같은 규칙인데 문이 둘이다. 역할을 거는 쪽과 표시를 켜는 쪽.
   * 처음에 U-06 을 앞의 조작에 붙였더니 눈감음으로 나왔는데, 시험이 아니라
   * 대응이 틀린 것이었다 - U-06 은 이쪽 문을 본다 (2026-09-01 훈련).
   */
  { id: 'M-DEV2', rule: '개발 계정에 QP 금지 (표시를 켜는 쪽)',
    sql: `drop trigger if exists app_user_no_qp_dev on app_user`,
    cases: ['U-06'] },

  { id: 'M-AUDIT', rule: '감사추적 기록',
    sql: `drop trigger if exists material_lot_audit on material_lot;
          drop trigger if exists work_order_audit on work_order`,
    cases: ['S03-11'] },

  { id: 'M-SEQ', rule: '같은 대상에 같은 인쇄 회차 금지',
    sql: `drop index if exists record_print_target_seq`,
    cases: ['RV2-06'] },

  { id: 'M-ONCE', rule: '적힌 값 고쳐 쓰기 금지',
    sql: `drop trigger if exists product_lot_release_once on product_lot;
          drop trigger if exists deviation_once on deviation`,
    cases: ['RV2-10', 'DV-05', 'DV-07'] },

  { id: 'M-DVDATE', rule: '일탈 미래 날짜 금지',
    sql: `drop trigger if exists deviation_dates on deviation`,
    cases: ['DV-10'] },

  /*
   * 규격 표기는 규칙이 아니라 셈이다. 그래서 없애는 것이 아니라 **틀리게**
   * 만든다 - 크기 두 자리까지 10 으로 나눈다. 정확히 0057 이 고친 결함이고,
   * 그 값이 라벨 업체가 보는 종이로 나갔다.
   *
   * M5-4 가 이 함수를 통째로 갈아 끼운다. 그때 시험이 눈을 감고 있으면
   * 10배 틀린 치수가 다시 종이로 나간다.
   */
  { id: 'M-SPEC', rule: '규격 표기 (크기는 cm 그대로)',
    sql: `create or replace function spec_label(p_code text) returns text
          language sql immutable as $fn$
            select case
              when p_code ~ '^PD[0-9]{8}$' then
                format('%sx%scm · 두께 %s~%smm',
                  mm_label(substr(p_code, 3, 2)), mm_label(substr(p_code, 5, 2)),
                  mm_label(substr(p_code, 7, 2)), mm_label(substr(p_code, 9, 2)))
              else ''
            end
          $fn$`,
    cases: ['MS-01', 'MS-02', 'RV3-01'] },

  /* 넓이는 원가를 배치 안에서 가르는 데 쓴다. 뒤집으면 배분이 뒤집힌다 */
  { id: 'M-AREA', rule: '형명에서 넓이를 셈한다',
    sql: `create or replace function item_area_cm2(p_code text) returns numeric
          language sql immutable as $fn$ select null::numeric $fn$`,
    cases: ['MS-01', 'MS-02'] },

  /* 공수 단가를 고쳐 쓰는 길이 열리면 지난 원가가 조용히 바뀐다 */
  { id: 'M-RATE', rule: '공수 단가는 고쳐 쓸 수 없다',
    sql: `grant update, delete on labour_rate to app_role`,
    cases: ['LC-04'] },

  /* 빠진 건수를 세지 않으면 원가가 적게 나온 줄 모른다 */
  { id: 'M-GAP', rule: '시각이 빈 기록을 센다',
    sql: `create or replace view v_process_cost as
          select pr.id as process_record_id, pr.work_order_id, pr.product_lot_id,
                 pr.worker_id, pr.equipment_id, pr.work_date,
                 true as timed,
                 coalesce(round(extract(epoch from pr.ended_at - pr.started_at)
                                / 3600.0, 4), 0) as hours,
                 (select max(labour_rate_at(ur.role, pr.work_date))
                    from user_role ur where ur.user_id = pr.worker_id) as labour_rate,
                 equipment_hourly_cost(pr.equipment_id) as equip_rate
            from process_record pr`,
    cases: ['LC-05'] },
];

/* --- 시험을 모은다 --------------------------------------------------------- */
const FILES = [
  '01_users.mjs', '02_s03_audit.mjs', '03_numbering.mjs', '04_rules_m1_m4.mjs',
  '05_genealogy.mjs', '06_review.mjs', '07_immutable.mjs',
  '09_review2.mjs', '10_review3.mjs', '11_deviation.mjs', '12_model_scheme.mjs',
  '13_cost.mjs',
];

const byId = new Map();
for (const f of FILES) {
  for (const c of (await import(`./cases/${f}`)).default) byId.set(c.id, c);
}

/* --- DB --------------------------------------------------------------------- */
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: URL_ });
await client.connect();

const db = {
  exec: (sql) => client.query(sql),
  query: (sql, params = []) => client.query(sql, params).then((r) => r.rows),
};

const mdir = path.join(ROOT, 'db', 'migrations');
const files = readdirSync(mdir).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) await db.exec(readFileSync(path.join(mdir, f), 'utf8'));

const version = (await db.query('select version()'))[0].version;
const now = (await db.query(
  `select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD HH24:MI:SS') as s`))[0].s;

const out = [];
const say = (l = '') => { out.push(l); console.log(l); };
const RULE = '='.repeat(96);
const THIN = '-'.repeat(96);

say(RULE);
say(' DOF DHR 지원 시스템 - 시험 실효성 확인 (돌연변이 훈련)');
say(' 묻는 것    : 규칙을 없애면 그 시험이 실패하는가');
say('              실패하지 않으면 그 시험은 통과해도 아무것도 증명하지 않는다');
say(` 실행 일시  : ${now} (Asia/Seoul)`);
say(` 대상 DB    : ${URL_.replace(/\/\/[^@]*@/, '//***@')}`);
say(` 엔진       : ${version.split(' on ')[0]}`);
say(RULE);

/* 시험을 한 번 돌린다. 그 사이 오류는 잡아 두기만 한다 */
async function run(id) {
  const c = byId.get(id);
  if (!c) return { ok: false, missing: true };
  const admin = (await db.query(
    `insert into app_user (login_code, full_name, pin_hash)
     values ($1, '돌연변이시험', '$argon2id$test$') returning id`,
    [`7${String(Date.parse(now) % 100000 + Math.floor(performance.now() * 1000) % 89999).slice(-5)}`]
  ))[0].id;
  await db.query(`insert into user_role (user_id, role) values ($1,'SYS_ADMIN')`, [admin]);
  const ctx = makeCtx(db, { admin });
  try {
    await c.run(ctx);
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e.message.split('\n')[0] };
  } finally {
    try { await db.exec('reset role; reset timezone'); } catch { /* noop */ }
  }
}

let caught = 0; let blind = 0;
const blindList = [];

for (const m of MUTATIONS) {
  say('');
  say(`${m.id}  ${m.rule}`);
  say(THIN);

  for (const id of m.cases) {
    /* 망가뜨린 뒤 시험을 돌리고, 무슨 일이 있어도 되돌린다 */
    await db.exec('begin');
    let res;
    try {
      await db.exec(m.sql);
      res = await run(id);
    } catch (e) {
      res = { ok: false, detail: `조작 자체가 막힘: ${e.message.split('\n')[0]}` };
    } finally {
      try { await db.exec('rollback'); } catch { /* noop */ }
      try { await db.exec('reset role; reset timezone'); } catch { /* noop */ }
    }

    const c = byId.get(id);
    if (!c) {
      say(` ${pad(id, 10)}${pad('(그런 시험이 없다)', 52)}눈감음`);
      blind += 1; blindList.push(`${id} — 시험을 찾을 수 없다`);
      continue;
    }

    /*
     * 규칙을 없앴으니 시험은 실패해야 한다. 통과했다면 그 시험은 그 규칙을
     * 보고 있지 않다는 뜻이다.
     */
    const detects = !res.ok;
    if (detects) caught += 1;
    else { blind += 1; blindList.push(`${id} — ${c.name}`); }
    say(` ${pad(id, 10)}${pad(c.name, 52)}${detects ? '잡음' : '눈감음'}`);
  }
}

/* --- 되돌아왔는지 확인한다 -------------------------------------------------- */
const back = [];
for (const [label, sql, want] of [
  ['S01 NOT NULL', `select attnotnull a from pg_attribute
     where attrelid = 'material_issue'::regclass and attname = 'material_lot_id'`, true],
  ['S04 트리거', `select count(*)::int a from pg_trigger
     where tgname in ('process_record_s04','material_issue_s04')`, 2],
  ['일탈 날짜 트리거', `select count(*)::int a from pg_trigger where tgname = 'deviation_dates'`, 1],
]) {
  const got = (await db.query(sql))[0].a;
  back.push(`${label} ${String(got) === String(want) ? '되돌아옴' : `되돌아오지 않음 (${got})`}`);
}

say('');
say(RULE);
say(` 조작 ${MUTATIONS.length}가지 · 시험 ${caught + blind}건 · 잡음 ${caught} · 눈감음 ${blind}`);
if (blind > 0) {
  say('');
  say(' 규칙을 없애도 통과한 시험 (통과해도 아무것도 증명하지 않는다)');
  for (const b of blindList) say(`   · ${b}`);
}
say('');
say(` 원상 복구 : ${back.join(' · ')}`);
say(RULE);

const dir = path.join(ROOT, 'reports');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `MUTATION-${now.replace(/[-: ]/g, '').slice(0, 15)}.txt`);
writeFileSync(file, out.join('\n') + '\n', 'utf8');
console.log(`\n보고서: ${path.relative(ROOT, file)}`);

await client.end();
process.exit(blind ? 1 : 0);
