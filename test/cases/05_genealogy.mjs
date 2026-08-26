// =============================================================================
// 05_genealogy.mjs · 계보 정확성 · 재고 · 원가 (§8.3, §9 M3·M4)
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder } from '../fixtures.mjs';

/**
 * 배치 하나를 끝까지 굴린다. 원재료 입고부터 재단 후 포장까지.
 * 계보 시험은 실제로 흘러간 자료 위에서만 의미가 있다.
 */
async function runBatch(t, m, opts = {}) {
  const sheets = opts.sheets ?? 20;
  const rawLot = await newMaterialLot(t, m, m.raw,
    { thickness_band: '0510', qty: 50, unit_price: 20000 });
  const wo = await newWorkOrder(t, m, { rawLot, sheets });

  await t.setActor(m.admin);

  // 재단 전: 알칼리 처리에 시약 투입
  const reagentLot = await newMaterialLot(t, m, m.reagent, { qty: 20, unit_price: 5000 });
  const pr1 = await t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
     values ($1,$2,1,current_date,$3) returning id`,
    [wo.id, m.ops['WS-DX2401-03'], m.worker]);
  await t.rows(
    `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
     values ($1,$2,$3,$4)`,
    [pr1, reagentLot, await t.val(`select required_qty($1,$2,$3,0)`,
      [m.ops['WS-DX2401-03'], m.reagent, sheets]), m.admin]);
  await t.rows(`select complete_process($1)`, [pr1]);

  // 재단: 형명 두 개로 분할
  const finB = await t.val(`select id from item where code = 'PD10150510'`);
  const lotA = await t.val(`select cut_product_lot($1,$2,$3,$4)`,
    [wo.id, m.fin, opts.qtyA ?? 24, opts.sampleA ?? 2]);
  const lotB = await t.val(`select cut_product_lot($1,$2,$3,$4)`,
    [wo.id, finB, opts.qtyB ?? 16, 0]);

  // 재단 후: 포장. 제품 로트마다 붙는다.
  const tyvekLot = await newMaterialLot(t, m, m.tyvek, { qty: 50, unit_price: 300 });
  const pouchLot = await newMaterialLot(t, m, m.pouch, { qty: 200, unit_price: 120 });
  const packed = [];
  for (const [lot, qty] of [[lotA, opts.qtyA ?? 24], [lotB, opts.qtyB ?? 16]]) {
    const pr = await t.val(
      `insert into process_record (work_order_id, product_lot_id, operation_id,
         day_no, work_date, worker_id)
       values ($1,$2,$3,2,current_date,$4) returning id`,
      [wo.id, lot, m.ops['WS-DX2401-08'], m.worker]);
    await t.rows(`insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
                  values ($1,$2,1,$3)`, [pr, tyvekLot, m.admin]);
    await t.rows(`insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
                  values ($1,$2,$3,$4)`, [pr, pouchLot, qty, m.admin]);
    await t.rows(`update product_lot set status='PACKED' where id=$1`, [lot]);
    packed.push(pr);
  }

  await t.setActor(null);
  return { wo, rawLot, reagentLot, tyvekLot, pouchLot, lotA, lotB, finB, sheets };
}

let BATCH = null;
const batch = (t, m) => (BATCH ??= runBatch(t, m));

export default [

// ---- 계보 (§8.3) -------------------------------------------------------------

{
  id: 'GN-01', expect: '확인',
  name: '제품 로트에서 배치를 거쳐 원재료 로트로 역추적',
  async run(t) {
    const m = await master(t);
    const b = await batch(t, m);

    const r = await t.one(
      `select wo.batch_no, ml.lot_no as raw_lot, ml.thickness_band,
              i.code as raw_code, s.name as supplier_name, ml.coa_no
         from product_lot pl
         join work_order wo on wo.id = pl.work_order_id
         join material_lot ml on ml.id = wo.material_lot_id
         join item i on i.id = ml.item_id
         join supplier s on s.id = ml.supplier_id
        where pl.id = $1`, [b.lotA]);

    t.eq(r.batch_no, b.wo.batchNo, '배치번호');
    t.eq(r.raw_code, 'RM-006', '원재료 품목');
    t.eq(r.thickness_band, '0510', '두께 구간이 상속된다');
    t.ok(r.coa_no, '성적서 번호가 붙어 있어야 한다 (S02)');
  },
},

{
  id: 'GN-02', expect: '확인',
  name: '원재료 로트에서 영향 제품 로트 전량 정추적',
  async run(t) {
    const m = await master(t);
    const b = await batch(t, m);

    const rows = await t.rows(
      `select pl.id, pl.lot_no from material_lot ml
         join work_order wo on wo.material_lot_id = ml.id
         join product_lot pl on pl.work_order_id = wo.id
        where ml.id = $1 order by pl.lot_no`, [b.rawLot]);

    t.eq(rows.length, 2, '영향 제품 로트 수');
    t.eq(new Set(rows.map((r) => r.id)).size, 2, '중복 없음');
    t.ok(rows.every((r) => r.lot_no), '제조번호가 모두 부여되어야 한다');
  },
},

{
  id: 'GN-03', expect: '확인',
  name: '포장재 로트에서 영향 제품 로트 정추적 (재단 후 계보)',
  async run(t) {
    const m = await master(t);
    const b = await batch(t, m);

    const rows = await t.rows(
      `select distinct product_lot_id from v_lot_genealogy
        where material_lot_id = $1 and after_cutting`, [b.pouchLot]);
    t.eq(rows.length, 2, '파우치가 들어간 제품 로트 수');
    t.ok(rows.every((r) => r.product_lot_id), '재단 후 공정은 제품 로트가 붙는다');
  },
},

{
  id: 'GN-04', expect: '확인',
  name: '재단 전 자재는 배치에 붙고 제품 로트가 비어 있다',
  async run(t) {
    const m = await master(t);
    const b = await batch(t, m);
    const rows = await t.rows(
      `select product_lot_id, operation_code from v_lot_genealogy
        where material_lot_id = $1`, [b.reagentLot]);
    t.eq(rows.length, 1, '시약 불출 건수');
    t.eq(rows[0].product_lot_id, null, '재단 전이므로 제품 로트가 없다');
    t.eq(rows[0].operation_code, 'WS-DX2401-03', '공정');
  },
},

{
  id: 'GN-05', expect: '확인',
  name: '계보에 work_order_id가 중복 저장되지 않는다 (§10)',
  async run(t) {
    const n = await t.val(
      `select count(*)::int from information_schema.columns
        where table_name = 'material_issue' and column_name = 'work_order_id'`);
    t.eq(n, 0, 'material_issue.work_order_id 컬럼');
  },
},

// ---- 재고 (§8.3 마지막 항목) --------------------------------------------------

{
  id: 'IV-01', expect: '확인',
  name: '불출하면 자재 잔여가 줄어든다',
  async run(t) {
    const m = await master(t);
    const b = await batch(t, m);
    const r = await t.one(
      `select qty_received, qty_available from material_lot where id=$1`, [b.pouchLot]);
    // 24 + 16 = 40개 불출
    t.eq(Number(r.qty_received) - Number(r.qty_available), 40, '불출 합계');
  },
},

{
  id: 'IV-02', expect: '예외',
  name: '잔여보다 많이 불출할 수 없다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    const lot = await newMaterialLot(t, m, m.reagent, { qty: 3 });
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,90,current_date,$3) returning id`,
      [wo.id, m.ops['WS-DX2401-03'], m.worker]);
    await t.rejects(
      () => t.rows(`insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
                    values ($1,$2,5,$3)`, [pr, lot, m.admin]),
      { code: 'P0001', message: '잔여 수량' });
  },
},

