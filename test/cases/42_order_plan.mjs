// =============================================================================
// 42_order_plan.mjs - 주문에서 생산 계획 · 자재 소요 예보 (0164)
// 근거: 사용자 2026-11-25 «주문에서 생산 계획을 잡고, 자재가 얼마나 드는지 미리 보고 싶다»
//
// 판의 유효 크기 · 원료 품목 칸, 계획의 장수와 주문 줄, 장당 개수.
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder, reverify, REAGENT_TIERS } from '../fixtures.mjs';

/** 꺼진 PD 형명 체계를 켜고, 끝에 되돌린다 (40_sales_order 꼴) */
async function withScheme(t, fn) {
  const off = (await t.rows(`select id from model_scheme where prefix = 'PD' and not is_active`)).map((x) => x.id);
  await t.rows(`update model_scheme set is_active = true where id = any($1::uuid[])`, [off]);
  try { return await fn(); }
  finally { await t.rows(`update model_scheme set is_active = false where id = any($1::uuid[])`, [off]); }
}

const item = async (t, code) =>
  (await t.val(`select id from item where code = $1`, [code]))
  ?? t.val(`insert into item (code, name, type, shelf_life_months, purchase_uom, usage_uom, conversion) values ($1, $1, 'FIN', 12, 'EA', 'EA', 1) returning id`, [code]);

let CUSTOMER;
async function orderLine(t, m, code, po, qty = 10) {
  CUSTOMER ??= await t.val(
    `insert into customer (name, biz_no, created_by) values ('계획 시험 고객사', '000-00-00042', $1) returning id`, [m.admin]);
  const o = await t.val(
    `insert into sales_order (customer_id, customer_po_no, ordered_on, created_by)
     values ($1,$2,current_date,$3) returning id`, [CUSTOMER, po, m.admin]);
  return t.val(
    `insert into sales_order_line (sales_order_id, item_id, qty, seq) values ($1,$2,$3,1) returning id`,
    [o, await item(t, code), qty]);
}

const plan = (t, m, { sheets = 5, line = null, label = 'P-' + Math.random().toString(36).slice(2, 8) } = {}) =>
  t.val(
    `insert into batch_plan (label, device_master_id, start_on, sheets, sales_order_line_id, created_by)
     values ($1,$2,current_date,$3,$4,$5) returning id`, [label, m.dm, sheets, line, m.admin]);

/** 판을 시행 중으로 만들고 유효 크기를 정한다. 끝에 되돌릴 값(원래 칸)을 돌려준다 */
async function putInForce(t, m) {
  const old = (await t.rows(
    `select usable_w, usable_h, verified_by, verified_at, status, effective_from from device_master where id = $1`, [m.dm]))[0];
  await t.rows(`update device_master set usable_w = 20, usable_h = 20 where id = $1`, [m.dm]);
  await reverify(t, m.dm, m.admin);
  await t.rows(`update device_master set status = 'ACTIVE', effective_from = current_date where id = $1`, [m.dm]);
  return old;
}
async function restoreDm(t, m, old) {
  await t.rows(
    `update device_master set usable_w = $2, usable_h = $3, effective_from = $4,
            status = $5, verified_by = $6, verified_at = $7 where id = $1`,
    [m.dm, old.usable_w, old.usable_h, old.effective_from, old.status, old.verified_by, old.verified_at]);
}
/** 시험이 만든 계획 · 줄 · 지시 이음 · 지시를 뒷시험이 보지 않게 치운다 (지울 수 없는 것은 취소 · 뗌 · 0 으로) */
async function tidy(t, m, { plans = [], lines = [], wos = [], lots = [] } = {}) {
  await t.setActor(m.admin);
  for (const id of plans) await t.rows(`delete from batch_plan where id = $1`, [id]);
  await t.rows(
    `update work_order_so_line set unlinked_at = now(), unlinked_by = $2, unlink_reason = '시험 뒷정리'
      where sales_order_line_id = any($1::uuid[]) and unlinked_at is null`, [lines, m.admin]);
  await t.rows(
    `update sales_order_line set cancelled_at = now(), cancel_reason = '시험 뒷정리'
      where id = any($1::uuid[]) and cancelled_at is null`, [lines]);
  await t.rows(
    `update sales_order set cancelled_at = now(), cancel_reason = '시험 뒷정리'
      where id in (select sales_order_id from sales_order_line where id = any($1::uuid[])) and cancelled_at is null`, [lines]);
  for (const id of lots) await t.rows(`update product_lot set qty_available = 0 where id = $1`, [id]);
  for (const id of wos) await t.rows(
    `update work_order set status = 'CANCELLED', cancelled_reason = '시험 뒷정리' where id = $1 and status <> 'CANCELLED'`, [id]);
}
const fgStock = (t, code) => t.val(
  `select coalesce(sum(qty_available),0)::int from product_lot where item_id = (select id from item where code = $1)`, [code]);
