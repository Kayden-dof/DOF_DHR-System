/* ---------------------------------------------------------------------------
   인쇄 충실성 시험 (§8.2)

     node --env-file=.env.local test/print.mjs [http://localhost:3100]

   사양이 "이 시스템에서 가장 중요한 검증"이라고 못 박은 항목이다. 종이가
   정본이므로, DB 에 있는 값이 종이에 그대로 나오지 않으면 이 시스템은 틀린
   기록을 발행한다. 화면이 맞는지가 아니라 종이가 맞는지를 본다.

   양식 6종을 실제로 그려서, 그 종이에 나와야 할 값을 DB 에서 따로 읽어 와
   항목 단위로 대조한다. 규칙 시험(test/run.mjs)이 DB 계층을 보장하고, 화면
   훑기(scripts/smoke.mjs)가 화면이 그려지는지를 보고, 이 시험이 그려진
   내용이 자료와 같은지를 본다.

   나와야 할 것만이 아니라 나오면 안 되는 것도 본다. 작업 지시서에 시약
   로트번호가 찍히면 착수 전에 정해지지 않은 값을 미리 적어 둔 셈이 되고,
   현장은 그 종이를 보고 그 로트를 쓴다.

   ── 주의 ──────────────────────────────────────────────────────────────────
   인쇄 화면을 여는 것 자체가 record_print 에 회차를 남기고, 제조기록서는
   그 묶음을 잠근다 (S04). 그래서 이 시험은 이미 잠긴 묶음만 고른다.
   실운영 서버에 대고 돌리지 말 것.
--------------------------------------------------------------------------- */
import pg from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgSsl } from '../scripts/pgssl.mjs';
import { sessionCookie, visibleText } from '../scripts/session-cookie.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] ?? 'http://localhost:3100';
const url = process.env.DATABASE_URL;

const db = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await db.connect();
const rows = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => (await rows(sql, p))[0] ?? null;

/* --- 대조할 자료 고르기 ---------------------------------------------------- */

const wo = await one(
  `select wo.id, wo.wo_no, wo.batch_no, wo.sheet_count, wo.dmr_revision,
          i.code as item_code, i.name as item_name,
          ml.lot_no as raw_lot_no, ml.thickness_band, ml.coa_no,
          s.name as supplier_name, ml.supplier_lot_no,
          up.full_name as prod_name, uq.full_name as qa_name
     from work_order wo
     join device_master dm on dm.id = wo.device_master_id
     join item i on i.id = dm.item_id
     join material_lot ml on ml.id = wo.material_lot_id
     join supplier s on s.id = ml.supplier_id
     join app_user up on up.id = wo.issued_by_prod
     join app_user uq on uq.id = wo.issued_by_qa
    where exists (select 1 from product_lot pl where pl.work_order_id = wo.id)
    order by wo.issued_at limit 1`);

if (!wo) {
  console.error('대조할 배치가 없습니다. scripts/seed-flow.mjs 를 먼저 돌리십시오.');
  process.exit(2);
}

const lots = await rows(
  `select pl.id, pl.lot_no, pl.qty_produced, pl.qty_sample, pl.qty_available,
          pl.manufactured_on::text as manufactured_on, pl.expiry_date::text as expiry_date,
          i.code as item_code, i.name as item_name
     from product_lot pl join item i on i.id = pl.item_id
    where pl.work_order_id = $1 order by pl.lot_no`, [wo.id]);

const mat = await one(
  `select ml.id, ml.lot_no, ml.coa_no, ml.qty_available, ml.expiry_date::text as expiry_date,
          i.name as item_name, i.usage_uom, s.name as supplier_name, ml.supplier_lot_no
     from material_lot ml join item i on i.id = ml.item_id
     join supplier s on s.id = ml.supplier_id
    where ml.item_id in (select id from item where type = 'RAW')
    order by ml.lot_no limit 1`);

/*
 * 제조기록서는 이미 잠긴 묶음만 고른다. 안 잠긴 것을 열면 이 시험이 그 묶음을
 * 잠가 버린다. 잠금 해제는 없으므로 시험이 자료를 되돌릴 수 없게 바꾼다.
 */
const day = await one(
  `select dl.work_order_id, dl.day_no, dl.worker_id, u.full_name as worker_name,
          (select min(pr.work_date)::text from process_record pr
            where pr.work_order_id = dl.work_order_id
              and pr.day_no = dl.day_no and pr.worker_id = dl.worker_id) as work_date,
          (select wo2.batch_no from work_order wo2 where wo2.id = dl.work_order_id) as batch_no
     from day_lock dl join app_user u on u.id = dl.worker_id
    order by dl.locked_at limit 1`);

