// =============================================================================
// seed-demo.mjs · 시연·시험용 기준정보
//
//   npm run seed:demo
//
// DX2401 공정 구조(§3)를 그대로 세운다. 크기·두께·소요량은 구조를 보여 주기
// 위한 값이지 제품표준서의 실값이 아니다. 실값은 관리 화면으로 넣는다.
//
// 이미 있는 코드는 건드리지 않으므로 여러 번 돌려도 안전하다.
// 운영 DB에 돌리지 말 것.
// =============================================================================

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { randomInt } from 'node:crypto';
import { hashPin } from './pin.mjs';
import { pgSsl } from './pgssl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env.local', '.env.deploy']) {
  const p = path.join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const URL_ = process.env.DATABASE_URL;
if (!URL_) { console.error('DATABASE_URL이 없다.'); process.exit(2); }
if (!/@(localhost|127\.0\.0\.1)/.test(URL_) && process.env.SEED_DEMO_FORCE !== '1') {
  console.error(
    '원격 DB로 보인다. 시연 자료는 로컬에만 넣는다.\n' +
    '정말 필요하면 SEED_DEMO_FORCE=1 을 세우고 다시 실행할 것.');
  process.exit(2);
}

const c = new pg.Client({ connectionString: URL_, ssl: pgSsl(URL_, ROOT) });
await c.connect();

const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const val = async (sql, p = []) => {
  const r = await c.query(sql, p);
  return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
};

const admin = await val(`select id from app_user order by login_code limit 1`);
if (!admin) { console.error('계정이 없다. npm run dev 로 초기 관리자를 먼저 만들 것.'); process.exit(1); }
await c.query(`select set_config('app.user_id', $1, false)`, [admin]);

/*
 * 시연 계정의 비밀번호.
 *
 * 전에는 여기에 상수로 박아 두었다. 시연 자료는 언제든 다시 만드는 것이라
 * 값을 가릴 이유가 없다고 보았는데, 그 판단이 틀렸다. 이 파일은 공개
 * 저장소에 있고, 같은 스크립트가 운영 DB 에도 한 번 돌았다. 사번 목록과
 * 비밀번호가 인터넷에 그대로 놓여 있었다 (감사 지적 1).
 *
 * 이제는 실행할 때마다 만든다. 저장소에는 값이 남지 않는다. 화면을 옮겨
 * 다니며 확인해야 하니 콘솔에는 한 번 찍고, 다시 보려면 다시 시드한다.
 *
 * 같은 값으로 고정해 두고 싶으면 DEMO_PIN 을 세워 실행한다. 그 값도
 * 저장소가 아니라 각자의 환경에 둔다.
 */
const DEMO_PIN = process.env.DEMO_PIN || String(randomInt(100000, 1000000));

// --- 사용자 -------------------------------------------------------------------
const user = async (code, name, roles, pin) => {
  const hash = pin ? await hashPin(pin) : null;
  let id = await val(`select id from app_user where login_code = $1`, [code]);
  if (id) {
    /*
     * 이미 있으면 비밀번호를 이번 값으로 맞춘다. 맞추지 않으면 콘솔에 찍힌
     * 값과 실제 값이 갈라져, 적어 둔 번호로 들어가지 못한다.
     */
    if (hash) await c.query(`update app_user set pin_hash = $2 where id = $1`, [id, hash]);
  } else {
    id = await val(
      `insert into app_user (login_code, full_name, pin_hash, can_login)
       values ($1,$2,$3,$4) returning id`,
      [code, name, hash, !!pin]);
  }
  for (const r of roles) {
    await c.query(
      `insert into user_role (user_id, role) values ($1,$2::role_code)
       on conflict do nothing`, [id, r]);
  }
  return id;
};

// 개발 계정의 비밀번호는 deploy-db 가 무작위로 만든다. 시연 자료는 매번 같은
// 상태에서 시작해야 하므로 여기서 알려진 값으로 덮는다. 위의 localhost 검사를
// 통과한 경우에만 여기까지 온다.
await c.query(
  `update app_user set login_code = '000000', full_name = '개발 계정',
          is_developer = true, pin_hash = $2
    where id = $1`,
  [admin, await hashPin(DEMO_PIN)]);
await c.query(
  `insert into user_role (user_id, role) values ($1,'SYS_ADMIN')
   on conflict do nothing`, [admin]);

// 사번 6자리. 실제 사번 체계로 바꿔 넣으면 된다.
await user('100200', '박생산관리', ['PROD_MGR'], DEMO_PIN);
await user('200100', '김작업', ['WORKER'], DEMO_PIN);
await user('200200', '이작업', ['WORKER'], DEMO_PIN);
await user('900100', '정품질책임', ['QP'], null);   // QP는 로그인하지 않는다
/*
 * 열람 계정. 진행 상황을 보기만 한다.
 *
 * 이 계정으로는 아무것도 쓰지 못한다. 화면에서 단추를 감추는 것과 별개로
 * DB 세션이 읽기 전용 역할로 돈다 (app_readonly · 0043). 인쇄도 막힌다 -
 * 인쇄는 기록을 남기고 제조기록서는 그 묶음을 잠근다.
 */
await user('800100', '대표 열람', ['VIEWER'], DEMO_PIN);
console.log('사용자 4명');

// --- 공급자 -------------------------------------------------------------------
const supplier = async (code, name, status, until) =>
  val(`insert into supplier (code, name, status, approved_until)
       values ($1,$2,$3,$4::date)
       on conflict (code) do update set name = excluded.name
       returning id`, [code, name, status, until]);

const supA = await supplier('SUP-001', '한국바이오소재', 'APPROVED', '2027-12-31');
const supB = await supplier('SUP-002', '대한시약', 'APPROVED', '2027-06-30');
const supC = await supplier('SUP-003', '신규포장', 'PENDING', null);
console.log('공급자 3곳');

// --- 품목 ---------------------------------------------------------------------
const item = async (code, name, type, pu, uu, conv = 1, min = null, lead = null) =>
  val(`insert into item (code, name, type, purchase_uom, usage_uom, conversion,
                         min_stock, lead_days)
       values ($1,$2,$3::item_type,$4,$5,$6,$7,$8)
       on conflict (code) do update set name = excluded.name
       returning id`, [code, name, type, pu, uu, conv, min, lead]);

const raw     = await item('RM-006', '돈피 원재료', 'RAW', '장', '장', 1, 20, 30);
const rgAlk   = await item('RG-001', '알칼리 시약', 'REAGENT', '통', '통', 1, 6, 14);
const rgH2O2  = await item('RG-002', 'H₂O₂ 시약', 'REAGENT', '통', '통', 1, 6, 14);
const rgNaCl  = await item('RG-003', 'NaCl', 'REAGENT', '포', 'kg', 25, 50, 10);
const rgEtOH  = await item('RG-004', '에탄올', 'REAGENT', '통', 'L', 20, 40, 10);
const pbs     = await item('RG-005', '20× PBS 원액', 'REAGENT', '통', 'L', 20, 20, 10);
const tyvek   = await item('PM-001', '타이백 파우치', 'PACK', 'EA', 'EA', 1, 100, 21);
const pouch   = await item('PM-002', '내포장 파우치', 'PACK', 'EA', 'EA', 1, 300, 21);
const label   = await item('PM-003', '제품 라벨', 'PACK', 'EA', 'EA', 1, 500, 14);
const box     = await item('PM-004', '멸균 박스', 'PACK', 'EA', 'EA', 1, 30, 21);

const gen = await c.query(
  `select * from generate_finished_items(
     array['0505','0510','1010','1015','1018','1215','1520','2020'],
     array['0510','1015','1520','2025','2530'],
     array['10152530','10182530','12152530'])`);
console.log(`품목 ${10 + gen.rows.length}종 (완제품 ${gen.rows.length}종 생성)`);

// --- 단가 ---------------------------------------------------------------------
const price = async (it, sup, p) => {
  await c.query(
    `insert into price_history (item_id, supplier_id, price, effective_from, registered_by)
     values ($1,$2,$3,current_date,$4)`, [it, sup, p, admin]);
  await c.query(
    `insert into item_supplier (item_id, supplier_id, current_price) values ($1,$2,$3)
     on conflict (item_id, supplier_id) do update set current_price = excluded.current_price`,
    [it, sup, p]);
};
await price(raw, supA, 22000);
await price(rgAlk, supB, 48000);
await price(rgH2O2, supB, 52000);
await price(tyvek, supC, 320);
await price(pouch, supC, 140);
await price(label, supC, 60);
console.log('단가 6건');

// --- 채번 규칙 ----------------------------------------------------------------
const rule = (target, pattern, width, reset = 'YEARLY') =>
  c.query(
    `insert into numbering_rule (target, pattern, reset, seq_width, effective_from, registered_by)
     values ($1::numbering_target,$2,$3::reset_cycle,$4,current_date,$5)
     on conflict do nothing`, [target, pattern, reset, width, admin]);
await rule('MATERIAL_LOT', 'ML-{YY}{MM}-{SEQ:4}', 4);
await rule('WORK_ORDER',   'WO-{YY}{MM}-{SEQ:4}', 4);
await rule('BATCH',        'B{YY}{MM}-{SEQ:4}', 4);
await rule('PRODUCT_LOT',  'P{YY}{MM}-{SEQ:4}', 4);
await rule('STERIL_BATCH', 'ST-{YY}{MM}-{SEQ:3}', 3);
await rule('DEVIATION',    'DV-{YY}-{SEQ:3}', 3);
console.log('채번 규칙 6종');

// --- 제품표준서 ---------------------------------------------------------------
const fin = await val(`select id from item where code = 'PD05050510'`);
let dm = await val(`select id from device_master where item_id = $1 and revision = 'Rev.02'`, [fin]);
if (!dm) {
  dm = await val(
    `insert into device_master (item_id, revision, status, effective_from, verified_by, verified_at)
     values ($1,'Rev.02','ACTIVE',current_date,$2,now()) returning id`, [fin, admin]);

  /*
   * 마지막 칸은 보통 몇 일차에 하는 공정인가다. 참고값이라 실제 기록 일차를
   * 제약하지 않는다. 아래 배분은 흐름을 보이기 위한 예시이며, 실제 값은
   * 생산관리자가 제품 등록 화면에서 넣는다.
   */
  const OPS = [
    [1,  'WS-DX2401-01', 'NaCl 처리·세척', false, 1],
    [2,  'WS-DX2401-02', '초임계 가공',     false, 1],
    [3,  'WS-DX2401-03', '알칼리 처리',     false, 2],
    [4,  'WS-DX2401-04', 'H₂O₂ 처리',       false, 2],
    [5,  'WS-DX2401-05', '세척',            false, 2],
    [6,  'WS-DX2401-06', '동결건조',        false, 3],
    [7,  'PI-DX2401-01', '1차 반제품 검사', false, 4],
    [8,  'WS-DX2401-07', '재단',            false, 4],
    [9,  'WS-DX2401-08', '포장(1·2차)',     true , 5],
    [10, 'PI-DX2401-02', '2차 반제품 검사', true , 5],
    [11, 'WS-DX2401-09', '멸균(외부 위탁)', true , 6],
    [12, 'FI-DX2401-01', '완제품 검사',     true , 7],
  ];
  const ops = {};
  for (const [seq, code, name, ac, day] of OPS) {
    ops[code] = await val(
      `insert into dmr_operation
         (device_master_id, seq, code, name, after_cutting, typical_day)
       values ($1,$2,$3,$4,$5,$6) returning id`, [dm, seq, code, name, ac, day]);
  }

  const TIER3 = [[1,10,1],[11,20,2],[21,30,3]];                       // 시약 10장 단위
  const TIER6 = [[1,5,1],[6,10,2],[11,15,3],[16,20,4],[21,25,5],[26,30,6]]; // 타이백 5장 단위

  const tierBom = async (op, it, tiers) => {
    const b = await val(
      `insert into dmr_bom (operation_id, component_item_id, basis)
       values ($1,$2,'SHEET_TIER') returning id`, [op, it]);
    for (const [lo, hi, q] of tiers) {
      await c.query(
        `insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
         values ($1,$2,$3,$4)`, [b, lo, hi, q]);
    }
  };
  const unitBom = (op, it, per) =>
    c.query(`insert into dmr_bom (operation_id, component_item_id, basis, qty_per_unit)
             values ($1,$2,'PER_UNIT',$3)`, [op, it, per]);

  await tierBom(ops['WS-DX2401-01'], rgNaCl, TIER3);
  await tierBom(ops['WS-DX2401-03'], rgAlk,  TIER3);
  await tierBom(ops['WS-DX2401-04'], rgH2O2, TIER3);
  await tierBom(ops['WS-DX2401-05'], rgEtOH, TIER3);
  await tierBom(ops['WS-DX2401-08'], tyvek,  TIER6);
  await unitBom(ops['WS-DX2401-08'], pouch, 1);
  await unitBom(ops['WS-DX2401-08'], label, 2);
  await unitBom(ops['WS-DX2401-09'], box, 0.02);   // 50개 박스 하나
  // 배치당 예상 생산수량 (계획 참고값). 시연 재단 실적 120+60+24 와 같게
  // 제품 최상위 관리 코드. 형명(PD…)은 그 아래의 규격이다
  await c.query(
    `update device_master
        set expected_units = 204,
            product_code = 'DX2401', product_name = '돈피 진피',
            sample_basis = '예시 값 · 실제 검사기준서의 표로 바꾸십시오'
      where id = $1`, [dm]);

  /*
   * 완제품검사 시료 채취 기준. 생산 수량 구간별 시료 수다.
   *
   * 아래 숫자는 구조를 보이기 위한 예시다. 실제 값은 검사기준서의 표를 그대로
   * 옮겨야 하며, 근거 문구도 그 문서 번호로 바꿔야 한다. 시스템이 정하지 않는다.
   */
  for (const [lo, hi, n] of [[1, 50, 3], [51, 150, 5], [151, null, 8]]) {
    await c.query(
      `insert into sample_plan (device_master_id, min_qty, max_qty, sample_qty, registered_by)
       values ($1,$2,$3,$4,$5)
       on conflict (device_master_id, min_qty)
         do update set max_qty = excluded.max_qty, sample_qty = excluded.sample_qty`,
      [dm, lo, hi, n, admin]);
  }
  console.log('제품표준서 Rev.02 · 공정 12 · 자재 구성표 8 · 예상 204개 · 시료 구간 3');

  /*
   * 설비.
   *
   * 공정에 걸어 두면 현장 화면이 그 공정에 걸린 것만 타일로 보여 준다.
   * 고르는 것을 강제하지 않는다 - 차단은 S01~S05 뿐이다.
   */
  const eq = {};
  for (const [code, name, note, at] of [
    ['SC-01', '초임계 가공 장비',   'CO₂ 초임계', ['WS-DX2401-02']],
    ['MX-01', '교반기 1호',         null,         ['WS-DX2401-01', 'WS-DX2401-03']],
    ['MX-02', '교반기 2호',         null,         ['WS-DX2401-04', 'WS-DX2401-05']],
    ['FD-01', '동결건조기',         null,         ['WS-DX2401-06']],
    ['CT-01', '재단기',             null,         ['WS-DX2401-07']],
    ['SL-01', '실링기',             '1·2차 포장', ['WS-DX2401-08']],
  ]) {
    eq[code] = await val(
      `insert into equipment (code, name, note) values ($1,$2,$3) returning id`,
      [code, name, note]);
    for (const opCode of at) {
      await c.query(
        `insert into operation_equipment (operation_id, equipment_id) values ($1,$2)`,
        [ops[opCode], eq[code]]);
    }
  }
  console.log('설비 6 · 공정 연결 7');

  /*
   * 밸리데이션 이력. 서면 보고서 번호가 근거다.
   * 전부 유효하게 둔다 - 시연 자료가 처음부터 검토 지원에 걸리면 그 표시가
   * 소음이 된다. 기한 경과 화면은 지난 날짜로 하나 등록해 보이면 된다.
   */
  let vi = 0;
  for (const code of Object.keys(eq)) {
    vi += 1;
    await c.query(
      `insert into equipment_validation
         (equipment_id, performed_on, valid_until, report_no, registered_by)
       select $1, date '2026-07-01', date '2027-06-30', $2, $3
        where not exists (select 1 from equipment_validation
                           where equipment_id = $1 and report_no = $2)`,
      [eq[code], `VAL-2026-${String(vi).padStart(3, '0')}`, admin]);
  }
  console.log('밸리데이션 이력 6');
}

// --- 자재 입고 ----------------------------------------------------------------
const receive = async (it, sup, qty, price, opts = {}) => {
  const lot = await val(`select next_number('MATERIAL_LOT', $1)`, [it]);
  return val(
    `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no, coa_no,
       coa_date, received_at, registered_by, qty_received, qty_available, unit_price,
       expiry_date, location, thickness_band)
     values ($1,$2,$3,$4,$5,current_date,now(),$6,$7,$7,$8,$9::date,$10,$11)
     returning id`,
    [it, lot, sup, opts.slot ?? 'SL-' + lot.slice(-4), opts.coa ?? 'COA-' + lot.slice(-4),
     admin, qty, price, opts.expiry ?? null, opts.loc ?? null, opts.band ?? null]);
};

const have = await val(`select count(*)::int from material_lot`);
if (Number(have) === 0) {
  await receive(raw, supA, 30, 22000, { band: '0510', loc: '냉장-1', expiry: '2027-02-28' });
  await receive(raw, supA, 28, 22500, { band: '1015', loc: '냉장-2', expiry: '2027-03-31' });
  await receive(rgAlk, supB, 8, 48000, { loc: '시약장-A', expiry: '2027-01-31' });
  await receive(rgH2O2, supB, 8, 52000, { loc: '시약장-A', expiry: '2026-10-31' });
  await receive(rgNaCl, supB, 100, 3200, { loc: '시약장-B' });
  await receive(rgEtOH, supB, 60, 4800, { loc: '시약장-B' });
  await receive(pbs, supB, 40, 9000, { loc: '시약장-B' });
  await receive(tyvek, supC, 200, 320, { loc: '포장-1' });
  await receive(pouch, supC, 600, 140, { loc: '포장-1' });
  await receive(label, supC, 1000, 60, { loc: '포장-2' });
  await receive(box, supC, 60, 2400, { loc: '포장-2' });
  console.log('자재 로트 11건');
}

// --- 발주 ---------------------------------------------------------------------
await c.query(
  `insert into purchase_order (po_no, item_id, supplier_id, qty, unit_price,
     ordered_at, expected_at, ordered_by)
   values ('PO-2026-001',$1,$2,20,22000,current_date,current_date+30,$3)
   on conflict (po_no) do nothing`, [raw, supA, admin]);

console.log('\n완료. 로그인 계정');

console.log('  000000  개발 계정   시스템관리자');
console.log('  100200  박생산관리  생산관리자');
console.log('  200100  김작업      작업자');
console.log('  200200  이작업      작업자');
console.log('  800100  대표 열람   열람자');
console.log('  900100  정품질책임  품질책임자     로그인하지 않는다');
console.log(`
  이번 시드의 비밀번호  ${DEMO_PIN}   (지금 적어 둘 것. 다시 볼 수 없다)`);

await c.end();
