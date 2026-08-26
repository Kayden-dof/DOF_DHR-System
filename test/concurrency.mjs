// =============================================================================
// concurrency.mjs - 동시 채번 시험
// 근거: CLAUDE.md §8.1  "동시 세션 2개에서 각 50회 채번 → 중복 0건, 순번 연속"
//       §9 M0 완료 판정 "동시 채번 중복 없음"
//
//   DATABASE_URL=postgres://user:pw@host/db node test/concurrency.mjs
//   SESSIONS=4 PER_SESSION=100 DATABASE_URL=... node test/concurrency.mjs
//
// PGlite는 백엔드가 하나라 동시성이 성립하지 않는다. 이 시험만은 실제
// PostgreSQL 서버가 필요하다. 실운영 DB를 가리키지 말 것.
// =============================================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.DATABASE_URL;
const SESSIONS = Number(process.env.SESSIONS ?? 2);
const PER = Number(process.env.PER_SESSION ?? 50);

if (!URL_) {
  console.error(
    '동시 채번 시험에는 실제 PostgreSQL 서버가 필요하다.\n' +
    '  DATABASE_URL=postgres://user:pw@host:5432/dbname node test/concurrency.mjs\n\n' +
    'PGlite는 백엔드가 하나뿐이라 두 세션이 같은 순간에 채번하는 상황을\n' +
    '재현할 수 없다. 이 시험을 PGlite로 돌리면 통과해도 아무것도 증명하지 못한다.');
  process.exit(2);
}

const out = [];
const say = (l = '') => { out.push(l); console.log(l); };
const RULE = '='.repeat(96);

const { default: pg } = await import('pg');

async function connect() {
  const c = new pg.Client({ connectionString: URL_ });
  await c.connect();
  return c;
}

// --- 준비 --------------------------------------------------------------------
const setup = await connect();

const mdir = path.join(ROOT, 'db', 'migrations');
for (const f of readdirSync(mdir).filter((f) => f.endsWith('.sql')).sort()) {
  await setup.query(readFileSync(path.join(mdir, f), 'utf8'));
}

const stamp = Date.now();
const admin = (await setup.query(
  `insert into app_user (login_code, full_name, pin_hash)
   values ($1, '동시시험관리자', '$argon2id$test$') returning id`,
  [`8${String(stamp).slice(-6)}`])).rows[0].id;

// 매 실행마다 새 품목 키를 써서 이전 실행과 카운터가 겹치지 않게 한다.
const item = (await setup.query('select gen_random_uuid() as id')).rows[0].id;
const rule = (await setup.query(
  `insert into numbering_rule
     (target, item_id, pattern, reset, seq_width, effective_from, registered_by)
   values ('MATERIAL_LOT', $1, 'CC-{SEQ:6}', 'NEVER', 6, current_date, $2)
   returning id`, [item, admin])).rows[0].id;

const now = (await setup.query(
  `select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD HH24:MI:SS') as s`)).rows[0].s;
const version = (await setup.query('select version()')).rows[0].version;

say(RULE);
say(' DOF DHR 지원 시스템 - M0 동시 채번 시험');
say(' 근거      : CLAUDE.md §8.1 채번 시험, §9 M0 완료 판정');
say(` 실행 일시 : ${now} (Asia/Seoul)`);
say(` 대상 DB   : ${URL_.replace(/\/\/[^@]*@/, '//***@')}`);
say(` 엔진      : ${version.split(' on ')[0]}`);
say(` 조건      : 동시 세션 ${SESSIONS}개 × 각 ${PER}회 = ${SESSIONS * PER}회 · 규칙 교체 경합 1건`);
say(RULE);

// --- 실행 --------------------------------------------------------------------
// 전 세션을 먼저 접속시켜 두고 동시에 출발시킨다. 순차 접속하면 경합이
// 생기지 않아 시험이 무의미해진다.
const clients = await Promise.all(Array.from({ length: SESSIONS }, connect));

let release;
const gate = new Promise((r) => { release = r; });

const t0 = process.hrtime.bigint();
const runs = clients.map(async (c, i) => {
  await gate;
  const got = [];
  for (let k = 0; k < PER; k++) {
    const r = await c.query(`select next_number('MATERIAL_LOT', $1) as no`, [item]);
    got.push({ session: i + 1, no: r.rows[0].no });
  }
  return got;
});

release();
const all = (await Promise.all(runs)).flat();
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

await Promise.all(clients.map((c) => c.end()));

// --- 판정 --------------------------------------------------------------------
const nos  = all.map((x) => x.no);
const uniq = new Set(nos);
const dups = nos.filter((n, i) => nos.indexOf(n) !== i);