{
  id: 'IV-03', expect: '확인',
  name: '반납은 원 로트로 복귀한다 (§4.7)',
  async run(t) {
    const m = await master(t);
    const lot = await newMaterialLot(t, m, m.reagent, { qty: 10 });
    await t.rows(
      `insert into stock_movement (material_lot_id, type, qty, reason_code, registered_by)
       values ($1,'RETURN',3,'기타',$2)`, [lot, m.admin]);
    t.eq(Number(await t.val(`select qty_available from material_lot where id=$1`, [lot])),
         13, '반납 후 잔여');
  },
},

{
  id: 'IV-04', expect: '예외',
  name: '유형과 부호가 어긋나면 거부 (사양 보강)',
  async run(t) {
    const m = await master(t);
    const lot = await newMaterialLot(t, m, m.reagent, { qty: 10 });
    await t.rejects(
      () => t.rows(`insert into stock_movement (material_lot_id, type, qty, reason_code, registered_by)
                    values ($1,'RETURN',-3,'기타',$2)`, [lot, m.admin]),
      { code: '23514' });
    await t.rejects(
      () => t.rows(`insert into stock_movement (material_lot_id, type, qty, reason_code, registered_by)
                    values ($1,'DISPOSAL_STOCK',3,'파손',$2)`, [lot, m.admin]),
      { code: '23514' });
  },
},

