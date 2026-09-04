/**
 * 두 번째 품목이 서는가 (§2.0 · §12)
 *
 *   node --env-file=.env.local scripts/seed-second.mjs
 *   (npm run fresh 가 마지막 차례로 부른다)
 *
 * ── 무엇을 묻는가 ─────────────────────────────────────────────────────────
 * §2.0 의 판단 기준은 한 문장이다 - **다른 제조소가 이 프로그램을 그대로 받아
 * 쓸 수 있는가.** 그런데 지금까지의 확인은 전부 DX2401 하나를 흘려 본 것이다.
 * `npm run settings` 는 칸이 있는지 보고, `npm run fresh` 는 빈 DB 에서 흐르는지
 * 보지만, **둘 다 DX2401 모양의 자료로 본다.**
 *
 * 그래서 여기서는 **DX2401 과 일부러 다르게 생긴 품목**을 하나 더 세운다.
 *
 * | | DX2401 | 여기 |
 * |---|---|---|
 * | 형명 자리 | PD + 8자리 (자리 4개) | CS + 5자리 (자리 3개) |
 * | 재단 분기 | 있다 (WS-07) | **없다. 전 공정이 재단 이전** |
 * | 자재 기준 | SHEET_TIER + PER_UNIT | **PER_UNIT 만. 장입 구간이 없다** |
 * | 장입 장수 | 1~30 | **1~8** |
 * | 멸균 박스 | 50 | 20 |
 * | 사용기간 | 12개월 | 24개월 |
 * | 제조번호 | 공통 규칙 · 연 초기화 | **품목별 규칙 · 월 초기화** |
 *
 * CLAUDE.md §12 가 적어 둔 문장이 여기서 시험된다 - "재단 같은 분기 공정이
 * 없는 품목이면 전 공정이 false 이고 product_lot 이 배치와 1:1 이 된다.
 * **구조는 그대로 쓸 수 있다.**" 그 말이 참인지 아무도 확인한 적이 없다.
 *
 * ── 심기가 아니라 시험이다 ────────────────────────────────────────────────
 * 이 파일은 자료를 넣기만 하지 않는다. 넣은 뒤에 되묻는다 - 규격 문구가 두
 * 체계에서 각각 맞게 나오는가, 체계를 고르지 않은 생성기가 거절하는가,
 * 제품표준서 밖의 장입 장수가 막히는가, 계보가 원재료까지 닿는가. 넣기만
 * 하고 통과를 찍으면 그것은 §8.0.1 이 말하는 헛도는 확인이다.
 *
 * ── 안전 ──────────────────────────────────────────────────────────────────
 * 지어낸 성적서 번호가 들어간다 (4차 감사 C2). **localhost 가 아니면
 * 거부한다.** 운영에 이 품목이 서면 지울 길이 없다 (S03).
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL 이 없습니다.');
  process.exit(2);
}
{
  const h = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(h)) {
    console.error(`지어낸 성적서 번호가 들어갑니다. localhost 에서만 돕니다 (${h}).`);
    process.exit(2);
  }
}

const c = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await c.connect();

const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const val = async (sql, p = []) => Object.values((await one(sql, p)) ?? {})[0];
const all = async (sql, p = []) => (await c.query(sql, p)).rows;
const say = (s) => console.log(`  ${s}`);

/** 화면과 같은 방식으로 행위자를 심는다. */
async function as(userId, fn) {
  await c.query('begin');
  try {
    await c.query('set local role app_role');
    await c.query(`select set_config('app.user_id', $1, true)`, [userId]);
    const r = await fn();
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
}

/** 되묻기. 통과만 세지 않고 무엇을 물었는지 함께 적는다. */
let asked = 0;
let failed = 0;
function check(label, ok, detail = '') {
  asked += 1;
  if (!ok) failed += 1;
  console.log(`  ${ok ? '맞음  ' : '어긋남'}  ${label}${detail ? `  ${detail}` : ''}`);
}
/** 막혀야 하는 조작. 통과하면 그것이 결함이다. */
async function refused(label, fn, want) {
  asked += 1;
  try {
    await fn();
    failed += 1;
    console.log(`  어긋남  ${label}  막히지 않았습니다`);
  } catch (e) {
    const hit = !want || String(e.message).includes(want);
    if (!hit) failed += 1;
    console.log(`  ${hit ? '막힘  ' : '어긋남'}  ${label}  ${String(e.message).split('\n')[0].slice(0, 70)}`);
  }
}

/* -------------------------------------------------------------------------- */

const users = Object.fromEntries(
  (await all(`select login_code, id, full_name from app_user`))
    .map((u) => [u.login_code, u]));
const admin = users['000000'];
const mgr = users['100200'];
const w1 = users['200100'];
if (!admin || !mgr || !w1) {
  console.log('시연 계정이 없습니다. scripts/seed-demo.mjs 를 먼저 돌리십시오.');
  await c.end();
  process.exit(0);
}
await c.query(`select set_config('app.user_id', $1, false)`, [admin.id]);

if (await val(`select id from item where code = 'CG3100-RAW'`)) {
  console.log('두 번째 품목이 이미 서 있습니다.');
  await c.end();
  process.exit(0);
}

console.log('\n두 번째 품목이 서는가 (§2.0 · §12)\n');
console.log('[설정] DX2401 과 다르게 생긴 품목을 하나 더 세운다');

/* --- 1) 형명 체계. 접두어도 자리 수도 다르다 ------------------------------ */
const scheme = await val(
  `insert into model_scheme (name, prefix, spec_pattern, name_pattern)
   values ('콜라겐 지혈재 완제품', 'CS',
           '지름 {1}mm · 길이 {2}mm · {3}등급',
           '{P} {1}x{2}mm {3}등급')
   returning id`);
await c.query(
  `insert into model_segment (scheme_id, seq, digits, divisor, decimals, label, role)
   values ($1,1,2,1,0,'지름 (mm)','WIDTH'),
          ($1,2,2,1,0,'길이 (mm)','HEIGHT'),
          ($1,3,1,1,0,'등급','BAND')`, [scheme]);
say('형명 체계 CS · 자리 3 (크기 4자리 + 등급 1자리)');

/*
 * 이제 활성 체계가 둘이다. 여기서 생성기에게 체계를 안 주면 거절해야 한다
 * (0086). 조용히 하나를 고르면 두 번째 제품군의 형명이 PD 로 만들어진다.
 */
await refused('체계를 고르지 않은 완제품 생성',
  () => c.query(`select * from generate_finished_items(
                   array['1020'], array['1'], '{}', '콜라겐', 24)`),
  '고르십시오');

const gen = await all(
  `select * from generate_finished_items(
     array['1020','1530','2040'], array['1','2'], array['20402'], '콜라겐', 24, $1)`,
  [scheme]);
say(`완제품 ${gen.rows?.length ?? gen.length}종 생성 (3 크기 × 2 등급 − 뺀 것 1)`);

/* --- 2) 자재 ------------------------------------------------------------- */
const item = (code, name, type, pu, uu, conv = 1) =>
  val(`insert into item (code, name, type, purchase_uom, usage_uom, conversion)
       values ($1,$2,$3,$4,$5,$6) returning id`, [code, name, type, pu, uu, conv]);

const raw = await item('CG3100-RAW', '콜라겐 원액', 'RAW', 'L', 'L');
const rgAcid = await item('CG-RG-01', '희석 산액', 'REAGENT', '통', 'L', 5);
const pouch = await item('CG-PM-01', '지혈재 파우치', 'PACK', 'EA', 'EA');
say('품목 3종 (원재료 · 시약 · 포장재)');

const sup = await val(`select id from supplier where status = 'APPROVED' order by code limit 1`);

/* --- 3) 채번. 품목별 규칙 · 월 초기화 -------------------------------------- */
await c.query(
  `insert into numbering_rule (target, item_id, pattern, reset, seq_width,
                               effective_from, registered_by)
   select 'PRODUCT_LOT', i.id, 'CS-{YY}{MM}-{SEQ:3}', 'MONTHLY', 3, current_date, $1
     from item i where i.code like 'CS%' and i.type = 'FIN'`, [admin.id]);
say(`제조번호 규칙 ${gen.length}건 (품목별 · 월 초기화)`);

/* --- 4) 제품표준서. 장입 범위도 멸균 박스도 다르다 ------------------------- */
const fin = await val(`select id from item where code = 'CS10201'`);
const dm = await val(
  `insert into device_master (item_id, revision, status, effective_from,
                              verified_by, verified_at, license_no,
                              sheet_min, sheet_max, steril_box_qty,
                              expected_units, product_code, product_name, sample_basis)
   values ($1,'Rev.01','ACTIVE',current_date - 20,$2,now(),$3,
           1,8,20,48,'CG3100','콜라겐 지혈재','예시 값 · 검사기준서의 표로 바꾸십시오')
   returning id`,
  [fin, admin.id, '제허 26-9999호 (시험 자료)']);
say('제품표준서 CG3100 Rev.01 · 장입 1~8 · 멸균 박스 20 · 사용기간 24개월');

/* --- 5) 공정. 전부 재단 이전이다 (§12) ------------------------------------- */
const OPS = [
  [1, 'MX-CG31-01', '콜라겐 용해',    1],
  [2, 'MX-CG31-02', '성형·동결',      1],
  [3, 'QC-CG31-01', '반제품 검사',    2],
  [4, 'PK-CG31-01', '포장',           2],
  [5, 'FI-CG31-01', '완제품 검사',    2],
];
const ops = {};
for (const [seq, code, name, day] of OPS) {
  ops[code] = await val(
    `insert into dmr_operation (device_master_id, seq, code, name, after_cutting, typical_day)
     values ($1,$2,$3,$4,false,$5) returning id`, [dm, seq, code, name, day]);
}
say('공정 5 · 재단 이후 공정 0건 (product_lot 이 배치와 1:1 이 된다)');

/* --- 6) 자재 구성표. 장입 구간이 없다 -------------------------------------- */
const unitBom = (op, it, per) =>
  c.query(`insert into dmr_bom (operation_id, component_item_id, basis, qty_per_unit)
           values ($1,$2,'PER_UNIT',$3)`, [op, it, per]);
await unitBom(ops['MX-CG31-01'], rgAcid, 0.05);
await unitBom(ops['PK-CG31-01'], pouch, 1);
say('자재 구성표 2 · 전부 PER_UNIT (SHEET_TIER 0건)');

/* --- 7) 입고 -------------------------------------------------------------- */
const receive = async (it, qty, price) => {
  const lot = await val(`select next_number('MATERIAL_LOT', $1)`, [it]);
  return val(
    `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no, coa_no,
       coa_date, received_at, registered_by, qty_received, qty_available, unit_price)
     values ($1,$2,$3,$4,$5,current_date,now(),$6,$7,$7,$8) returning id`,
    [it, lot, sup, 'SL-' + lot.slice(-4), 'COA-' + lot.slice(-4), admin.id, qty, price]);
};
const rawLot = await receive(raw, 40, 180000);
await receive(rgAcid, 20, 24000);
await receive(pouch, 500, 90);
say('자재 로트 3건');

/* --- 8) 발행. 장입 장수는 제품표준서가 정한 1~8 안이어야 한다 -------------- */
console.log('\n[되묻기] 설정이 실제로 규칙이 되는가');

await refused('장입 30장 발행 (제품표준서는 1~8)', () => as(mgr.id, async () => {
  const woNo = await val(`select next_number('WORK_ORDER')`);
  const bNo = await val(`select next_number('BATCH')`);
  return c.query(
    `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
                             material_lot_id, sheet_count, issued_by_prod, issued_by_qa)
     values ($1,$2,$3,'Rev.01',$4,30,$5,$6)`, [woNo, bNo, dm, rawLot, w1.id, mgr.id]);
}));

const ISSUE_DAYS = 10;
const wo = await as(mgr.id, async () => {
  const woNo = await val(`select next_number('WORK_ORDER')`);
  const bNo = await val(`select next_number('BATCH')`);
  const id = await val(
    `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
                             material_lot_id, sheet_count, issued_by_prod, issued_by_qa,
                             issued_at)
     values ($1,$2,$3,'Rev.01',$4,6,$5,$6,
             timezone('Asia/Seoul',
               (timezone('Asia/Seoul', now()))::date - ${ISSUE_DAYS})) returning id`,
    [woNo, bNo, dm, rawLot, w1.id, mgr.id]);
  return { id, batch_no: bNo };
});
check('장입 6장 발행', true, wo.batch_no);

/* --- 9) 공정 기록. 전 공정이 배치 단위다 ---------------------------------- */
console.log('\n[흐름] 배치 하나를 끝까지');

let clock = 0;
/** 시작 → 자재 → 종료 → 마감. 화면의 네 단추와 같다. */
async function runOp(actor, code, { day, units = 0 }) {
  const op = ops[code];
  const startMin = 480 + clock * 45;
  clock += 1;
  const back = ISSUE_DAYS - day;                     // 발행일 뒤, 오늘 앞
  const at = (min) =>
    `timezone('Asia/Seoul', ((timezone('Asia/Seoul', now()))::date - ${back})`
    + ` + (${min} || ' minutes')::interval)`;

  const pr = await as(actor.id, () => val(
    `insert into process_record (work_order_id, operation_id, attempt, day_no,
       work_date, worker_id, started_at)
     values ($1,$2,1,$3,(timezone('Asia/Seoul', now()))::date - ${back},$4,${at(startMin)})
     returning id`, [wo.id, op, day, actor.id]));

  /*
   * 수량은 패드로 넣는다. required_qty 는 화면이 보여 주는 참고값일 뿐이고
   * (work/[id]/page.tsx 가 units 0 으로 부른다), 적히는 값은 사람이 넣는다.
   * 재단이 없는 품목에서는 PER_UNIT 도 이 자리에서 실수량으로 적힌다.
   */
  for (const b of await all(
    `select b.component_item_id, b.qty_per_unit,
            (select ml.id from material_lot ml
              where ml.item_id = b.component_item_id and ml.status = 'AVAILABLE'
              order by ml.received_at limit 1) as lot_id
       from dmr_bom b where b.operation_id = $1`, [op])) {
    if (!b.lot_id) continue;
    const qty = Number(b.qty_per_unit) * (units || 1);
    await as(actor.id, () => c.query(
      `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
       values ($1,$2,$3,$4)`, [pr, b.lot_id, qty, actor.id]));
  }

  await as(actor.id, () => c.query(
    `update process_record set ended_at = ${at(startMin + 35)} where id = $1`, [pr]));
  await as(actor.id, () => c.query(`select complete_process($1)`, [pr]));
  say(`${code} 마감`);
  return pr;
}

await runOp(w1, 'MX-CG31-01', { day: 1, units: 48 });
await runOp(w1, 'MX-CG31-02', { day: 1 });

/*
 * 제조번호를 부여한다. 재단 공정이 없으므로 이 배치는 제품 로트 하나다.
 * 화면에서는 배치 화면의 같은 단추이고, 부르는 함수도 같다.
 */
const lot = await as(mgr.id, () => val(
  `select cut_product_lot($1,$2,48,3,
     ((timezone('Asia/Seoul', now()))::date - ${ISSUE_DAYS - 1})::date) as id`, [wo.id, fin]));
const lotRow = await one(
  `select lot_no, qty_produced, qty_sample, qty_available, expiry_date::text,
          manufactured_on::text
     from product_lot where id = $1`, [lot]);
say(`제조번호 ${lotRow.lot_no} · 생산 48 · 시료 3 · 유효기한 ${lotRow.expiry_date}`);

await runOp(w1, 'QC-CG31-01', { day: 2 });
await runOp(w1, 'PK-CG31-01', { day: 2, units: 48 });
await runOp(w1, 'FI-CG31-01', { day: 2 });

/** 일차 마감. 기록서를 인쇄하면 그 묶음이 잠긴다 (S04). */
async function closeDay(actor, day) {
  const payload = await all(
    `select pr.id, pr.day_no, o.code, pr.started_at, pr.ended_at
       from process_record pr join dmr_operation o on o.id = pr.operation_id
      where pr.work_order_id = $1 and pr.day_no = $2 and pr.worker_id = $3
      order by o.seq`, [wo.id, day, actor.id]);
  if (payload.length === 0) return;
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await as(actor.id, async () => {
    const seq = await val(
      `select coalesce(max(seq),0) + 1 from record_print
        where kind='DAY_RECORD' and work_order_id=$1 and day_no=$2 and worker_id=$3`,
      [wo.id, day, actor.id]);
    await c.query(
      `insert into record_print (kind, work_order_id, day_no, worker_id, seq, data_hash, printed_by)
       values ('DAY_RECORD',$1,$2,$3,$4,$5,$6)`,
      [wo.id, day, actor.id, seq, hash, actor.id]);
    await c.query(
      `insert into day_lock (work_order_id, day_no, worker_id, locked_by)
       values ($1,$2,$3,$4) on conflict do nothing`, [wo.id, day, actor.id, actor.id]);
  });
  say(`${day}일차 마감 · 기록서 발행`);
}
await closeDay(w1, 1);
await closeDay(w1, 2);

await as(mgr.id, () => c.query(
  `update product_lot set status = 'RELEASE_APPROVED', release_approved_by = '정품질',
          release_approved_on = (timezone('Asia/Seoul', now()))::date
    where id = $1`, [lot]));
await as(mgr.id, () => c.query(
  `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by,
                         release_request_no, unit_from, unit_to)
   values ($1,'세브란스병원',20,(timezone('Asia/Seoul', now()))::date,$2,$3,4,23)`,
  [lot, mgr.id, 'RR-' + wo.batch_no + '-01']));
say('출고 20개 · 세브란스병원');

/* --- 10) 되묻기 ----------------------------------------------------------- */
console.log('\n[되묻기] 두 체계가 서로를 밟지 않는가');

const csSpec = await val(`select spec_label('CS10201')`);
const pdSpec = await val(`select spec_label('PD05050510')`);
check('CS 규격 문구', csSpec === '지름 10mm · 길이 20mm · 1등급', `"${csSpec}"`);
check('PD 규격 문구가 그대로', pdSpec === '5x5cm · 두께 0.5~1.0mm', `"${pdSpec}"`);

const csName = await val(`select name from item where code = 'CS10201'`);
check('완제품 이름이 CS 틀에서 나옴', /^콜라겐 10x20mm 1등급$/.test(csName), `"${csName}"`);

const mm = String(new Date().getMonth() + 1).padStart(2, '0');
check('제조번호가 품목별 규칙을 탐',
  new RegExp(`^CS-\\d{2}${mm}-\\d{3}$`).test(lotRow.lot_no), lotRow.lot_no);

const months = Math.round(
  (new Date(lotRow.expiry_date) - new Date(lotRow.manufactured_on)) / 86400000 / 30.44);
check('사용기간 24개월이 로트에 굳음', months === 24, `${months}개월`);

const plCount = await val(
  `select count(*)::int from product_lot where work_order_id = $1`, [wo.id]);
check('재단이 없으면 배치와 제품 로트가 1:1 (§12)', plCount === 1, `${plCount}건`);

const acCount = await val(
  `select count(*)::int from dmr_operation where device_master_id = $1 and after_cutting`, [dm]);
check('재단 이후 공정 0건으로도 흐름', acCount === 0);

/*
 * 계보는 두 갈래로 성립한다 (§3 · §5).
 *
 * 투입 자재는 material_issue 를 거쳐 v_lot_genealogy 에 뜨고, **원재료는 거기
 * 없다** - 지시서에 이미 지정되어 있어 자재 구성표에 넣지 않기 때문이다.
 * 원재료는 product_lot → work_order → material_lot 로 닿는다.
 *
 * 처음에 이 검사를 한 갈래로만 짜서 "계보가 안 닿는다" 를 냈다. 안 닿은 것이
 * 아니라 다른 길로 닿아 있었다.
 */
const gene = await all(
  `select distinct item_code from v_lot_genealogy
    where work_order_id = $1 order by item_code`, [wo.id]);
check('투입 자재가 계보에 뜸',
  gene.length === 2 && gene.every((g) => /^CG-(RG|PM)-01$/.test(g.item_code)),
  gene.map((g) => g.item_code).join(' · '));

const rawBack = await one(
  `select i.code, ml.lot_no from product_lot pl
     join work_order w on w.id = pl.work_order_id
     join material_lot ml on ml.id = w.material_lot_id
     join item i on i.id = ml.item_id
    where pl.id = $1`, [lot]);
check('제조번호에서 원재료 로트로 역추적 (§3)',
  rawBack?.code === 'CG3100-RAW', rawBack?.lot_no ?? '못 닿음');

const tiers = await val(
  `select count(*)::int from dmr_bom b join dmr_bom_tier t on t.dmr_bom_id = b.id
    join dmr_operation o on o.id = b.operation_id where o.device_master_id = $1`, [dm]);
check('장입 구간 0건으로도 발행과 기록이 됨', tiers === 0);

const warn = await all(`select * from work_order_warnings($1,6,$2)`, [dm, rawLot]);
check('장입 6장에 상한 경고 없음', !warn.some((w) => /장입/.test(w.message ?? '')),
  `경고 ${warn.length}건`);

await refused('잠긴 묶음의 기록 수정 (S04)', () => as(w1.id, () => c.query(
  `update process_record set ended_at = now()
    where work_order_id = $1 and day_no = 1`, [wo.id])), 'S04');

/* -------------------------------------------------------------------------- */
await c.end();

console.log(failed === 0
  ? `\n되물음 ${asked}가지 전건. DX2401 과 다르게 생긴 품목이 설정만으로 섭니다.\n`
  : `\n되물음 ${asked}가지 중 ${failed}가지가 어긋났습니다.\n`);
process.exit(failed === 0 ? 0 : 1);
