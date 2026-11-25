// =============================================================================
// 23_split_op.mjs - 형명이 갈리는 공정을 따로 적는다 (0138)
// 근거: 사용자 2026-11-20 «dx2402는 제조 공정도 상에 형명이 갈리는 위치는 1번
//       원료 준비 및 절단 단계임. 저때 형명별로 재단을 하고 그 후에 시약 처리»
//
// DX2402 는 01 에서 형명별로 자르지만 제조기록서는 그 뒤에도 배치 한 장이다.
// 갈림과 기록 단위가 바뀌는 자리가 다르므로 갈림을 공정에 따로 표시한다.
// 표시가 없으면 전처럼 «제품 로트 단위 공정 바로 앞» 이 갈림이다.
// =============================================================================

import { masterData as master, newMaterialLot, reverify } from '../fixtures.mjs';
import { cutModels } from '../../lib/cut-models.ts';

/** 공정 셋짜리 판: 01 절단(갈림 표시) · 02 처리(배치) · 03 포장(제품 로트) */
async function splitDm(t, m, rev, { mark = true } = {}) {
  const dm = await t.val(
    `insert into device_master (item_id, revision, status) values ($1, $2, 'DRAFT') returning id`,
    [m.fin, rev]);
  const op = async (seq, code, name, after, splits) => t.val(
    `insert into dmr_operation (device_master_id, seq, code, name, after_cutting, splits_models)
     values ($1,$2,$3,$4,$5,$6) returning id`, [dm, seq, code, name, after, splits]);
  const o1 = await op(1, `WS-${rev}-01`, '원료 준비 및 절단', false, mark);
  const o2 = await op(2, `WS-${rev}-02`, '바이러스 불활화', false, false);
  const o3 = await op(3, `WS-${rev}-03`, '포장', true, false);
  return { dm, o1, o2, o3 };
}