{
  id: 'IV-05', expect: '예외',
  name: '공정 폐기는 작업지시를 지정해야 한다',
  async run(t) {
    const m = await master(t);
    const lot = await newMaterialLot(t, m, m.reagent, { qty: 10 });
    await t.rejects(
      () => t.rows(`insert into stock_movement (material_lot_id, type, qty, reason_code, registered_by)
                    values ($1,'DISPOSAL_WIP',-1,'오염',$2)`, [lot, m.admin]),
      { code: '23514' });
  },
},

{
  id: 'IV-06', expect: '확인',
  name: '용액 제조는 원료 여러 종을 한 번에 차감한다 (§4.7)',
  async run(t) {
    const m = await master(t);
    const a = await newMaterialLot(t, m, m.reagent,  { qty: 10 });
    const b = await newMaterialLot(t, m, m.reagent2, { qty: 10 });
    await t.setActor(m.admin);
    const n = await t.val(
      `select make_solution(array[$1,$2]::uuid[], array[2,3]::numeric[], '20X PBS')`, [a, b]);
    await t.setActor(null);
    t.eq(n, 2, '차감된 원료 수');
    t.eq(Number(await t.val(`select qty_available from material_lot where id=$1`, [a])), 8, 'a 잔여');
    t.eq(Number(await t.val(`select qty_available from material_lot where id=$1`, [b])), 7, 'b 잔여');
    t.eq(await t.val(
      `select count(*)::int from stock_movement where type='SOLUTION' and reason_detail like '20X PBS%'`),
      2, '용액 제조 기록');
  },
},

{
  id: 'IV-07', expect: '확인',
  name: '최소 재고선 알림은 발주중 수량을 포함한다 (§6)',
  async run(t) {
    const m = await master(t);
    const it = await t.val(
      `insert into item (code,name,type,purchase_uom,usage_uom,min_stock)
       values ('RG-LOW','재고부족시약','REAGENT','통','통',100) returning id`);
    await newMaterialLot(t, m, it, { qty: 10 });

    t.eq(await t.val(`select count(*)::int from v_reorder_alert where id=$1`, [it]), 1,
         '발주 전에는 알림 대상');

    await t.rows(
      `insert into purchase_order (po_no, item_id, supplier_id, qty, ordered_at, ordered_by)
       values ('PO-LOW',$1,$2,200,current_date,$3)`, [it, m.supplier, m.admin]);

    t.eq(await t.val(`select count(*)::int from v_reorder_alert where id=$1`, [it]), 0,
         '발주중 수량을 더하면 대상에서 빠진다');
  },
},

{
  id: 'IV-08', expect: '확인',
  name: '유효기한 경과 자재는 EXPIRED로 넘어간다 (§6)',
  async run(t) {
    const m = await master(t);
    const lot = await newMaterialLot(t, m, m.reagent,
      { qty: 5, expiry: '2020-01-01' });
    await t.setActor(m.admin);
    await t.rows(`select expire_material_lots()`);
    await t.setActor(null);
    t.eq(await t.val(`select status::text from material_lot where id=$1`, [lot]),
         'EXPIRED', '상태');
    t.eq(Number(await t.val(`select qty_available from material_lot where id=$1`, [lot])),
         5, '수량은 건드리지 않는다');
  },
},

// ---- 유효기한 고정 (§4.2) ----------------------------------------------------