/** 판 안 형명 가운데 장당 개수가 나오는 첫 형명 */
async function pickCode(t, m) {
  for (const r of await t.rows(`select code from dm_models($1)`, [m.dm])) {
    const n = await t.val(`select model_per_sheet($1, (select id from item where code = $2))`, [m.dm, r.code]);
    if (n) return { code: r.code, per: n };
  }
  throw new Error('장당 개수가 나오는 형명이 없다');
}
/** OP-05b ~ d 의 공통 장면. 시험 전용 품목을 세우고, 끝에 구성표 · 발주 · 로트 · 판 칸을 되돌린다 */
async function withScene(t, m, fn) {
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
  const mine = { plans: [], lines: [], wos: [], lots: [] };
  const lotIds = []; const poIds = []; const bomIds = [];
  const oldRaw = await t.val(`select raw_item_id from device_master where id = $1`, [m.dm]);
  let old = null;
  const S = {
    tag, mine,
    mk: (code, type) => t.val(
      `insert into item (code, name, type, purchase_uom, usage_uom, conversion)
       values ($1,$1,$2::item_type,'EA','EA',1) returning id`, [code + '-' + tag, type]),
    lot: async (item, qty, opts = {}) => { const id = await newMaterialLot(t, m, item, { qty, ...opts }); lotIds.push(id); return id; },
    po: async (item, qty) => {
      const id = await t.val(
        `insert into purchase_order (po_no, item_id, supplier_id, qty, ordered_at, expected_at, ordered_by)
         values ('PO-' || $4::text || '-' || substr(md5(random()::text), 1, 5), $1, $2, $5, current_date, current_date + 2, $3) returning id`,
        [item, m.supplier, m.admin, tag, qty]);
      poIds.push(id); return id;
    },
    /** 장입 구간 구성표를 시약에 단다 (판을 시행 중으로 만들기 전에) */
    bom: async (item, tiers) => {
      const id = await t.val(`insert into dmr_bom (operation_id, component_item_id, basis) values ($1,$2,'SHEET_TIER') returning id`,
        [m.ops['WS-DX2401-03'], item]);
      bomIds.push(id);
      for (const x of tiers) await t.rows(`insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty) values ($1,$2,$3,$4)`,
        [id, x.min_sheets, x.max_sheets, x.qty]);
    },
    inForce: async () => { old = await putInForce(t, m); },
    setRaw: async (item) => { await t.rows(`update device_master set raw_item_id = $2 where id = $1`, [m.dm, item]); await reverify(t, m.dm, m.admin); },
    plan: async (code, start, sheets) => {
      let line = null;
      if (code) { await item(t, code); line = await orderLine(t, m, code, 'OP05-' + tag + start, 1000); mine.lines.push(line); }
      const id = await t.val(
        `insert into batch_plan (label, device_master_id, start_on, sheets, sales_order_line_id, created_by)
         values ('OP05S-' || $5::text || $2::text, $1, current_date + $2::int, $6, $3, $4) returning id`,
        [m.dm, start, line, m.admin, tag, sheets]);
      mine.plans.push(id); return id;
    },
    shortage: (from, to) => t.rows(`select * from material_shortage(current_date + $1::int, current_date + $2::int)`, [from, to]),
  };
  try { return await fn(S); }
  finally {
    await tidy(t, m, mine);
    await t.setActor(m.admin);
    for (const id of bomIds) {
      await t.rows(`delete from dmr_bom_tier where dmr_bom_id = $1`, [id]);
      await t.rows(`delete from dmr_bom where id = $1`, [id]);
    }
    await t.rows(`update purchase_order set status = 'CANCELLED' where id = any($1::uuid[])`, [poIds]);
    await t.rows(`update material_lot set qty_available = 0, status = 'CONSUMED' where id = any($1::uuid[])`, [lotIds]);
    await t.rows(`update device_master set raw_item_id = $2 where id = $1`, [m.dm, oldRaw]);
    if (old) await restoreDm(t, m, old);
  }
}
const covered = (t, line) => t.val(`select so_line_covered($1)`, [line]);
const planRow = async (t, line) =>
  (await t.rows(`select * from order_plan_lines() where line_id = $1`, [line]))[0];
