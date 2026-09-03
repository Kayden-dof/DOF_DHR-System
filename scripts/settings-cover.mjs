/**
 * 설정이 화면에서 다 되는가 (§2.0)
 *
 *   npm run settings
 *
 * ── 무엇을 묻는가 ─────────────────────────────────────────────────────────
 * §2.0 은 "다른 제조소가 코드를 고치지 않고 받아 쓸 수 있는가" 를 묻는다.
 * `npm run fresh` 가 빈 DB 에서 배치가 끝까지 흐르는 것을 보지만, 그것은
 * **씨앗 스크립트가 흘린 것**이다. 스크립트는 화면이 아니다 - 어떤 값이
 * 화면에 칸이 없어도 스크립트는 SQL 로 넣어 버린다.
 *
 * 그래서 여기서는 다르게 묻는다. **사람이 정해야 하는 열마다 화면에 그 이름의
 * 칸이 있는가.** 없으면 그 값은 손으로 DB 를 만져야 들어간다.
 *
 * 실제로 이 검사를 만들면서 `item.default_supplier_id` 를 찾았다 - 사양
 * §4.2 에 있는데 화면에 칸이 없었고, 게다가 아무도 읽지 않아 발주 화면이
 * 공급자를 미리 골라 주지도 않았다 (2026-09-02).
 *
 * ── 무엇을 못 잡는가 ──────────────────────────────────────────────────────
 * 이름이 같은 칸이 있는지만 본다. 그 칸이 실제로 저장되는지는 보지 않는다 -
 * 그건 화면 훑기(smoke)와 규칙 시험이 본다. 여기서 통과하고 저기서 막히면
 * 그것도 답이다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ---------------------------------------------------------------------------
   사람이 정해야 하는 열

   자동으로 채워지는 것은 뺀다 - 식별자, 채번이 만드는 번호, 트리거가 찍는
   시각, 시스템이 세는 수량. 그것들은 화면에 칸이 **없는 것이 맞다.**
--------------------------------------------------------------------------- */
const TABLES = [
  ['품목', 'item', [
    'code', 'name', 'type', 'purchase_uom', 'usage_uom', 'conversion',
    'min_stock', 'lead_days', 'default_supplier_id', 'shelf_life_months']],
  ['공급자', 'supplier', [
    'code', 'name', 'approved_until', 'contact_name', 'contact_phone',
    'contact_email', 'biz_no', 'address', 'payment_terms', 'note']],
  ['설비', 'equipment', [
    'code', 'name', 'note', 'purchased_on', 'purchase_price',
    'useful_life_months', 'salvage_value', 'monthly_hours', 'vendor_name',
    'vendor_contact_name', 'vendor_phone', 'vendor_email', 'vendor_site',
    'vendor_address']],
  ['채번 규칙', 'numbering_rule', [
    'target', 'item_id', 'pattern', 'reset', 'seq_width', 'effective_from']],
  ['형명 체계', 'model_scheme', ['name', 'prefix', 'spec_pattern', 'name_pattern']],
  ['형명 자리', 'model_segment', ['seq', 'digits', 'divisor', 'decimals', 'label', 'role']],
  ['제품표준서', 'device_master', [
    'revision', 'effective_from', 'expected_units', 'product_code',
    'product_name', 'sample_basis', 'note', 'sheet_min', 'sheet_max',
    'steril_box_qty', 'license_no']],
  ['공정', 'dmr_operation', ['seq', 'code', 'name', 'after_cutting', 'typical_day', 'takes_rework']],
  ['자재 구성표', 'dmr_bom', ['component_item_id', 'basis', 'qty_per_unit']],
  ['장입 구간', 'dmr_bom_tier', ['min_sheets', 'max_sheets', 'qty']],
  ['사용자', 'app_user', ['login_code', 'full_name', 'is_developer']],
  ['회사 표시', 'org_brand', [
    'company_name', 'brand_color', 'system_name', 'system_name_long',
    'system_tagline', 'company_tagline', 'address', 'plant_address',
    'biz_no', 'ceo_name', 'backup_warn_days', 'expiry_warn_days']],
  ['자재 로트', 'material_lot', [
    'item_id', 'supplier_id', 'supplier_lot_no', 'purchase_order_id',
    'coa_no', 'coa_date', 'unit_price', 'expiry_date', 'location',
    'thickness_band']],
];

/**
 * 화면에 칸이 없어도 되는 것과 그 까닭.
 * 까닭을 적지 않으면 다음 사람이 "빠뜨린 것" 과 "일부러 뺀 것" 을 못 가린다.
 */
const AUTO = new Map([
  ['material_lot.lot_no', '채번 규칙이 만든다 (§10 응용에서 조합 금지)'],
]);

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f === 'node_modules' || f === '.next') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const names = new Set();
for (const f of walk(path.join(ROOT, 'app'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/name="([a-z_]+)"/g)) names.add(m[1]);
}

console.log('\n설정이 화면에서 다 되는가 (§2.0)\n');

let missing = 0;
let excused = 0;
for (const [label, table, cols] of TABLES) {
  const gone = [];
  for (const c of cols) {
    if (names.has(c)) continue;
    const why = AUTO.get(`${table}.${c}`);
    if (why) { excused++; continue; }
    gone.push(c);
  }
  missing += gone.length;
  console.log(`  ${gone.length === 0 ? '있음  ' : '없음  '}${label.padEnd(12)}`
    + `칸 ${String(cols.length).padStart(2)}`
    + (gone.length ? `   화면에 없는 칸: ${gone.join(' · ')}` : ''));
}

if (excused) {
  console.log('\n  화면에 칸이 없는 것이 맞는 값');
  for (const [k, why] of AUTO) console.log(`    ${k.padEnd(24)} ${why}`);
}

console.log(missing === 0
  ? '\n  사람이 정해야 하는 값은 전부 화면에 칸이 있습니다.\n'
  : `\n  ${missing}개는 손으로 DB 를 만져야 들어갑니다. 화면에 칸을 내십시오.\n`);
process.exitCode = missing === 0 ? 0 : 1;
