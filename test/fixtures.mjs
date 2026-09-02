// =============================================================================
// fixtures.mjs · M1~M4 시험용 기준정보
//
// DX2401 공정 구조(§3)를 그대로 세운다. 실제 제품표준서 값이 아니라 구조를
// 시험하기 위한 최소 골격이다. 크기·두께·소요량 실값은 제품표준서에서 오며
// 관리 화면으로 넣는다.
// =============================================================================

// §3 공정 순서. WS-07(재단) 자체는 false이고 WS-08부터 true다.
export const OPERATIONS = [
  { seq: 1,  code: 'WS-DX2401-01', name: 'NaCl 처리·세척', after_cutting: false },
  { seq: 2,  code: 'WS-DX2401-02', name: '초임계 가공',     after_cutting: false },
  { seq: 3,  code: 'WS-DX2401-03', name: '알칼리 처리',     after_cutting: false },
  { seq: 4,  code: 'WS-DX2401-04', name: 'H2O2 처리',       after_cutting: false },
  { seq: 5,  code: 'WS-DX2401-05', name: '세척',            after_cutting: false },
  { seq: 6,  code: 'WS-DX2401-06', name: '동결건조',        after_cutting: false },
  { seq: 7,  code: 'PI-DX2401-01', name: '1차 반제품 검사', after_cutting: false },
  { seq: 8,  code: 'WS-DX2401-07', name: '재단',            after_cutting: false },
  { seq: 9,  code: 'WS-DX2401-08', name: '포장(1·2차)',     after_cutting: true  },
  { seq: 10, code: 'PI-DX2401-02', name: '2차 반제품 검사', after_cutting: true  },
  { seq: 11, code: 'WS-DX2401-09', name: '멸균(외부 위탁)', after_cutting: true  },
  { seq: 12, code: 'FI-DX2401-01', name: '완제품 검사',     after_cutting: true  },
];

// §4.3 시약은 10장 단위 3구간, 타이백은 5장 단위 6구간.
export const REAGENT_TIERS = [
  { min_sheets: 1,  max_sheets: 10, qty: 1 },
  { min_sheets: 11, max_sheets: 20, qty: 2 },
  { min_sheets: 21, max_sheets: 30, qty: 3 },
];

export const TYVEK_TIERS = [
  { min_sheets: 1,  max_sheets: 5,  qty: 1 },
  { min_sheets: 6,  max_sheets: 10, qty: 2 },
  { min_sheets: 11, max_sheets: 15, qty: 3 },
  { min_sheets: 16, max_sheets: 20, qty: 4 },
  { min_sheets: 21, max_sheets: 25, qty: 5 },
  { min_sheets: 26, max_sheets: 30, qty: 6 },
];

// 시드는 실행당 한 번이다. 시험 파일이 여럿이라 모듈 수준에서 프라미스를
// 캐시한다. 결과가 아니라 프라미스를 캐시해야 중간 실패가 중복 삽입으로
// 번지지 않는다.
let SEED = null;

/** 기준정보 한 벌. 여러 시험 파일이 같은 것을 나눠 쓴다. */
export function masterData(t) {
  return (SEED ??= seedMasterData(t));
}