const seqs = nos.map((n) => Number(n.slice(-6))).sort((a, b) => a - b);
const expected = Array.from({ length: SESSIONS * PER }, (_, i) => i + 1);
const contiguous = seqs.length === expected.length && seqs.every((s, i) => s === expected[i]);

const counter = (await setup.query(
  `select last_seq from numbering_counter where rule_id = $1`, [rule])).rows[0].last_seq;

const perSession = all.reduce((m, x) => (m[x.session] = (m[x.session] ?? 0) + 1, m), {});

const results = [
  ['C-01', '중복 0건',          `발행 ${nos.length}건 · 고유 ${uniq.size}건 · 중복 ${dups.length}건`,
    dups.length === 0],
  ['C-02', '순번 연속',         `1 ~ ${SESSIONS * PER} 빠짐없이`, contiguous],
  ['C-03', '카운터 일치',       `last_seq=${counter} (기대 ${SESSIONS * PER})`,
    Number(counter) === SESSIONS * PER],
  ['C-04', '세션별 발행 수',    Object.entries(perSession).map(([s, n]) => `S${s}:${n}`).join(' · '),
    Object.values(perSession).every((n) => n === PER)],
];

say('');
for (const [id, label, detail, ok] of results) {
  say(` ${id}  ${label.padEnd(10)}  ${(ok ? 'PASS' : 'FAIL').padEnd(6)} ${detail}`);
}
if (dups.length) say(`\n 중복 번호: ${[...new Set(dups)].join(', ')}`);

// --- C-05 규칙 교체 경합 -----------------------------------------------------
// 순번 승계는 "구 규칙 카운터의 커밋된 최대값"을 읽는다. 구 규칙으로 아직
// 발행 중인 트랜잭션이 있는데 규칙을 내려 버리면 그 증가분이 안 보여 같은
// 번호가 두 번 나간다. next_number()가 규칙 행에 공유 잠금을 걸어 이를 막는다.
const item2 = (await setup.query('select gen_random_uuid() as id')).rows[0].id;
const rule2 = (await setup.query(
  `insert into numbering_rule
     (target, item_id, pattern, reset, seq_width, effective_from, registered_by)
   values ('BATCH', $1, 'RR-{SEQ:3}', 'NEVER', 3, current_date, $2)
   returning id`, [item2, admin])).rows[0].id;

const a = await connect();
const b = await connect();

await a.query('begin');
const held = (await a.query(
  `select next_number('BATCH', $1) as no`, [item2])).rows[0].no;   // 커밋 전

let bSettled = false;
const bPending = b
  .query(`update numbering_rule set is_active = false where id = $1`, [rule2])
  .then(() => { bSettled = true; });

await new Promise((r) => setTimeout(r, 500));
const blocked = !bSettled;          // 규칙 교체가 발행 종료를 기다려야 한다

await a.query('commit');
await bPending;
await a.end();
await b.end();

await setup.query(
  `insert into numbering_rule
     (target, item_id, pattern, reset, seq_width, effective_from, registered_by)
   values ('BATCH', $1, 'RR-{SEQ:3}', 'NEVER', 3, current_date, $2)`, [item2, admin]);

const resumed = (await setup.query(
  `select next_number('BATCH', $1) as no`, [item2])).rows[0].no;
const expectNext = `RR-${String(Number(held.slice(-3)) + 1).padStart(3, '0')}`;

results.push(
  ['C-05', '교체 잠금', `발행 중 규칙 교체가 대기 ${blocked ? '함' : '안 함'}`, blocked],
  ['C-06', '승계 정확', `${held} 이후 ${resumed} (기대 ${expectNext})`, resumed === expectNext],
);

say(` C-05  ${'교체 잠금'.padEnd(10)}  ${(blocked ? 'PASS' : 'FAIL').padEnd(6)} 발행 중 규칙 교체가 대기 ${blocked ? '함' : '안 함'}`);
say(` C-06  ${'승계 정확'.padEnd(10)}  ${(resumed === expectNext ? 'PASS' : 'FAIL').padEnd(6)} ${held} 이후 ${resumed} (기대 ${expectNext})`);

const failed = results.filter(([, , , ok]) => !ok).length;
say('');
say(RULE);
say(` 합계 ${results.length}건 · 통과 ${results.length - failed} · 실패 ${failed}   (소요 ${ms.toFixed(0)}ms)`);
say(RULE);

const dir = path.join(ROOT, 'reports');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `OQ-M0-concurrency-${now.replace(/[-: ]/g, '').slice(0, 15)}.txt`);
writeFileSync(file, out.join('\n') + '\n', 'utf8');
console.log(`\n보고서: ${path.relative(ROOT, file)}`);

await setup.end();
process.exit(failed ? 1 : 0);
