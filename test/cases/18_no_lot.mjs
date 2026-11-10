// =============================================================================
// 18_no_lot.mjs - 로트 없이 쓰는 소모품 · 개정본 복사가 빠뜨린 칸 (0129)
// 근거: 사용자 2026-11-10 «PM-021 은 로트번호 없이 단순 소모품으로 사용되니까
//       굳이 로트 번호를 기입할 필요 없어서 그냥 공란을 디폴트값으로»
//
// 로트 없이 쓰는 품목은 공정 마감(S05)과 검토가 그 줄을 묻지 않고, 로트를
// 기록하는 자재는 지금처럼 묻는지 본다. 개정본 복사가 재작업 칸과 구간 상한을
// 함께 옮기는지도 본다.
//
// 기준정보 한 벌(fixtures)은 지시가 이미 나가 구성표가 얼어 있다 (0089). 그래서
// 이 파일은 자기 제품표준서를 따로 세운다.
// =============================================================================

import { masterData as master, newMaterialLot } from '../fixtures.mjs';

let SETUP = null;

/* 제품표준서 하나: 초임계(소모품만) · 알칼리(소모품 + 시약) */
async function setup(t, m) {
  return (SETUP ??= (async () => {
    const noLot = await t.val(
      `insert into item (code, name, type, purchase_uom, usage_uom, conversion, lot_tracked)
       values ('PM-921', '타이벡 파우치(시험)', 'PROCESS', 'EA', 'EA', 1, false) returning id`);
    const dm = await t.val(
      `insert into device_master (item_id, revision, status, effective_from, verified_by, verified_at)
       values ($1, 'Rev.31', 'ACTIVE', current_date, $2, now()) returning id`, [m.fin, m.admin]);
    const op = async (seq, code, name) => t.val(
      `insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
       values ($1,$2,$3,$4,false) returning id`, [dm, seq, code, name]);
    const sc = await op(1, 'WS-NL-02', '초임계 가공');
    const al = await op(2, 'WS-NL-03', '알칼리 처리');
    const tier = async (opId, itemId, qty) => {
      const b = await t.val(
        `insert into dmr_bom (operation_id, component_item_id, basis)
         values ($1,$2,'SHEET_TIER') returning id`, [opId, itemId]);
      await t.rows(`insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
                    values ($1, 1, 30, $2)`, [b, qty]);
    };
    await tier(sc, noLot, 4);
    await tier(al, noLot, 1);
    await tier(al, m.reagent, 2);
    return { noLot, dm, sc, al };
  })());
}

async function workOrder(t, m, s) {
  const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510' });
  return t.val(
    `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
       material_lot_id, sheet_count, issued_by_prod, issued_by_qa)
     values (next_number('WORK_ORDER'), next_number('BATCH'), $1, 'Rev.31', $2, 20, $3, $4)
     returning id`, [s.dm, rawLot, m.admin, m.qa]);
}

async function record(t, m, wo, opId, reason = null) {
  return t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date,
       worker_id, no_material_reason)
     values ($1,$2,1,current_date,$3,$4) returning id`, [wo, opId, m.worker, reason]);
}

export default [

{
  id: 'NL-01', expect: '통과',
  name: '로트 없이 쓰는 소모품만 걸린 공정은 투입도 사유도 없이 마감된다',
  async run(t) {
    const m = await master(t);
    const s = await setup(t, m);
    const wo = await workOrder(t, m, s);
    await t.setActor(m.admin);
    const pr = await record(t, m, wo, s.sc);
    await t.rows(`select complete_process($1)`, [pr]);
    t.ok(await t.val(`select ended_at is not null from process_record where id = $1`, [pr]), '마감됨');
    await t.setActor(null);
  },
},

{
  id: 'NL-02', expect: '거부',
  name: '로트를 기록하는 자재가 함께 걸리면 S05 가 그 자재만 묻는다',
  async run(t) {
    const m = await master(t);
    const s = await setup(t, m);
    const wo = await workOrder(t, m, s);
    await t.setActor(m.admin);
    const pr = await record(t, m, wo, s.al);
    try {
      const err = await t.rejects(() => t.rows(`select complete_process($1)`, [pr]), { message: 'S05' });
      const msg = String(err.message);
      t.ok(msg.includes('알칼리 시약'), `시약을 짚어야 한다: ${msg}`);
      t.ok(!msg.includes('타이벡 파우치(시험)'), `소모품은 묻지 않아야 한다: ${msg}`);
    } finally {
      await t.setActor(null);
    }
  },
},

{
  id: 'NL-03', expect: '확인',
  name: '소모품만 걸린 공정의 사유 마감은 검토가 짚지 않고, 시약이 걸린 공정은 짚는다',
  async run(t) {
    const m = await master(t);
    const s = await setup(t, m);
    const wo = await workOrder(t, m, s);
    await t.setActor(m.admin);
    await record(t, m, wo, s.sc, '자재 사용 없음');
    await record(t, m, wo, s.al, '자재 사용 없음');
    await t.setActor(null);
    const rows = (await t.rows(`select kind, detail from review_flags($1)`, [wo]))
      .filter((r) => r.kind === '기입 누락' && r.detail.includes('자재를 기록하지 않고'));
    t.eq(rows.length, 1, `한 줄만 (${rows.map((r) => r.detail).join(' / ')})`);
    t.ok(rows[0].detail.includes('WS-NL-03'), `알칼리 처리여야 한다: ${rows[0].detail}`);
  },
},

{
  id: 'NL-04', expect: '확인',
  name: '개정본 복사가 재작업 칸과 구간 상한을 함께 옮긴다',
  async run(t) {
    const m = await master(t);
    const src = await t.val(
      `insert into device_master (item_id, revision, status) values ($1, 'Rev.32', 'DRAFT') returning id`,
      [m.fin]);
    const op = await t.val(
      `insert into dmr_operation (device_master_id, seq, code, name, after_cutting, takes_rework)
       values ($1, 1, 'WS-CP-08', '포장', true, true) returning id`, [src]);
    const b = await t.val(
      `insert into dmr_bom (operation_id, component_item_id, basis)
       values ($1,$2,'SHEET_TIER') returning id`, [op, m.reagent]);
    await t.rows(`insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty, qty_max)
                  values ($1, 1, 10, 292.2, 293)`, [b]);
    const dst = await t.val(
      `insert into device_master (item_id, revision, status) values ($1, 'Rev.33', 'DRAFT') returning id`,
      [m.fin]);
    await t.rows(`select copy_dmr_structure($1, $2)`, [src, dst]);
    const got = await t.rows(
      `select o.takes_rework, t.qty, t.qty_max
         from dmr_operation o join dmr_bom b on b.operation_id = o.id
         join dmr_bom_tier t on t.dmr_bom_id = b.id
        where o.device_master_id = $1`, [dst]);
    t.eq(got.length, 1, '구간 한 줄');
    t.eq(got[0].takes_rework, true, '재작업 칸');
    t.eq(Number(got[0].qty_max), 293, '구간 상한');
  },
},

];