const hang = (t, m, wo, line) => t.rows(
  `insert into work_order_so_line (work_order_id, sales_order_line_id, linked_by) values ($1,$2,$3)`, [wo, line, m.admin]);

export default [

{
  id: 'OP-01', expect: '통과',
  name: '장당 개수는 유효 크기와 형명 크기로 센다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      for (const c of ['PD10182025', 'PD05050510', 'PD25250510', 'PD01020510']) await item(t, c);
      await t.rows(`update device_master set usable_w = 20, usable_h = 20 where id = $1`, [m.dm]);
      const per = (c) => t.val(`select model_per_sheet($1, (select id from item where code = $2))`, [m.dm, c]);
      t.eq(await per('PD10182025'), 2, '10x18 은 2');
      t.eq(await per('PD05050510'), 16, '5x5 는 16');
      t.eq(await per('PD25250510'), null, '25x25 는 들어가지 않아 null');
      t.eq(await per('PD01020510'), 200, '1x2 는 200');
      await t.rows(`update device_master set usable_w = null, usable_h = null where id = $1`, [m.dm]);
      t.eq(await per('PD10182025'), null, '유효 크기가 비면 null');
    });
  },
},

{
  id: 'OP-02', expect: '거부',
  name: '계획 장수는 0 보다 크고, 이은 주문 줄은 그 판의 형명이어야 한다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      await t.rejects(() => plan(t, m, { sheets: 0 }), { code: '23514' });
      const out = await orderLine(t, m, 'ZZ-OUT-001', 'OP02-OUT');
      await t.rejects(() => plan(t, m, { line: out }), { code: 'P0001', message: '이 주문 줄의 형명은' });
      const inCode = await t.val(`select code from dm_models($1) limit 1`, [m.dm]);
      const inn = await orderLine(t, m, inCode, 'OP02-IN');
      const ok = await plan(t, m, { line: inn });
      t.ok(ok, '판 안 형명의 줄은 들어간다');
      /* 시연 자료 비우기 시험(08)이 «표시 뒤 기록 없음» 을 보므로 계획은 치운다 */
      await t.rows(`delete from batch_plan where id = $1`, [ok]);
    });
  },
},

{
  id: 'OP-03', expect: '통과',
  name: '덮인 개수는 걸린 지시 · 이은 계획을 센다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      const old = await putInForce(t, m);
      const mine = { plans: [], lines: [], wos: [], lots: [] };
      try {
        const { code, per } = await pickCode(t, m);
        const stock0 = await fgStock(t, code);
        const l1 = await orderLine(t, m, code, 'OP03-A', 100);
        mine.lines.push(l1);
        t.eq(await covered(t, l1), 0, '아무것도 없으면 0');
        const r0 = await planRow(t, l1);
        t.ok(r0, '시행 중인 판이 있으면 제안 대상 줄에 나온다');
        t.eq(r0.left_qty, 100, 'left 100');
        t.eq(r0.covered, 0, 'covered 0');
        t.eq(r0.per_sheet, per, '장당 개수');
        t.eq(r0.fg_stock, stock0, 'fg_stock 은 그 형명 제품 로트 남은 양 합 (보이기만 한다)');
        t.eq(r0.multi_wo, false, '지시가 없으면 multi_wo 아님');

        const p = await plan(t, m, { sheets: 3, line: l1 });
        mine.plans.push(p);
        t.eq(await covered(t, l1), 3 * per, '지시 없는 이은 계획은 장수 x 장당 개수');

        const wo = await newWorkOrder(t, m, { sheets: 10 });
        mine.wos.push(wo.id);
        await hang(t, m, wo.id, l1);
        t.eq(await covered(t, l1), 3 * per + 10 * per, '재단 전 지시(10장)는 지시 장수 x 장당 개수');
        t.eq((await planRow(t, l1)).multi_wo, false, '한 줄만 걸린 지시는 multi_wo 아님');

        const l2 = await orderLine(t, m, code, 'OP03-B', 100);
        mine.lines.push(l2);
        await hang(t, m, wo.id, l2);
        t.eq(await covered(t, l1), 3 * per + 5 * per, '같은 형명 줄이 둘이면 지시 몫이 반씩');
        t.eq((await planRow(t, l1)).multi_wo, true, '다른 줄에도 걸린 지시가 있으면 multi_wo');

        await t.rows(`update sales_order_line set cancelled_at = now(), cancel_reason = '시험 취소' where id = $1`, [l2]);
        t.eq(await planRow(t, l2), undefined, '취소한 줄은 빠진다');
        t.eq(await covered(t, l1), 3 * per + 10 * per, '취소한 줄은 몫을 나누지 않는다');
        await t.rows(`update sales_order_line set cancelled_at = now(), cancel_reason = '시험 취소' where id = $1`, [l1]);
        t.eq(await covered(t, l1), 3 * per, '줄이 모두 left 0 이어도 0 으로 나누지 않는다 (지시 몫 0, 이은 계획만 남는다)');
        t.eq(await planRow(t, l1), undefined, '취소한 줄은 빠진다 (둘째)');
      } finally { await tidy(t, m, mine); await restoreDm(t, m, old); }
    });
  },
},