/** 기준정보 한 벌을 세우고 식별자를 돌려준다. */
async function seedMasterData(t) {
  const admin = t.fx.admin;

  const qa = await t.newUser({ full_name: '품질담당' });
  const worker = await t.newUser({ full_name: '작업자갑' });
  const worker2 = await t.newUser({ full_name: '작업자을' });

  const supplier = await t.val(
    `insert into supplier (code, name, status, approved_until)
     values ('SUP-001', '승인공급자', 'APPROVED', current_date + 365) returning id`);
  const supplierPending = await t.val(
    `insert into supplier (code, name, status)
     values ('SUP-002', '미승인공급자', 'PENDING') returning id`);

  const mkItem = (code, name, type, uom = 'EA', pu = 'EA', conv = 1) =>
    t.val(
      `insert into item (code, name, type, purchase_uom, usage_uom, conversion)
       values ($1,$2,$3::item_type,$4,$5,$6) returning id`,
      [code, name, type, pu, uom, conv]);

  const raw = await mkItem('RM-006', '돈피 원재료', 'RAW', '장', '장');
  const reagent = await mkItem('RG-001', '알칼리 시약', 'REAGENT', '통', '통');
  const reagent2 = await mkItem('RG-002', 'H2O2 시약', 'REAGENT', '통', '통');
  const tyvek = await mkItem('PM-001', '타이백', 'PACK', 'EA', 'EA');
  const pouch = await mkItem('PM-002', '파우치', 'PACK', 'EA', 'EA');
  const label = await mkItem('PM-003', '라벨', 'PACK', 'EA', 'EA');

  /*
   * 형명 체계 (0075). 빈 설치에는 이관이 심어 주지 않는다 - 처음 받는
   * 제조소에 DOF 의 규칙을 깔면 안 되기 때문이다. 그래서 시험도 스스로 넣는다.
   *
   * 값은 DX2401 의 규칙 그대로다. 12_model_scheme.mjs 가 이 값과 무관하게
   * 사양의 규칙을 JS 로 다시 셈해 견주므로, 여기를 잘못 적으면 그쪽이 잡는다.
   */
  const scheme = await t.val(
    `insert into model_scheme (name, prefix, spec_pattern, name_pattern)
     values ('이종 진피 완제품', 'PD',
             '{1}x{2}cm · 두께 {3}~{4}mm', '{P} {1}x{2}cm {3}~{4}mm')
     returning id`);
  await t.rows(
    `insert into model_segment (scheme_id, seq, digits, divisor, decimals, label, role)
     values ($1,1,2,1,0,'가로 (cm)','WIDTH'),
            ($1,2,2,1,0,'세로 (cm)','HEIGHT'),
            ($1,3,2,10,1,'두께 하한 (mm)','BAND'),
            ($1,4,2,10,1,'두께 상한 (mm)','BAND')`, [scheme]);

  // 완제품 형명. 규칙으로 생성한다 (§4.2 "62개를 손으로 등록하지 말 것").
  const generated = await t.rows(
    `select * from generate_finished_items(
       array['0505','1015','1018','1215'],
       array['0510','1015','1520','2025','2530'],
       array['10152530','10182530','12152530'],
       'DX2401')`);
  const fin = await t.val(`select id from item where code = 'PD05050510'`);

  // 제품표준서
  const dm = await t.val(
    `insert into device_master (item_id, revision, status, effective_from, verified_by, verified_at)
     values ($1, 'Rev.02', 'ACTIVE', current_date, $2, now()) returning id`,
    [fin, admin]);

  const ops = {};
  for (const o of OPERATIONS) {
    ops[o.code] = await t.val(
      `insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
       values ($1,$2,$3,$4,$5) returning id`,
      [dm, o.seq, o.code, o.name, o.after_cutting]);
  }

  // 자재 구성표. 원재료는 넣지 않는다 (§5 S05 주석).
  const mkTierBom = async (opId, itemId, tiers) => {
    const bom = await t.val(
      `insert into dmr_bom (operation_id, component_item_id, basis)
       values ($1,$2,'SHEET_TIER') returning id`, [opId, itemId]);
    for (const x of tiers) {
      await t.rows(
        `insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
         values ($1,$2,$3,$4)`, [bom, x.min_sheets, x.max_sheets, x.qty]);
    }
    return bom;
  };
  const mkUnitBom = (opId, itemId, per) =>
    t.val(
      `insert into dmr_bom (operation_id, component_item_id, basis, qty_per_unit)
       values ($1,$2,'PER_UNIT',$3) returning id`, [opId, itemId, per]);

  await mkTierBom(ops['WS-DX2401-03'], reagent, REAGENT_TIERS);
  await mkTierBom(ops['WS-DX2401-04'], reagent2, REAGENT_TIERS);
  await mkTierBom(ops['WS-DX2401-08'], tyvek, TYVEK_TIERS);
  await mkUnitBom(ops['WS-DX2401-08'], pouch, 1);
  await mkUnitBom(ops['WS-DX2401-08'], label, 2);

  // 채번 규칙
  const rule = (target, pattern, width = 4) =>
    t.rows(
      `insert into numbering_rule (target, pattern, reset, seq_width, effective_from, registered_by)
       values ($1::numbering_target, $2, 'YEARLY', $3, current_date, $4)
       on conflict do nothing`,
      [target, pattern, width, admin]);
  await rule('MATERIAL_LOT', 'ML-{YY}{MM}-{SEQ:4}');
  await rule('WORK_ORDER',   'WO-{YY}{MM}-{SEQ:4}');
  await rule('BATCH',        'B{YY}{MM}-{SEQ:4}');
  await rule('PRODUCT_LOT',  'P{YY}{MM}-{SEQ:4}');
  await rule('STERIL_BATCH', 'ST-{YY}{MM}-{SEQ:3}', 3);
  await rule('DEVIATION',    'DV-{YY}-{SEQ:3}', 3);

  return {
    admin, qa, worker, worker2,
    supplier, supplierPending,
    raw, reagent, reagent2, tyvek, pouch, label, fin,
    dm, ops, generatedCount: generated.length,
  };
}

/** 자재 로트 하나. 기본은 승인 공급자·충분한 수량. */
export async function newMaterialLot(t, m, itemId, opts = {}) {
  const lotNo = opts.lot_no ?? (await t.val(`select next_number('MATERIAL_LOT')`));
  return t.val(
    `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no, coa_no,
       coa_date, received_at, registered_by, qty_received, qty_available, unit_price,
       expiry_date, thickness_band)
     values ($1,$2,$3,$4,$5, current_date, now(), $6, $7, $7, $8, $9, $10)
     returning id`,
    [itemId, lotNo, opts.supplier ?? m.supplier, opts.supplier_lot_no ?? 'SL-001',
     opts.coa_no ?? 'COA-001', m.admin, opts.qty ?? 100, opts.unit_price ?? 1000,
     opts.expiry ?? null, opts.thickness_band ?? null]);
}

/** 작업지시 하나. 원재료 로트 1건에 대응한다. */
export async function newWorkOrder(t, m, opts = {}) {
  const rawLot = opts.rawLot ?? (await newMaterialLot(t, m, m.raw, { thickness_band: '0510' }));
  const woNo = await t.val(`select next_number('WORK_ORDER')`);
  const batchNo = await t.val(`select next_number('BATCH')`);
  const id = await t.val(
    `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
       material_lot_id, sheet_count, issued_by_prod, issued_by_qa)
     values ($1,$2,$3,'Rev.02',$4,$5,$6,$7) returning id`,
    [woNo, batchNo, m.dm, rawLot, opts.sheets ?? 20, m.admin, m.qa]);
  return { id, woNo, batchNo, rawLot };
}