export default [

{
  id: 'SP-01', expect: '통과',
  name: '표시가 없으면 전처럼 제품 로트 단위 공정 바로 앞이 갈림 (DX2401 재단)',
  async run(t) {
    const m = await master(t);
    t.eq(await t.val(`select split_op_name($1)`, [m.dm]), '재단', '공용 표준서의 갈림은 재단');
    t.eq(await t.val(`select cut_operation_id($1)`, [m.dm]), m.ops['WS-DX2401-07'], '재단 공정');

    const s = await splitDm(t, m, 'Rev.SP1', { mark: false });
    t.eq(await t.val(`select cut_operation_id($1)`, [s.dm]), s.o2, '표시 없음: 포장 바로 앞');
  },
},

{
  id: 'SP-02', expect: '통과',
  name: '표시한 공정이 갈림 · 뒤에 배치 단위 공정이 있어도 · 제품 로트 단위 공정이 없어도',
  async run(t) {
    const m = await master(t);
    const s = await splitDm(t, m, 'Rev.SP2');
    t.eq(await t.val(`select cut_operation_id($1)`, [s.dm]), s.o1, '01 이 갈림');
    t.eq(await t.val(`select split_op_name($1)`, [s.dm]), '원료 준비 및 절단', '갈림 공정 이름');

    await t.rows(`update dmr_operation set after_cutting = false where id = $1`, [s.o3]);
    t.eq(await t.val(`select cut_operation_id($1)`, [s.dm]), s.o1,
      '제품 로트 단위 공정이 없어도 표시가 갈림');
  },
},

{
  id: 'SP-03', expect: '거부',
  name: '갈림 공정은 배치 단위 · 판마다 하나',
  async run(t) {
    const m = await master(t);
    const s = await splitDm(t, m, 'Rev.SP3');
    await t.rejects(
      () => t.rows(`update dmr_operation set after_cutting = true where id = $1`, [s.o1]),
      { message: 'dmr_operation_split_is_batch' });
    await t.rejects(
      () => t.rows(`update dmr_operation set splits_models = true where id = $1`, [s.o2]),
      { message: 'dmr_operation_one_split' });
    /* 옮기는 것은 된다: 먼저 끄고 켠다 (화면의 서버 동작이 이렇게 한다) */
    await t.resolves(async () => {
      await t.rows(`update dmr_operation set splits_models = false where id = $1`, [s.o1]);
      await t.rows(`update dmr_operation set splits_models = true where id = $1`, [s.o2]);
    });
    t.eq(await t.val(`select cut_operation_id($1)`, [s.dm]), s.o2, '02 로 옮겨졌다');
  },
},

{
  id: 'SP-04', expect: '통과',
  name: '갈림을 바꾸면 서면 대조가 풀린다 · 개정 복사가 표시를 옮긴다',
  async run(t) {
    const m = await master(t);
    const s = await splitDm(t, m, 'Rev.SP4');
    await reverify(t, s.dm, m.admin);
    await t.rows(`update dmr_operation set splits_models = false where id = $1`, [s.o1]);
    t.eq(await t.val(`select status from device_master where id = $1`, [s.dm]), 'DRAFT',
      '대조가 풀려 작성 중');
    t.eq(await t.val(`select verified_at from device_master where id = $1`, [s.dm]), null,
      '대조 확인 거둠');

    await t.rows(`update dmr_operation set splits_models = true where id = $1`, [s.o1]);
    const dst = await t.val(
      `insert into device_master (item_id, revision, status) values ($1, 'Rev.SP4b', 'DRAFT')
       returning id`, [m.fin]);
    await t.rows(`select copy_dmr_structure($1, $2)`, [s.dm, dst]);
    t.eq(await t.val(
      `select code from dmr_operation where device_master_id = $1 and splits_models`, [dst]),
      'WS-Rev.SP4-01', '갈림 표시가 옮겨졌다');
  },
},

{
  id: 'SP-05', expect: '확인',
  name: '현장은 표시한 갈림 공정에서 제조번호를 부여하고, 그 뒤 배치 단위 공정은 배치에 기록',
  async run(t) {
    const m = await master(t);
    const s = await splitDm(t, m, 'Rev.SP5');
    await t.rows(
      `update device_master set effective_from = current_date where id = $1`, [s.dm]);
    await reverify(t, s.dm, m.admin);

    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510', qty: 50 });
    const wo = await t.val(
      `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
         material_lot_id, sheet_count, issued_by_prod, issued_by_qa)
       values (next_number('WORK_ORDER'), next_number('BATCH'), $1, 'Rev.SP5', $2, 10, $3, $4)
       returning id`, [s.dm, rawLot, m.admin, m.qa]);

    await t.setActor(m.worker);
    await t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
         worker_id, started_at)
       values ($1,$2,1,current_date,$3,now())`, [wo, s.o1, m.worker]);
    const lot = await t.val(
      `select cut_product_lot_field($1,$2,$3,$4,current_date)`, [wo, m.fin, 10, 1]);
    t.ok(!!lot, '01 절단에서 제품 로트가 생겼다');

    await t.resolves(() => t.rows(
      `insert into process_record (work_order_id, operation_id, day_no, work_date,
         worker_id, started_at)
       values ($1,$2,1,current_date,$3,now())`, [wo, s.o2, m.worker]));
    t.eq(await t.val(
      `select product_lot_id from process_record where work_order_id = $1 and operation_id = $2`,
      [wo, s.o2]), null, '02 는 배치에 붙는다');
    await t.setActor(null);
  },
},

{
  id: 'SP-06', expect: '통과',
  name: '갈림에서 고를 형명은 그 제품의 형명 체계 것만',
  async run(t) {
    const m = await master(t);
    /*
     * 다른 시험이 형명 체계를 바꿔 두었을 수 있다 (12_model_scheme). 그래서 개수를
     * 박지 않고 «섞이지 않는다» · «대표 형명이 든다» 만 본다.
     */
    const sc = await t.val(
      `insert into model_scheme (name, prefix, spec_pattern, name_pattern)
       values ('이종 늑연골 완제품', 'PC', '두께 {1} mm × 길이 {2} mm × 너비 {3} mm', '{P} {1}x{2}x{3}mm')
       returning id`);
    await t.rows(
      `insert into model_segment (scheme_id, seq, digits, divisor, decimals, label, role)
       values ($1,1,2,1,0,'두께 (mm)',null), ($1,2,2,1,0,'길이 (mm)',null), ($1,3,2,1,0,'너비 (mm)',null)`,
      [sc]);
    const fin = (code, name) => t.val(
      `insert into item (code, name, type, purchase_uom, usage_uom, shelf_life_months)
       values ($1, $2, 'FIN', 'EA', 'EA', 24) returning id`, [code, name]);
    const pc1 = await fin('PC032004', 'DX2402 3x20x4mm');
    await fin('PC035008', 'DX2402 3x50x8mm');
    const loose = await fin('ZZ-SP6', '체계 밖 완제품');

    t.eq(await t.val(`select spec_label('PC032004')`), '두께 3 mm × 길이 20 mm × 너비 4 mm',
      '늑연골 규격 문구');
    const dermis = (await t.rows(`select code from dm_models($1)`, [m.dm])).map((r) => r.code);
    t.ok(dermis.includes('PD05050510'), '진피: 대표 형명이 든다');
    t.ok(!dermis.some((c) => c.startsWith('PC')), '진피 배치에 늑연골 형명이 섞이지 않는다');

    const dmPc = await t.val(
      `insert into device_master (item_id, revision, status) values ($1, 'Rev.SP6', 'DRAFT') returning id`,
      [pc1]);
    t.eq((await t.rows(`select code from dm_models($1)`, [dmPc])).map((r) => r.code).join(' '),
      'PC032004 PC035008', '늑연골: PC 형명만');

    const dmLoose = await t.val(
      `insert into device_master (item_id, revision, status) values ($1, 'Rev.SP6', 'DRAFT') returning id`,
      [loose]);
    const outside = (await t.rows(`select code from dm_models($1)`, [dmLoose])).map((r) => r.code);
    t.ok(outside.includes('ZZ-SP6'), '체계 밖 대표 형명: 자기 자신이 든다');
    t.ok(!outside.some((c) => c.startsWith('PC')), '체계 밖 대표 형명: 체계에 든 형명은 빠진다');
  },
},

{
  id: 'SP-07', expect: '통과',
  name: '재단에서 고를 형명의 두께 구간은 형명 체계가 정한다 · 두께 자리가 없는 체계는 원료 두께로 거르지 않는다',
  async run(t) {
    /*
     * 현장 재단 목록이 뒤 네 자리(right(code, 4))로 두께를 보던 것을 관리 화면과 같은
     * model_band 로 맞춘다 (2026-11-25). 운영 PD 62종은 둘이 같지만 PC 12종은 두께 자리가
     * 없어 model_band 가 비고, 뒤 네 자리는 길이 · 너비 자리다 - 원료 로트에 두께가 적히면
     * 숫자가 우연히 맞는 형명 하나만 남는다. 다른 시험의 체계와 겹치지 않는 머리말을 쓴다.
     */
    const scheme = async (prefix, roles) => {
      const id = await t.val(
        `insert into model_scheme (name, prefix, spec_pattern, name_pattern)
         values ($1, $1, '{1}', '{P}') returning id`, [prefix]);
      for (const [i, role] of roles.entries()) {
        await t.rows(
          `insert into model_segment (scheme_id, seq, digits, divisor, decimals, label, role)
           values ($1, $2, 2, 1, 0, '자리', $3)`, [id, i + 1, role]);
      }
    };
    const fin = (code) => t.val(
      `insert into item (code, name, type, purchase_uom, usage_uom, shelf_life_months)
       values ($1, $1, 'FIN', 'EA', 'EA', 24) returning id`, [code]);
    const dmOf = (item) => t.val(
      `insert into device_master (item_id, revision, status) values ($1, 'Rev.SP7', 'DRAFT') returning id`,
      [item]);
    const codes = async (dm, band) => (await cutModels(t, dm, band)).map((x) => x.code).join(' ');

    await scheme('QD', ['WIDTH', 'HEIGHT', 'BAND', 'BAND']);
    const d1 = await fin('QD05050510');
    await fin('QD05051015');
    await fin('QD10150510');
    const dmD = await dmOf(d1);
    t.eq(await codes(dmD, null), 'QD05050510 QD05051015 QD10150510', '원료 두께가 없으면 이 제품의 형명 전부');
    t.eq(await codes(dmD, '0510'), 'QD05050510 QD10150510', '원료 두께 구간의 형명만');
    t.eq(await codes(dmD, '2530'), '', '맞는 두께의 형명이 없으면 빈 목록 (현장 화면이 관리자에게 미룬다)');

    await scheme('QC', [null, null, null]);
    const c1 = await fin('QC032004');
    await fin('QC033004');
    await fin('QC035008');
    const dmC = await dmOf(c1);
    t.eq(await codes(dmC, '2004'), 'QC032004 QC033004 QC035008',
      '두께 자리가 없는 체계는 원료 두께가 적혀 있어도 거르지 않는다');
  },
},

];
