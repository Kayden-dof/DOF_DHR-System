/* ---------------------------------------------------------------------------
   설정이 화면에서 **저장되는가** (§2.0)

     npm run save

   ── 왜 따로 묻는가 ───────────────────────────────────────────────────────
   §2.0 은 "다른 제조소가 코드를 고치지 않고 받아 쓸 수 있는가" 를 묻는다.
   그 답은 사람이 화면에서 설정을 넣을 수 있어야 성립하는데, 그것을 묻는 시험이
   없었다 (7차 감사 2026-09-16).

     npm run settings   열마다 화면에 칸이 있는지 본다. **저장은 안 본다**
     npm run smoke      화면이 그려지는지 본다. **POST 를 한 번도 안 한다**
     npm run fresh      자료가 서고 흐르는지 본다. **씨앗이 SQL 로 넣는다**

   셋 다 화면의 저장 경로를 지나지 않는다. 칸이 있고 화면이 그려지는데 저장이
   안 되면, 그 제조소는 첫날 그 화면에서 막히고 우리는 그것을 모른다.

   ── 무엇을 고르는가 ──────────────────────────────────────────────────────
   **코드에 박혀 있다가 설정으로 옮긴 값들**을 고른다. 그것들이 §2.0 이 실제로
   가리키는 자리이고, 되돌아갈 위험이 가장 큰 자리다.

     회사 표시 · 장입 범위 · 멸균 박스 수량 · 형명 체계 · 형명 자리 ·
     공수 단가 · 단가 · 사용기간 · 공정에 걸린 설비 · 제품표준서 기본정보

   설정은 아니지만 화면의 저장 경로를 지나야 하는 길이 하나 더 있다 - 원액 제조.
   원액 로트와 원료 줄을 한 번에 세우는 유일한 입구이고, 이 사례만 되돌리지
   않는다 (아래).

   ── 되돌린다. 다만 이력은 두고 간다 ──────────────────────────────────────
   기준정보는 시험이 바꾼 값을 원래대로 되돌린다. 이력 표(단가 · 사용기간 ·
   공수)는 새 행이 쌓이는 구조이고 기록은 지우지 않으므로(§10) 그대로 둔다 -
   늘어난 줄이 곧 "저장되었다" 는 증거다.

   감사추적에는 시험이 만진 자국이 남는다. 그래서 **localhost 만 본다.**
--------------------------------------------------------------------------- */
import pg from 'pg';
import { pgSsl } from './pgssl.mjs';
import { sessionCookie } from './session-cookie.mjs';
import { submitForm } from './form-post.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3100';

if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE)) {
  console.error('이 시험은 설정 값을 바꿔 보고 되돌립니다.');
  console.error(`  대상: ${BASE}`);
  console.error('');
  console.error('localhost 가 아닌 곳을 가리킬 수 없습니다.');
  process.exit(2);
}

const url = process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url, ssl: pgSsl(url, process.cwd()) });
await c.connect();
const rows = async (s, p = []) => (await c.query(s, p)).rows;
const v = async (s, p = []) => Object.values((await rows(s, p))[0] ?? {})[0];

let bad = 0;
const ok = (cond, what, extra = '') => {
  if (!cond) bad += 1;
  console.log(`  ${cond ? '저장됨' : '★ 안 됨'}  ${what}${extra ? ' · ' + extra : ''}`);
};

const admin = await v(
  `select u.id from app_user u join user_role r on r.user_id = u.id
    where r.role = 'SYS_ADMIN' and u.can_login limit 1`);
if (!admin) { console.error('시스템관리자 계정이 없습니다'); process.exit(2); }
const CK = sessionCookie(admin);

/* 액션이 돌고 화면이 다시 그려질 틈을 준다 */
const settle = () => new Promise((r) => setTimeout(r, 900));

/**
 * 폼을 보내고 DB 가 바뀌었는지 본다. 바꾼 값은 되돌린다.
 *
 * @param read  지금 값을 읽는 함수
 * @param probe 넣어 볼 값 (지금 값과 달라야 뜻이 있다)
 */