const issues = day ? await rows(
  `select ml.lot_no, mi.qty, i.name as item_name, o.code as op_code, o.name as op_name,
          to_char(timezone('Asia/Seoul', pr.started_at),'HH24:MI') as started,
          to_char(timezone('Asia/Seoul', pr.ended_at),'HH24:MI') as ended
     from process_record pr
     join dmr_operation o on o.id = pr.operation_id
     left join material_issue mi on mi.process_record_id = pr.id
     left join material_lot ml on ml.id = mi.material_lot_id
     left join item i on i.id = ml.item_id
    where pr.work_order_id = $1 and pr.day_no = $2 and pr.worker_id = $3
    order by o.seq`, [day.work_order_id, day.day_no, day.worker_id]) : [];

/* 착수 전에 정해지지 않는 값. 작업 지시서에 나오면 안 된다 (§7) */
const reagentLots = await rows(
  `select distinct ml.lot_no
     from material_lot ml join item i on i.id = ml.item_id
    where i.type in ('REAGENT','PROCESS','PACK')`);

const users = Object.fromEntries(
  (await rows(`select login_code, id from app_user`)).map((u) => [u.login_code, u.id]));
await db.end();

/* --- 실행기 --------------------------------------------------------------- */

const cookie = sessionCookie(users['100200']);
const out = [];
let pass = 0; let fail = 0;

function say(line = '') { out.push(line); console.log(line); }

async function sheet(name, formPath, checks) {
  const r = await fetch(`${BASE}${formPath}`, { headers: { cookie } });
  say('');
  say(`${name}   ${formPath}`);
  say('-'.repeat(96));

  if (r.status !== 200) {
    fail++;
    say(`  ${'실패'}  화면이 열리지 않습니다 (HTTP ${r.status})`);
    return;
  }
  const text = visibleText(await r.text());

  for (const c of checks) {
    const value = c.value === null || c.value === undefined ? '' : String(c.value).trim();
    if (value === '') continue;             // DB 에 값이 없으면 대조할 것이 없다

    const found = text.includes(value);
    const ok = c.absent ? !found : found;
    ok ? pass++ : fail++;
    say(`  ${ok ? '일치' : '불일치'}  ${c.label.padEnd(22)}  ${
      c.absent ? '나오지 않아야 함' : ''}${value.length > 46 ? value.slice(0, 46) + '…' : value}`);
  }
}

/* 모든 인쇄물 공통 (§7) */
const common = (kindLabel) => [
  { label: '양식 이름',   value: kindLabel },
  { label: '인쇄 일시',   value: '인쇄 일시' },
  { label: '인쇄자',      value: '인쇄자' },
  { label: '인쇄 회차',   value: '인쇄 회차' },
  { label: '자료 식별자', value: '자료 식별자' },
];

/* --- 1. 작업 지시서 -------------------------------------------------------- */

await sheet('① 작업 지시서', `/print/work-order/${wo.id}`, [
  ...common('작업 지시서'),
  { label: '지시서번호',        value: wo.wo_no },
  { label: '배치번호',          value: wo.batch_no },
  { label: '제품명',            value: wo.item_name },
  { label: '형명',              value: wo.item_code },
  { label: '제품표준서 개정',   value: wo.dmr_revision },
  { label: '원재료 로트번호',   value: wo.raw_lot_no },
  { label: '두께 구간',         value: wo.thickness_band },
  { label: '원재료 공급자',     value: wo.supplier_name },
  { label: '성적서 번호',       value: wo.coa_no },
  { label: '장입 장수',         value: String(wo.sheet_count) },
  { label: '생산 발행자',       value: wo.prod_name },
  { label: '품질 발행자',       value: wo.qa_name },
  { label: '필요 용기 수',      value: '필요 용기 수' },
  // §7 "시약·포장재 로트번호는 들어가지 않는다". 착수 전에 정해지지 않는다
  ...reagentLots.map((r) => (
    { label: '시약 로트 미기재', value: r.lot_no, absent: true })),
]);

/* --- 2. 제조기록서 --------------------------------------------------------- */