{
  id: 'OP-04', expect: '통과',
  name: '재단한 지시는 그 형명 로트의 남은 양만 센다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      const old = await putInForce(t, m);
      const mine = { plans: [], lines: [], wos: [], lots: [] };
      try {
        const { code } = await pickCode(t, m);
        const stock0 = await fgStock(t, code);
        const l1 = await orderLine(t, m, code, 'OP04', 100);
        mine.lines.push(l1);
        const wo = await newWorkOrder(t, m, { sheets: 10 });
        mine.wos.push(wo.id);
        await hang(t, m, wo.id, l1);
        const itemId = await t.val(`select id from item where code = $1`, [code]);
        mine.lots.push(await t.val(
          `insert into product_lot (work_order_id, lot_no, item_id, qty_produced, qty_available, manufactured_on, expiry_date, registered_by)
           values ($1, $2, $3, 20, 12, current_date, current_date + 365, $4) returning id`,
          [wo.id, 'OP04-' + Math.random().toString(36).slice(2, 8), itemId, m.admin]));
        t.eq(await covered(t, l1), 12, '재단한 지시는 로트의 남은 양');
        t.eq((await planRow(t, l1)).fg_stock - stock0, 12, 'fg_stock 은 로트 남은 양만큼 늘어 보인다');
        /* 로트가 다른 형명이면 그 지시는 이 줄에 0 */
        const other = (await t.rows(`select code from dm_models($1) where code <> $2 limit 1`, [m.dm, code]))[0];
        if (other) {
          const l2 = await orderLine(t, m, other.code, 'OP04-B', 100);
          mine.lines.push(l2);
          await hang(t, m, wo.id, l2);
          t.eq(await covered(t, l2), 0, '다른 형명 로트만 있으면 0');
        }
      } finally { await tidy(t, m, mine); await restoreDm(t, m, old); }
    });
  },
},