async function roundTrip(label, path, want, field, read, probe) {
  const before = await read();
  const r = await submitForm(BASE, path, CK, want, { [field]: probe });
  if (!r.ok) { ok(false, label, r.reason ?? `HTTP ${r.status}`); return; }
  await settle();
  const after = await read();
  ok(String(after) === String(probe), label, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

  /* 되돌린다. 원래 값이 비어 있었으면 그대로 둔다 */
  if (before !== null && before !== undefined && before !== '') {
    await submitForm(BASE, path, CK, want, { [field]: before });
    await settle();
  }
}

console.log('\n설정이 화면에서 저장되는가 (§2.0)\n');

/* ── 회사 표시 (5차 감사 D1) ─────────────────────────────────────────── */
await roundTrip(
  '회사 표시 · 이름', '/settings/brand',
  ['company_name', 'brand_color'], 'company_name',
  () => v('select company_name from org_brand limit 1'),
  '저장 시험 제조소');

/* ── 장입 범위 · 멸균 박스 (B1 · B3 · 0069) ──────────────────────────── */
const dm = await v(
  `select id from device_master order by (status = 'ACTIVE') desc, effective_from desc nulls last limit 1`);
if (!dm) {
  console.log('  건너뜀  제품표준서가 없습니다 (장입 범위 · 멸균 박스)');
} else {
  const cur = (await rows(
    'select sheet_min, sheet_max, steril_box_qty from device_master where id = $1', [dm]))[0];
  await roundTrip(
    '제품표준서 · 장입 상한', `/settings/dmr?dm=${dm}`,
    ['sheet_min', 'sheet_max', 'load_unit', 'steril_box_qty'], 'sheet_max',
    () => v('select sheet_max from device_master where id = $1', [dm]),
    Number(cur.sheet_max ?? 30) + 7);
  await roundTrip(
    '제품표준서 · 멸균 박스 수량', `/settings/dmr?dm=${dm}`,
    ['sheet_min', 'sheet_max', 'load_unit', 'steril_box_qty'], 'steril_box_qty',
    () => v('select steril_box_qty from device_master where id = $1', [dm]),
    Number(cur.steril_box_qty ?? 50) + 3);
  /*
   * 허가 번호는 **발행된 적 없는 개정**에서 시험한다.
   *
   * 라벨에 찍히는 값이라 배치가 나간 뒤에는 DB 가 막는다 (§2.1 · 0095) -
   * 바꾸면 이미 나간 배치의 라벨요청서가 다른 번호를 낸다. 그 거절은 맞는
   * 동작이므로, 여기서 잡으면 제품이 아니라 시험이 틀린 것이다.
   */
  const draft = await v(
    `select dm.id from device_master dm
      where not exists (select 1 from work_order wo where wo.device_master_id = dm.id)
      order by dm.effective_from desc nulls last limit 1`);
  if (!draft) {
    console.log('  건너뜀  발행된 적 없는 제품표준서가 없습니다 (허가 번호)');
  } else {
    await roundTrip(
      '제품표준서 · 허가 번호', `/settings/dmr?dm=${draft}`,
      ['product_code', 'product_name', 'license_no'], 'license_no',
      () => v('select license_no from device_master where id = $1', [draft]),
      '허가-저장시험');
  }
}

/* ── 형명 체계 (B2 · 0075) ───────────────────────────────────────────── */
const scheme = await v('select id from model_scheme order by id limit 1');
if (!scheme) {
  console.log('  건너뜀  형명 체계가 없습니다');
} else {
  await roundTrip(
    '형명 체계 · 이름', '/settings/model',
    ['id', 'name', 'prefix', 'spec_pattern'], 'name',
    () => v('select name from model_scheme where id = $1', [scheme]),
    '저장 시험 체계');
}

/* ── 공수 단가 (0076) · 이력이라 되돌리지 않는다 ─────────────────────── */
{
  const before = await v('select count(*)::int from labour_rate');
  const r = await submitForm(BASE, '/settings/users', CK,
    ['role', 'hourly_rate', 'effective_from'],
    { hourly_rate: 12345, effective_from: new Date().toISOString().slice(0, 10) });
  await settle();
  const after = await v('select count(*)::int from labour_rate');
  ok(r.ok && after > before, '공수 단가 (이력 추가)', `${before} → ${after}줄`);
}

/* ── 단가 · 사용기간 (§4.2) · 이력이라 되돌리지 않는다 ───────────────── */
{
  const pair = (await rows(
    `select i.id as item_id, s.id as supplier_id from item i, supplier s
      where i.type <> 'FIN' limit 1`))[0];
  if (!pair) {
    console.log('  건너뜀  품목이나 공급자가 없습니다 (단가)');
  } else {
    const before = await v('select count(*)::int from price_history');
    const r = await submitForm(BASE, '/settings/suppliers', CK,
      ['item_id', 'supplier_id', 'price', 'effective_from'],
      { item_id: pair.item_id, supplier_id: pair.supplier_id, price: 777,
        effective_from: new Date().toISOString().slice(0, 10) });
    await settle();
    const after = await v('select count(*)::int from price_history');
    ok(r.ok && after > before, '공급자 단가 (이력 추가)', `${before} → ${after}줄`);
  }

  const fin = await v("select id from item where type = 'FIN' limit 1");
  if (!fin) {
    console.log('  건너뜀  완제품이 없습니다 (사용기간)');
  } else {
    const before = await v('select count(*)::int from shelf_life_history');
    const today = new Date().toISOString().slice(0, 10);
    const r = await submitForm(BASE, '/settings/suppliers', CK,
      ['item_id', 'months', 'effective_from', 'study_report_no', 'study_date'],
      { item_id: fin, months: 18, effective_from: today,
        study_report_no: 'STB-저장시험', study_date: today });
    await settle();
    const after = await v('select count(*)::int from shelf_life_history');
    ok(r.ok && after > before, '완제품 사용기간 (이력 추가)', `${before} → ${after}줄`);

    /*
     * 시험 일자까지 들어갔는가 (7차 감사).
     *
     * 동작은 이 값을 읽고 있었는데 폼에 칸이 없어, 어느 행에도 들어간 적이
     * 없었다. 칸이 다시 사라지면 여기서 걸린다.
     */
    ok(await v(`select study_date is not null from shelf_life_history
                 order by registered_at desc limit 1`),
       '사용기간 · 시험 일자');
  }
}

/* ── 공정에 걸린 설비 (0107) ─────────────────────────────────────────── */
{
  const link = (await rows(
    `select oe.equipment_id, oe.operation_id, oe.is_active
       from operation_equipment oe limit 1`))[0];
  if (!link) {
    console.log('  건너뜀  공정에 걸린 설비가 없습니다');
  } else {
    const read = () => v(
      `select is_active from operation_equipment
        where equipment_id = $1 and operation_id = $2`,
      [link.equipment_id, link.operation_id]);
    const before = await read();
    const r = await submitForm(BASE, '/equipment', CK,
      ['equipment_id', 'operation_id', 'on'],
      { equipment_id: link.equipment_id, operation_id: link.operation_id,
        on: before ? '0' : '1' });
    await settle();
    const after = await read();
    ok(r.ok && after !== before, '공정에 걸린 설비', `${before} → ${after}`);
    /* 되돌린다 */
    await submitForm(BASE, '/equipment', CK, ['equipment_id', 'operation_id', 'on'],
      { equipment_id: link.equipment_id, operation_id: link.operation_id,
        on: before ? '1' : '0' });
    await settle();
  }
}

/* ── 원액 제조 (0119) · 이력이라 되돌리지 않는다 ─────────────────────── */
/*
 * 원액 로트와 원료 줄은 지울 수 없다 (S03). 되돌릴 길이 없으므로 시험이 만든
 * 것은 개발 DB 에 남는다 - 마지막에 그렇다고 찍는다.
 *
 * 원료는 이 사례가 스스로 세운다. 시연 자료의 재고를 줄이지 않으려는 것이고,
 * 같은 로트가 남아 있으면 다시 쓴다 (돌릴 때마다 로트가 쌓이지 않게).
 * 번호는 공통 자재 로트 규칙이 낸다 - 화면이 부르는 길 그대로다.
 */
{
  const today = await v(`select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD')`);
  /* 시험이 SQL 로 세우는 줄도 감사추적에 "누가" 가 남게 한다 */
  await c.query(`select set_config('app.user_id', $1, false)`, [admin]);

  const ensureItem = async (code, name, type, uom, months) => {
    const cur = (await rows(
      'select id, type::text as type from item where code = $1', [code]))[0];
    if (cur) return cur;
    return (await rows(
      `insert into item (code, name, type, purchase_uom, usage_uom, conversion, shelf_life_months)
       values ($1, $2, $3::item_type, $4, $4, 1, $5) returning id, type::text as type`,
      [code, name, type, uom, months]))[0];
  };
  const sol = await ensureItem('SL-SAVE', '저장 시험 원액', 'SOLUTION', 'L', 6);
  const rawA = await ensureItem('SL-SAVE-A', '저장 시험 원료 A', 'REAGENT', 'g', null);
  const rawB = await ensureItem('SL-SAVE-B', '저장 시험 원료 B', 'REAGENT', 'g', null);

  /* 모자라면 새로 세운다. 단가가 있어야 원액 단가가 계산된다 */
  const rawLot = async (item, price, need) => {
    const hit = await v(
      `select id from material_lot
        where item_id = $1 and status = 'AVAILABLE' and qty_available >= $2
        order by lot_no limit 1`, [item.id, need]);
    if (hit) return hit;
    const tag = await v(`select to_char(clock_timestamp(), 'YYMMDDHH24MISSMS')`);
    const sup = await v('select id from supplier order by code limit 1');
    return v(
      `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no, coa_no,
         coa_date, received_at, registered_by, qty_received, qty_available, unit_price)
       values ($1, $2, $3, $4, $5, $6::date, now(), $7, 100, 100, $8) returning id`,
      [item.id, `SAVE-${tag}`, sup, `SAVE-S-${tag}`, `SAVE-C-${tag}`, today, admin, price]);
  };

  if (sol.type !== 'SOLUTION') {
    ok(false, '원액 제조', `SL-SAVE 품목의 유형이 원액이 아닙니다 (${sol.type})`);
  } else {
    const lotA = await rawLot(rawA, 10, 2);
    const lotB = await rawLot(rawB, 20, 1);
    const stockBefore = (await rows(
      'select id, qty_available from material_lot where id = any($1::uuid[])', [[lotA, lotB]]))
      .reduce((m, r) => m.set(r.id, Number(r.qty_available)), new Map());
    const known = (await rows(
      'select id from material_lot where item_id = $1', [sol.id])).map((r) => r.id);

    /*
     * 화면에 원액 품목이 고를 수 있게 나와 있는가.
     *
     * 품목 코드를 글자로 찾으면 안 된다 - 원료 로트 목록의 속성 자료에도 코드가
     * 실려 있어 고르개가 없어도 찾힌다. 고르개의 선택지(value=식별자)를 본다.
     */
    const page = await (await fetch(`${BASE}/material/movement`, { headers: { cookie: CK } })).text();
    ok(page.includes(`<option value="${sol.id}"`), '원액 제조 · 원액 품목이 고르개에 나옴');

    const r = await submitForm(BASE, '/material/movement', CK,
      ['item_id', 'made_on', 'qty', 'lot_0', 'qty_0'],
      { item_id: sol.id, made_on: today, qty: 4,
        lot_0: lotA, qty_0: 2, lot_1: lotB, qty_1: 1, note: '저장 시험' });
    if (!r.ok) {
      ok(false, '원액 제조', r.reason ?? `HTTP ${r.status}`);
    } else {
      await settle();
      const made = (await rows(
        `select ml.id, ml.lot_no, ml.made_on::text as made_on, ml.qty_available,
                ml.unit_price, ml.expiry_date::text as expiry_date,
                (ml.made_on + make_interval(months => i.shelf_life_months))::date::text as want_expiry
           from material_lot ml join item i on i.id = ml.item_id
          where ml.item_id = $1 and ml.id <> all($2::uuid[])`, [sol.id, known]))[0];
      ok(!!made && made.made_on === today, '원액 제조 · 원액 로트가 섬',
         made ? `${made.lot_no} · 제조일 ${made.made_on}` : '새 로트 없음');

      if (made) {
        const lines = await rows(
          `select material_lot_id, qty from stock_movement
            where solution_lot_id = $1 and type = 'SOLUTION' order by qty`, [made.id]);
        ok(lines.length === 2, '원액 제조 · 원료 줄이 원액 로트를 가리킴', `${lines.length}줄`);
        ok(made.expiry_date === made.want_expiry && made.expiry_date !== null,
           '원액 제조 · 유효기간 = 제조일 + 사용기간', made.expiry_date);
        ok(Number(made.unit_price) === 10, '원액 제조 · 단가 = 원료 비용 ÷ 제조량',
           String(made.unit_price));
        const after = (await rows(
          'select id, qty_available from material_lot where id = any($1::uuid[])', [[lotA, lotB]]))
          .reduce((m, x) => m.set(x.id, Number(x.qty_available)), new Map());
        ok(stockBefore.get(lotA) - after.get(lotA) === 2 && stockBefore.get(lotB) - after.get(lotB) === 1,
           '원액 제조 · 원료 재고가 그만큼 빠짐');
        console.log('  남음    개발 DB 에 원액 로트 1건 · 원료 줄 2건이 남음 (S03 으로 지울 수 없음)');
      }
    }
  }
}

console.log('');
console.log('='.repeat(70));
console.log(bad === 0
  ? '사람이 화면에서 넣은 설정이 전부 저장됩니다.'
  : `${bad}건이 화면에서 저장되지 않습니다. 그 자리는 손으로 DB 를 만져야 합니다.`);
console.log('='.repeat(70));

await c.end();
process.exit(bad === 0 ? 0 : 1);