if (day) {
  const mats = issues.filter((i) => i.lot_no);
  await sheet('② 제조기록서', `/print/day-record/${day.work_order_id}/${day.day_no}/${day.worker_id}`, [
    ...common('제조기록서'),
    { label: '배치번호',     value: day.batch_no },
    { label: '일차',         value: `${day.day_no}일차` },
    { label: '작업일',       value: day.work_date },
    { label: '작업자',       value: day.worker_name },
    ...issues.slice(0, 4).map((i) => (
      { label: `공정 ${i.op_code}`, value: i.op_name })),
    ...issues.filter((i) => i.started).slice(0, 3).map((i) => (
      { label: `시작 시각 ${i.op_code}`, value: i.started })),
    ...issues.filter((i) => i.ended).slice(0, 3).map((i) => (
      { label: `종료 시각 ${i.op_code}`, value: i.ended })),
    ...mats.slice(0, 5).map((i) => (
      { label: `투입 로트 ${i.item_name}`, value: i.lot_no })),
    ...mats.slice(0, 5).map((i) => (
      { label: `투입 수량 ${i.item_name}`, value: String(Number(i.qty)) })),
    { label: '작업자 서명란', value: '서명' },
  ]);
} else {
  say('');
  say('② 제조기록서   건너뜀 - 잠긴 묶음이 없습니다 (열면 이 시험이 잠급니다)');
}

/* --- 3. 라벨요청서 --------------------------------------------------------- */

await sheet('③ 라벨요청서', `/print/label-request/${wo.id}`, [
  ...common('라벨요청서'),
  { label: '배치번호', value: wo.batch_no },
  ...lots.flatMap((l) => [
    { label: `제조번호 ${l.item_code}`, value: l.lot_no },
    { label: `모델명 ${l.lot_no}`,      value: l.item_code },
    { label: `수량 ${l.lot_no}`,        value: String(l.qty_produced) },
  ]),
]);

/* --- 4. 편철 표지 ---------------------------------------------------------- */

await sheet('④ 편철 표지', `/print/cover/${wo.id}`, [
  ...common('편철 표지'),
  { label: '배치번호',        value: wo.batch_no },
  { label: '지시서번호',      value: wo.wo_no },
  { label: '원재료 로트번호', value: wo.raw_lot_no },
  { label: '성적서 번호',     value: wo.coa_no },
  { label: '장입 장수',       value: String(wo.sheet_count) },
  ...lots.map((l) => ({ label: `제품 로트 ${l.item_code}`, value: l.lot_no })),
  // 일차는 칸 하나에 숫자로 적힌다. 대조는 그 줄의 작업자와 작업일로 한다
  ...(day ? [
    { label: '일차별 기록 작업자', value: day.worker_name },
    { label: '일차별 기록 작업일', value: day.work_date },
  ] : []),
  { label: '품질 검토 서명란', value: '서명' },
]);

/* --- 5. 자재 라벨 ---------------------------------------------------------- */

if (mat) {
  await sheet('⑤ 자재 라벨', `/print/label/${mat.id}`, [
    { label: '로트번호',   value: mat.lot_no },
    { label: '품목명',     value: mat.item_name },
    { label: '수량',       value: String(Number(mat.qty_available)) },
    { label: '유효기한',   value: mat.expiry_date },
    { label: '성적서 번호', value: mat.coa_no },
    { label: '공급자',     value: mat.supplier_name },
  ]);
}

/* --- 6. 출하 승인 요청서 --------------------------------------------------- */

const rel = lots[0];
if (rel) {
  await sheet('⑥ 출하 승인 요청서', `/print/release/${rel.id}`, [
    ...common('출하 승인 요청서'),
    { label: '제품명',       value: rel.item_name },
    { label: '규격',         value: rel.item_code },
    { label: '제조번호',     value: rel.lot_no },
    { label: '배치번호',     value: wo.batch_no },
    { label: '제조일',       value: rel.manufactured_on },
    { label: '유효기한',     value: rel.expiry_date },
    { label: '잔여 수량',    value: String(rel.qty_available) },
    { label: '품질책임자란', value: '품질책임자' },
  ]);
}

/* --- 보고서 ---------------------------------------------------------------- */

say('');
say('='.repeat(96));
say(` 대조 ${pass + fail}항목 · 일치 ${pass} · 불일치 ${fail}`);
say('='.repeat(96));
if (fail === 0) {
  say(' 종이에 나와야 할 값이 전부 나왔고, 나오면 안 되는 값은 나오지 않았습니다.');
} else {
  say(' 불일치 항목을 확인하십시오. 종이가 정본이므로 화면이 아니라 종이를 고쳐야 합니다.');
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
const file = path.join(ROOT, 'reports', `PRINT-${stamp}.txt`);
writeFileSync(file, [
  '인쇄 충실성 시험 (§8.2)',
  `대상 ${BASE}`,
  `배치 ${wo.batch_no} · 지시서 ${wo.wo_no}`,
  '',
  ...out,
].join('\n'), 'utf8');
say('');
say(`보고서: ${path.relative(ROOT, file)}`);

process.exit(fail === 0 ? 0 : 1);