{
  id: 'OP-05', expect: '통과',
  name: '계획 · 지시가 쓸 자재를 재고 · 발주중과 맞대 부족을 센다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      /* 이 시험만의 시약 · 원료 품목을 새로 세워 다른 시험의 재고와 섞이지 않게 한다 */
      const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
      const mk = (code, type) => t.val(
        `insert into item (code, name, type, purchase_uom, usage_uom, conversion)
         values ($1,$1,$2::item_type,'EA','EA',1) returning id`, [code, type]);
      const rg = await mk('RG-OP5-' + tag, 'REAGENT');
      const rw = await mk('RM-OP5-' + tag, 'RAW');
      const oldRaw = await t.val(`select raw_item_id from device_master where id = $1`, [m.dm]);
      const mine = { plans: [], lines: [], wos: [], lots: [] };
      const lotIds = []; const poIds = []; const bomIds = [];
      let old;
      const day = 3;
      const iso = (d) => new Date(d).toISOString().slice(0, 10);
      const need = (src) => t.rows(`select * from material_needs(current_date + $1::int, current_date + $1::int) where source = $2`, [day, src]);
      const short = async (id, band = null) =>
        (await t.rows(`select * from material_shortage(current_date + $1::int, current_date + $1::int)
                        where item_id = $2 and band is not distinct from $3`, [day, id, band]))[0];
      const lot = async (item, qty, opts = {}) => {
        const id = await newMaterialLot(t, m, item, { qty, ...opts });
        lotIds.push(id); return id;
      };
      try {
        /* 구성표: 시약은 장입 구간(11~20장 2), 판의 원료는 raw_item_id */
        const op = m.ops['WS-DX2401-03'];
        const bom = await t.val(`insert into dmr_bom (operation_id, component_item_id, basis) values ($1,$2,'SHEET_TIER') returning id`, [op, rg]);
        bomIds.push(bom);
        for (const x of REAGENT_TIERS) {
          await t.rows(`insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty) values ($1,$2,$3,$4)`,
            [bom, x.min_sheets, x.max_sheets, x.qty]);
        }
        await t.rows(`update device_master set raw_item_id = $2 where id = $1`, [m.dm, rw]);
        old = await putInForce(t, m);

        const code = 'PD05050510';
        await item(t, code);
        const per = await t.val(`select model_per_sheet($1, (select id from item where code = $2))`, [m.dm, code]);
        const line = await orderLine(t, m, code, 'OP05-A', 1000);
        mine.lines.push(line);
        const p = await t.val(
          `insert into batch_plan (label, device_master_id, start_on, sheets, sales_order_line_id, created_by)
           values ('OP05-' || $5::text, $1, current_date + $2::int, 12, $3, $4) returning id`, [m.dm, day, line, m.admin, tag]);
        mine.plans.push(p);

        /* 같은 판의 다른 진행 중 지시(앞 시험이 남긴 것)가 시약을 쓰므로 그 몫을 따로 안다 */
        const woBase = (await need('WO')).filter((x) => x.item_id === rg).reduce((a, x) => a + Number(x.qty), 0);

        /* 1. 계획이 쓸 시약 */
        const r1 = (await need('PLAN')).filter((x) => x.item_id === rg && x.source_id === p);
        t.eq(r1.length, 1, '계획의 시약 줄 하나');
        t.eq(Number(r1[0].qty), 2, '12장은 11~20 구간이라 시약 2');
        t.eq(r1[0].unit_known, true, '장입 구간 품목은 개수를 몰라도 안다');
        t.eq(r1[0].source_label, 'OP05-' + tag, '출처 이름은 계획 이름');
        /* 개수 비례 품목은 이은 줄의 장당 개수로 센다 */
        const pouch = (await need('PLAN')).find((x) => x.item_id === m.pouch && x.source_id === p);
        t.eq(Number(pouch.qty), 12 * per, '포장재는 장수 x 장당 개수 x 1');
        t.eq(pouch.unit_known, true, '이은 줄이 있으면 개수를 안다');
        /* 판의 원료: 이은 줄 형명의 두께 구간 · 장수 */
        const raw1 = (await need('PLAN')).find((x) => x.item_id === rw && x.source_id === p);
        t.eq(raw1.band, '0510', '원료 줄의 두께 구간');
        t.eq(Number(raw1.qty), 12, '원료는 장수');

        /* 2. 재고 - 기한이 필요일 전에 끝나는 로트는 세지 않는다 */
        await lot(rg, 1);
        await t.rows(`update material_lot set expiry_date = current_date + 1 where id = $1`, [await lot(rg, 50)]);
        let s = await short(rg);
        t.eq(Number(s.need_qty), 2 + woBase, '필요 = 계획 2 + 다른 지시의 몫');
        t.eq(Number(s.stock_qty), 1, '기한 없는 1 만 센다 (기한이 필요일 전인 50 은 뺀다)');
        t.eq(Number(s.on_order_qty), 0, '발주 없음');
        t.eq(Number(s.short_qty), Math.max(0, 2 + woBase - 1), '부족 = 필요 - 재고 1');
        /* 앞 시험이 남긴 31장 이상 지시는 구간 밖이라 모름으로 잡힌다 - unknown 은 OP-05d 가 본다 */
        t.eq(iso(s.first_need_on), await t.val(`select (current_date + $1::int)::text`, [day]), '처음 필요한 날');

        /* 3. 발주중 */
        const po = await t.val(
          `insert into purchase_order (po_no, item_id, supplier_id, qty, ordered_at, expected_at, ordered_by)
           values ('PO-OP5-' || $4::text, $1, $2, 5, current_date, current_date + 2, $3) returning id`,
          [rg, m.supplier, m.admin, tag]);
        poIds.push(po);
        s = await short(rg);
        t.eq(Number(s.on_order_qty), 5, '발주중 5 (입고 0)');
        t.eq(Number(s.short_qty), Math.max(0, 2 + woBase - 1 - 5), '부족 = 필요 - 재고 - 발주중 5');
        t.eq(iso(s.next_expected_on), await t.val(`select (current_date + 2)::text`), '다음 입고 예정일');
        t.ok(s.order_by === null, '리드타임이 없으면 발주 기한은 비운다 (null)');
        await t.rows(`update item set lead_days = 7 where id = $1`, [rg]);
        s = await short(rg);
        t.eq(iso(s.order_by), await t.val(`select (current_date + $1::int - 7)::text`, [day]), '발주 기한은 필요일 - 리드타임');

        /* 4. 원료는 두께 구간별로 맞댄다 */
        await lot(rw, 5, { thickness_band: '0510' });
        await lot(rw, 50, { thickness_band: '1020' });
        const sr = await short(rw, '0510');
        t.eq(Number(sr.need_qty), 12, '원료 필요 12');
        t.eq(Number(sr.stock_qty), 5, '같은 두께 구간 재고 5 만');
        t.eq(Number(sr.short_qty), 7, '부족 7');
        t.eq(sr.item_type, 'RAW', '품목 종류');

        /* 5. 이은 줄이 없는 계획은 개수 비례 품목을 모른다 */
        const p2 = await t.val(
          `insert into batch_plan (label, device_master_id, start_on, sheets, created_by)
           values ('OP05B-' || $4::text, $1, current_date + $2::int, 12, $3) returning id`, [m.dm, day, m.admin, tag]);
        mine.plans.push(p2);
        const pouch2 = (await need('PLAN')).find((x) => x.item_id === m.pouch && x.source_id === p2);
        t.eq(pouch2.unit_known, false, '줄이 없으면 개수를 모른다');
        t.ok(pouch2.qty === null, '수량은 비운다 (null)');
        t.eq((await short(m.pouch)).unknown, true, '부족 셈은 모름으로 짚는다');
        await t.rows(`delete from batch_plan where id = any($1::uuid[])`, [mine.plans]);
        mine.plans.length = 0;

        /* 6. 진행 중 지시: 필요 - (투입 - 반납) */
        const wo = await newWorkOrder(t, m, { sheets: 12 });
        mine.wos.push(wo.id);
        const w1 = (await need('WO')).filter((x) => x.item_id === rg && x.source_id === wo.id);
        t.eq(w1.length, 1, '지시의 시약 줄 하나');
        t.eq(Number(w1[0].qty), 2, '투입 전 필요 2');
        t.eq(w1[0].source_label, wo.batchNo, '출처 이름은 배치번호');
        const wp = (await need('WO')).find((x) => x.item_id === m.pouch && x.source_id === wo.id);
        t.eq(wp.unit_known, false, '예정 개수가 없는 지시의 개수 비례 품목은 모른다');
        t.eq((await need('WO')).some((x) => x.item_id === rw && x.source_id === wo.id), false, '지시의 원료는 넣지 않는다');
        const pr = await t.val(
          `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id, started_at, ended_at)
           values ($1,$2,1,current_date,$3,now(),now()) returning id`, [wo.id, op, m.worker]);
        const mi = await t.val(
          `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
           values ($1,$2,1,$3) returning id`, [pr, lotIds[0], m.admin]);
        const w2 = (await need('WO')).filter((x) => x.item_id === rg && x.source_id === wo.id);
        t.eq(Number(w2[0].qty), 1, '1 투입하면 필요가 1 로 준다');
        await t.rows(
          `insert into stock_movement (material_lot_id, type, qty, work_order_id, material_issue_id, reason_code, registered_by)
           values ($1,'RETURN',1,$2,$3,'계량오차',$4)`, [lotIds[0], wo.id, mi, m.admin]);
        const w3 = (await need('WO')).filter((x) => x.item_id === rg && x.source_id === wo.id);
        t.eq(Number(w3[0].qty), 2, '1 을 반납하면 다시 2');
      } finally {
        await tidy(t, m, mine);
        await t.setActor(m.admin);
        for (const id of bomIds) {
          await t.rows(`delete from dmr_bom_tier where dmr_bom_id = $1`, [id]);
          await t.rows(`delete from dmr_bom where id = $1`, [id]);
        }
        await t.rows(`update purchase_order set status = 'CANCELLED' where id = any($1::uuid[])`, [poIds]);
        await t.rows(`update material_lot set qty_available = 0, status = 'CONSUMED' where id = any($1::uuid[])`, [lotIds]);
        await t.rows(`update device_master set raw_item_id = $2 where id = $1`, [m.dm, oldRaw]);
        if (old) await restoreDm(t, m, old);
      }
    });
  },
},