{
  id: 'EX-01', expect: '확인',
  name: '제품 로트 유효기한은 생성 시점 값으로 고정된다',
  async run(t) {
    const m = await master(t);
    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    const before = await t.val(`select cut_product_lot($1,$2,10,0)`, [wo.id, m.fin]);
    const beforeExp = await t.val(`select expiry_date from product_lot where id=$1`, [before]);

    // 사용기간을 24개월로 연장한다
    await t.rows(
      `insert into shelf_life_history (item_id, months, effective_from, study_report_no, approved_by)
       values ($1, 24, current_date, 'STB-2026-001', $2)`, [m.fin, m.admin]);

    const wo2 = await newWorkOrder(t, m);
    const after = await t.val(`select cut_product_lot($1,$2,10,0)`, [wo2.id, m.fin]);
    await t.setActor(null);

    const afterRow = await t.one(
      `select expiry_date, shelf_life_ref from product_lot where id=$1`, [after]);

    t.eq(await t.val(`select expiry_date from product_lot where id=$1`, [before]),
         beforeExp, '기존 로트는 소급되지 않는다');
    t.ok(afterRow.shelf_life_ref, '새 로트는 참조한 이력 행을 남긴다');
    t.ok(new Date(afterRow.expiry_date) > new Date(beforeExp), '새 로트는 더 길다');
  },
},

// ---- 원가 (§9 M4) ------------------------------------------------------------

{
  id: 'CO-01', expect: '확인',
  name: '제품 원가와 자재 지출이 분리 산출된다',
  async run(t) {
    const m = await master(t);
    const b = await batch(t, m);

    const cost = await t.one(
      `select raw_cost::numeric, pre_cut_cost::numeric, post_cut_cost::numeric
         from v_batch_cost where work_order_id=$1`, [b.wo.id]);
    // 원재료 20000 x 20장
    t.eq(Number(cost.raw_cost), 400000, '원재료 원가');
    // 시약 5000 x 2통 (20장 구간)
    t.eq(Number(cost.pre_cut_cost), 10000, '재단 전 공정 자재');
    t.ok(Number(cost.post_cut_cost) > 0, '재단 후 공정 자재');

    const lots = await t.rows(
      `select product_lot_id, shared_cost::numeric, own_cost::numeric
         from v_product_lot_cost where work_order_id=$1 order by product_lot_id`, [b.wo.id]);
    t.eq(lots.length, 2, '제품 로트 수');
    const shared = lots.reduce((s, r) => s + Number(r.shared_cost), 0);
    t.eq(Math.round(shared), 410000, '배치 공통분이 생산 수량 비율로 배분된다');

    const spend = await t.val(
      `select count(*)::int from v_material_spend where item_id=$1`, [m.raw]);
    t.ok(spend > 0, '자재 지출은 매입 기준으로 따로 집계된다');
  },
},

{
  id: 'CO-02', expect: '확인',
  name: '제품 원가에 폐기분이 들어가지 않는다 (§10)',
  async run(t) {
    const m = await master(t);
    const b = await batch(t, m);
    const before = Number(await t.val(
      `select pre_cut_cost from v_batch_cost where work_order_id=$1`, [b.wo.id]));

    await t.rows(
      `insert into stock_movement (material_lot_id, type, qty, work_order_id, reason_code, registered_by)
       values ($1,'DISPOSAL_WIP',-2,$2,'오염',$3)`, [b.reagentLot, b.wo.id, m.admin]);

    t.eq(Number(await t.val(
      `select pre_cut_cost from v_batch_cost where work_order_id=$1`, [b.wo.id])),
      before, '폐기 후에도 원가가 변하지 않는다');
  },
},

// ---- 멸균 · 출고 (M4) --------------------------------------------------------

