// =============================================================================
// 39_model_udi.mjs - 형명 체계를 제품에 잇는다 · 형명의 UDI-DI (0158)
// 근거: 사용자 2026-11-25 «왜 계속 형명을 매칭을 못하지??» · «형명은 입력하면 자동으로
//       배치되게 해줘. 재단할때» · «형명에 따른 UDI 코드도 있으니까 다 입력해서 매칭하고.»
//
// 대표 품목이 형명이 아닌 제품(DX2401 → 대표 품목 DX2401)도 제품 코드로 이은 체계의 형명을
// 재단에서 고를 수 있는지, UDI-DI 는 숫자 14자리 · 형명마다 하나인지 본다.
// =============================================================================

export default [

{
  id: 'MU-01', expect: '통과',
  name: '대표 품목이 형명이 아니어도 제품 코드로 이은 체계의 형명을 고른다',
  async run(t) {
    /* 다른 시험의 체계(PD · PC)와 겹치지 않는 머리말을 쓴다 */
    const fin = (code) => t.val(
      `insert into item (code, name, type, purchase_uom, usage_uom, shelf_life_months)
       values ($1, $1, 'FIN', 'EA', 'EA', 24) returning id`, [code]);
    const rep = await fin('MQ2401');
    await fin('MQ05050510');
    await fin('MQ10152025');
    const dm = await t.val(
      `insert into device_master (item_id, revision, status, product_code)
       values ($1, 'Rev.MU1', 'DRAFT', 'MQ2401') returning id`, [rep]);

    const codes = async () => (await t.rows(`select code from dm_models($1)`, [dm])).map((r) => r.code);
    t.eq((await codes()).join(' '), 'MQ2401',
      '체계가 없으면 그 제품 코드로 시작하는 완제품 · 대표 품목 (0151 그대로)');

    const sc = await t.val(
      `insert into model_scheme (name, prefix, spec_pattern, name_pattern, product_code)
       values ('시험 진피', 'MQ1', '{1}x{2}cm', '{P} {1}x{2}cm', 'MQ2401') returning id`);
    await t.rows(
      `insert into model_segment (scheme_id, seq, digits, divisor, decimals, label, role)
       values ($1,1,2,1,0,'가로','WIDTH'), ($1,2,2,1,0,'세로','HEIGHT')`, [sc]);
    t.eq((await codes()).join(' '), 'MQ10152025',
      '제품 코드로 이은 체계가 있으면 그 체계의 형명만 (대표 품목은 빠진다)');

    await t.rows(`update model_scheme set is_active = false where id = $1`, [sc]);
    t.eq((await codes()).join(' '), 'MQ2401',
      '체계를 끄면 다시 대표 품목');
  },
},

{
  id: 'MU-02', expect: '통과',
  name: '형명의 UDI-DI 는 숫자 14자리이고 형명마다 하나다',
  async run(t) {
    const fin = (code, udi) => t.val(
      `insert into item (code, name, type, purchase_uom, usage_uom, shelf_life_months, udi_di)
       values ($1, $1, 'FIN', 'EA', 'EA', 24, $2) returning id`, [code, udi]);
    const a = await fin('MU-UDI-A', '08809911229990');
    t.eq(await t.val(`select udi_di from item where id = $1`, [a]), '08809911229990', '14자리는 들어간다');
    await t.resolves(() => fin('MU-UDI-B', null));
    await t.rejects(() => fin('MU-UDI-C', '8809911229990'), { code: '23514' });
    await t.rejects(() => fin('MU-UDI-D', '0880991122999X'), { code: '23514' });
    await t.rejects(() => fin('MU-UDI-E', '08809911229990'), { code: '23505' });
  },
},

];