{
  id: 'OP-05b', expect: '통과',
  name: '두께 구간이 여럿이면 발주중을 나눠 담고, 구간 없는 필요는 구간 없는 로트만 센다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      await withScene(t, m, async (S) => {
        const rw = await S.mk('RM-OP5B', 'RAW');
        await S.setRaw(rw);
        await S.inForce();
        await S.plan('PD05050510', 3, 12);   /* 0510 - 12장 */
        await S.plan('PD05051015', 4, 10);   /* 1015 - 10장 */
        await S.plan(null, 5, 7);            /* 줄 없음 - 구간 없음 - 7장 */
        await S.lot(rw, 4, { thickness_band: '0510' });
        await S.lot(rw, 3, { thickness_band: '1015' });
        await S.lot(rw, 2);                  /* 구간 없는 로트 */
        await S.po(rw, 10);
        const rows = (await S.shortage(3, 5)).filter((x) => x.item_id === rw);
        t.eq(rows.length, 3, '구간 셋');
        const by = (b) => rows.find((x) => x.band === b);
        const a = by('0510'); const b = by('1015'); const c = by(null);
        const nums = (x) => [Number(x.need_qty), Number(x.stock_qty), Number(x.on_order_qty), Number(x.short_qty)];
        t.eq(nums(a), [12, 4, 8, 0], '0510: 필요 12 - 재고 4 - 발주 8 을 가져가 부족 0');
        t.eq(nums(b), [10, 3, 2, 5], '1015: 남은 발주 2 만 가져가 부족 5');
        t.eq(nums(c), [7, 2, 0, 5], '구간 없음: 구간 없는 로트 2 만 센다 - 발주 0 - 부족 5');
        t.eq(Number(a.on_order_qty) + Number(b.on_order_qty) + Number(c.on_order_qty), 10, '발주중 10 은 이중으로 세지 않는다');
        t.eq(rows.map((x) => x.band), ['1015', null, '0510'], '정렬: 부족 먼저 - 구간 순');
      });
    });
  },
},