{
  id: 'SH-01', expect: '확인',
  name: '멸균 발송·회수가 제품 로트 상태를 따라간다',
  async run(t) {
    const m = await master(t);
    const b = await batch(t, m);

    const sb = await t.val(
      `insert into steril_batch (batch_no, vendor_name, registered_by)
       values ($1,'외부멸균업체',$2) returning id`,
      [await t.val(`select next_number('STERIL_BATCH')`), m.admin]);
    await t.rows(`insert into steril_batch_lot (steril_batch_id, product_lot_id, qty)
                  values ($1,$2,22),($1,$3,16)`, [sb, b.lotA, b.lotB]);

    await t.rows(`update steril_batch set shipped_at=current_date where id=$1`, [sb]);
    t.eq(await t.val(`select status::text from product_lot where id=$1`, [b.lotA]),
         'STERILIZING', '발송 후');

    await t.rows(`update steril_batch set received_at=current_date, cert_no='CERT-1' where id=$1`, [sb]);
    t.eq(await t.val(`select status::text from product_lot where id=$1`, [b.lotA]),
         'TESTED', '회수 후');
  },
},

{
  id: 'SH-02', expect: '예외',
  name: '회수일이 발송일보다 빠를 수 없다',
  async run(t) {
    const m = await master(t);
    await t.rejects(
      () => t.rows(`insert into steril_batch (batch_no, vendor_name, shipped_at, received_at, registered_by)
                    values ('ST-BAD','업체', current_date, current_date - 1, $1)`, [m.admin]),
      { code: '23514' });
  },
},

{
  id: 'SH-03', expect: '확인',
  name: '출고하면 출하 가능 수량이 줄어든다',
  async run(t) {
    const m = await master(t);
    const b = await batch(t, m);
    const before = Number(await t.val(
      `select qty_available from product_lot where id=$1`, [b.lotA]));

    await t.rows(
      `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by)
       values ($1,'거래처갑',10,current_date,$2)`, [b.lotA, m.admin]);

    t.eq(Number(await t.val(`select qty_available from product_lot where id=$1`, [b.lotA])),
         before - 10, '출고 후 잔여');
  },
},

{
  id: 'SH-04', expect: '예외',
  name: '출하 가능 수량보다 많이 출고할 수 없다',
  async run(t) {
    const m = await master(t);
    const b = await batch(t, m);
    await t.rejects(
      () => t.rows(`insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by)
                    values ($1,'거래처을',9999,current_date,$2)`, [b.lotA, m.admin]),
      { code: 'P0001', message: '출하 가능 수량' });
  },
},

{
  id: 'SH-05', expect: '확인',
  name: '샘플 수량은 출하 가능 수량에서 빠져 있다 (§4.5)',
  async run(t) {
    const m = await master(t);
    const b = await batch(t, m);
    const r = await t.one(
      `select qty_produced, qty_sample, qty_available, lot_no
         from product_lot where id=$1`, [b.lotA]);
    t.eq(Number(r.qty_sample), 2, '샘플 수량');
    t.ok(Number(r.qty_available) <= Number(r.qty_produced) - Number(r.qty_sample),
      '출하 가능 수량은 생산 수량에서 샘플을 뺀 값을 넘지 않는다');
  },
},

// ---- 감사추적 확장 -----------------------------------------------------------

{
  id: 'AU-01', expect: '확인',
  name: 'M1~M4 표가 모두 감사 대상이다',
  async run(t) {
    const missing = await t.rows(
      `select c.relname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relkind='r'
          and c.relname in ('item','supplier','item_supplier','price_history',
            'shelf_life_history','device_master','dmr_operation','dmr_bom','dmr_bom_tier',
            'purchase_order','material_lot','material_issue','stock_movement',
            'work_order','product_lot','process_record','steril_batch','steril_batch_lot',
            'shipment','record_print','day_lock')
          and not exists (select 1 from pg_trigger tg
                           where tg.tgrelid=c.oid and not tg.tgisinternal
                             and tg.tgname = c.relname || '_audit')`);
    t.eq(missing.map((r) => r.relname), [], '감사 트리거가 없는 표');
  },
},

{
  id: 'AU-02', expect: '권한 거부',
  name: 'app_role은 M1~M4 어느 표도 삭제할 수 없다',
  async run(t) {
    const tables = ['item', 'material_lot', 'material_issue', 'work_order',
      'product_lot', 'process_record', 'stock_movement', 'shipment', 'record_print', 'day_lock'];
    await t.asRole('app_role', async () => {
      for (const tb of tables) {
        await t.rejects(() => t.rows(`delete from ${tb}`), { code: '42501' });
      }
    });
  },
},

];