{
  id: 'OP-05c', expect: '통과',
  name: '재고는 마지막 필요일까지 기한이 남은 것만 센다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      await withScene(t, m, async (S) => {
        const rw = await S.mk('RM-OP5C', 'RAW');
        await S.setRaw(rw);
        await S.inForce();
        await S.plan('PD05050510', 3, 12);
        await S.plan('PD05050510', 6, 5);
        /* 첫 필요일과 마지막 필요일 사이에 기한이 끝나는 로트 */
        await S.lot(rw, 20, { thickness_band: '0510', expiry: await t.val(`select (current_date + 4)::text`) });
        await S.lot(rw, 3, { thickness_band: '0510' });
        const r = (await S.shortage(3, 6)).find((x) => x.item_id === rw);
        t.eq(Number(r.need_qty), 17, '필요 17');
        t.eq(Number(r.stock_qty), 3, '사이에 기한이 끝나는 20 은 세지 않는다');
        t.eq(Number(r.short_qty), 14, '부족 14');
        t.eq(new Date(r.first_need_on).toISOString().slice(0, 10), await t.val(`select (current_date + 3)::text`), '첫 필요일은 그대로');
      });
    });
  },
},

{
  id: 'OP-05d', expect: '통과',
  name: '구간 밖 장수는 계획 · 지시 모두 모름이고, 이미 투입한 지시는 모름 줄을 내지 않는다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      await withScene(t, m, async (S) => {
        const rg = await S.mk('RG-OP5D', 'REAGENT');
        await S.bom(rg, [{ min_sheets: 1, max_sheets: 10, qty: 1 }]);   /* 11장 이상은 구간 밖 */
        await S.inForce();
        const p = await S.plan('PD05050510', 3, 12);
        const wo = await newWorkOrder(t, m, { sheets: 12 });
        S.mine.wos.push(wo.id);
        const mineRows = () => t.rows(`select * from material_needs(current_date + 3, current_date + 3) where item_id = $1`, [rg]);
        let rows = await mineRows();
        const pr = rows.find((x) => x.source === 'PLAN' && x.source_id === p);
        const wr = rows.find((x) => x.source === 'WO' && x.source_id === wo.id);
        t.ok(pr && pr.unit_known === false && pr.qty === null, '계획: 구간 밖은 모름 (qty null)');
        t.ok(wr && wr.unit_known === false && wr.qty === null, '지시: 구간 밖도 모름 (0 으로 세지 않는다)');
        t.eq((await S.shortage(3, 3)).find((x) => x.item_id === rg).unknown, true, '부족 셈은 모름으로 짚는다');
        /* 그 지시에서 이 품목을 투입하면 모름 줄은 나오지 않는다 */
        const lot = await S.lot(rg, 5);
        const rec = await t.val(
          `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id, started_at, ended_at)
           values ($1,$2,1,current_date,$3,now(),now()) returning id`, [wo.id, m.ops['WS-DX2401-03'], m.worker]);
        await t.rows(`insert into material_issue (process_record_id, material_lot_id, qty, issued_by) values ($1,$2,1,$3)`, [rec, lot, m.admin]);
        rows = await mineRows();
        t.eq(rows.some((x) => x.source === 'WO' && x.source_id === wo.id), false, '이미 투입한 지시는 모름 줄을 내지 않는다');
        t.eq(rows.some((x) => x.source === 'PLAN' && x.source_id === p), true, '계획의 모름 줄은 그대로');
      });
    });
  },
},

{
  id: 'OP-06', expect: '통과',
  name: '계획에 지시를 이으면 그 주문 줄을 지시에 함께 건다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      const code = await t.val(`select code from dm_models($1) limit 1`, [m.dm]);
      const line = await orderLine(t, m, code, 'OP06');
      const p = await plan(t, m, { line });
      const wo = await newWorkOrder(t, m);
      await t.setActor(m.admin);
      await t.rows(`update batch_plan set work_order_id = $1 where id = $2`, [wo.id, p]);
      const n = () => t.val(
        `select count(*)::int from work_order_so_line where work_order_id = $1 and sales_order_line_id = $2 and unlinked_at is null`,
        [wo.id, line]);
      t.eq(await n(), 1, '주문 줄이 지시에 걸린다');
      await t.rows(`update batch_plan set work_order_id = null where id = $1`, [p]);
      await t.rows(`update batch_plan set work_order_id = $1 where id = $2`, [wo.id, p]);
      t.eq(await n(), 1, '이미 걸려 있으면 두 줄이 되지 않는다');
      await t.rows(`delete from batch_plan where id = $1`, [p]);
    });
  },
},

{
  id: 'OP-06b', expect: '통과',
  name: '주문 줄이 0159 규칙에 걸려 걸리지 않아도 계획 잇기는 그대로 된다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      const code = await t.val(`select code from dm_models($1) limit 1`, [m.dm]);
      const line = await orderLine(t, m, code, 'OP06B');
      const p = await plan(t, m, { line });
      await t.setActor(m.admin);
      await t.rows(`update sales_order_line set cancelled_at = now(), cancel_reason = '시험 취소' where id = $1`, [line]);
      const wo = await newWorkOrder(t, m);
      await t.setActor(m.admin);
      await t.rows(`update batch_plan set work_order_id = $1 where id = $2`, [wo.id, p]);
      t.eq(await t.val(`select work_order_id from batch_plan where id = $1`, [p]), wo.id, '계획 잇기는 그대로');
      t.eq(await t.val(
        `select count(*)::int from work_order_so_line where work_order_id = $1 and unlinked_at is null`, [wo.id]),
        0, '취소된 줄은 지시에 걸리지 않는다');
      await t.rows(`delete from batch_plan where id = $1`, [p]);
    });
  },
},

{
  id: 'OP-07', expect: '통과',
  name: '같은 줄을 두 번 올리지 않게 덮인 개수가 계획을 센다',
  async run(t) {
    const m = await master(t);
    await withScheme(t, async () => {
      const old = await putInForce(t, m);
      const mine = { plans: [], lines: [], wos: [], lots: [] };
      try {
        const { code, per } = await pickCode(t, m);
        /* 63장이 꼭 덮는 개수 (장당 16개이면 1008) */
        const line = await orderLine(t, m, code, 'OP07', 63 * per);
        mine.lines.push(line);
        const before = await planRow(t, line);
        t.eq(before.covered, 0, '올리기 전에는 덮인 것이 없다');
        t.eq(Math.max(0, before.left_qty - before.covered), 63 * per, '올리기 전 만들 개수는 남은 개수 그대로');
        /* 일정에 올리기가 넣는 모양 그대로: 장수 30 · 30 · 3, 라벨 «발주번호 i/n» */
        const sheets = [30, 30, 3];
        for (const [i, s] of sheets.entries()) {
          mine.plans.push(await plan(t, m, { sheets: s, line, label: `SD ${i + 1}/${sheets.length}` }));
        }
        const after = await planRow(t, line);
        t.eq(after.covered, 63 * per, '덮인 개수는 63장 x 장당 개수');
        t.eq(Math.max(0, after.left_qty - after.covered), 0, '올린 뒤 만들 개수는 0 - 두 번 올리지 않는다');
      } finally { await tidy(t, m, mine); await restoreDm(t, m, old); }
    });
  },
},

{
  id: 'OP-00', expect: '거부',
  name: '원료 품목 칸에는 원료(RAW) 품목만',
  async run(t) {
    const m = await master(t);
    await t.rejects(() => t.rows(`update device_master set raw_item_id = $1 where id = $2`, [m.reagent, m.dm]),
      { code: 'P0001', message: '원료' });
    await t.rows(`update device_master set raw_item_id = $1 where id = $2`, [m.raw, m.dm]);
    t.eq(await t.val(`select raw_item_id from device_master where id = $1`, [m.dm]), m.raw, '원료 품목은 들어간다');
  },
},

];
