// =============================================================================
// 16_solution.mjs · 원액 로트 · S02 두 갈래 (§2 · §4.4 · 0117 · 0118)
//
// 원액은 사내에서 만들어 보관하다 여러 배치에 이어 쓰므로 자재 로트 한 줄로
// 선다. 그런데 원액에는 성적서가 없다. 성적서 칸에 다른 문서의 번호를 채우면
// 성적서가 아닌 것을 성적서라 적는 셈이라(§1), S02 를 두 갈래로 나눈다.
//
//   입고 로트   성적서 번호 · 일자 · 공급자 · 공급자 로트가 모두 있다 (그대로)
//   원액 로트   넷이 모두 비고 제조일이 있다
//
// 이 파일은 그 갈래가 **한 문장 안에서** 거부되는 것만 본다. 원료 줄이 하나도
// 없는 원액 로트를 막는 커밋 시 검사(T1)와 원액을 실제로 세우는 시험은 그 검사가
// 생긴 뒤에 이 파일에 이어 붙는다.
// =============================================================================

import { masterData as master, newMaterialLot } from '../fixtures.mjs';

let seq = 0;

/**
 * 원액 품목 하나를 세우고 id 를 돌려준다.
 *
 *   opts.shelf_life_months  기본 6. 사용기간이 비어 있는 원액을 보려면 null 을 준다
 *   opts.code               기본은 시험마다 겹치지 않는 값
 *
 * 20X PBS 는 리터로 만들고 리터로 쓴다 (§4.2 구매 단위와 사용 단위가 같다).
 */
export async function solutionItem(t, opts = {}) {
  seq += 1;
  const months = 'shelf_life_months' in opts ? opts.shelf_life_months : 6;
  return t.val(
    `insert into item (code, name, type, purchase_uom, usage_uom, shelf_life_months)
     values ($1, $2, 'SOLUTION', 'L', 'L', $3) returning id`,
    [opts.code ?? `SOL-T${String(seq).padStart(3, '0')}`,
     opts.name ?? `시험 원액 ${seq}`,
     months]);
}

/** 품목 하나. 유형은 인자로 준다. */
async function plainItem(t, type, tag) {
  seq += 1;
  return t.val(
    `insert into item (code, name, type, purchase_uom, usage_uom)
     values ($1, $2, $3::item_type, 'EA', 'EA') returning id`,
    [`SLX-${tag}-${seq}`, `유형 시험 ${tag} ${seq}`, type]);
}

export default [

// ---- S02 의 두 갈래 ------------------------------------------------------------

{
  id: 'SL-01', expect: '예외',
  name: 'S02 원액이 아닌 품목의 로트에 제조일',
  async run(t) {
    const m = await master(t);
    /*
     * 표 안의 검사(material_lot_source)는 제조일이 있고 성적서 · 공급자가 모두
     * 빈 줄을 원액 갈래로 보고 통과시킨다. 그 품목이 원액인지는 다른 표를 봐야
     * 알 수 있으므로 트리거(T2)가 잡는다.
     */
    await t.rejects(
      () => t.rows(
        `insert into material_lot (item_id, lot_no, made_on, received_at,
           registered_by, qty_received, qty_available)
         values ($1,'X-SL01',current_date,now(),$2,1,1)`,
        [m.reagent, m.admin]),
      { code: 'P0001' });
  },
},

{
  id: 'SL-02', expect: '예외',
  name: 'S02 원액 로트에 제조일과 성적서 번호를 함께 (갈래 섞기)',
  async run(t) {
    const m = await master(t);
    const sol = await solutionItem(t);
    /*
     * 원액 품목이고 제조일이 있으므로 T2 는 지나간다. 걸리는 것은 표 안의
     * 검사다 - 두 갈래는 섞을 수 없다.
     */
    await t.rejects(
      () => t.rows(
        `insert into material_lot (item_id, lot_no, made_on, supplier_id, supplier_lot_no,
           coa_no, coa_date, received_at, registered_by, qty_received, qty_available)
         values ($1,'X-SL02',current_date,$2,'SL','COA-X',current_date,now(),$3,1,1)`,
        [sol, m.supplier, m.admin]),
      { code: '23514' });
    /* 성적서 번호 하나만 얹어도 섞인 것이다 */
    await t.rejects(
      () => t.rows(
        `insert into material_lot (item_id, lot_no, made_on, coa_no, received_at,
           registered_by, qty_received, qty_available)
         values ($1,'X-SL02b',current_date,'COA-X',now(),$2,1,1)`,
        [sol, m.admin]),
      { code: '23514' });
  },
},

{
  id: 'SL-03', expect: '예외',
  name: 'S02 원액 품목의 로트를 입고 갈래로 (제조일 없음, 성적서 있음)',
  async run(t) {
    const m = await master(t);
    const sol = await solutionItem(t);
    /*
     * 성적서 · 공급자가 다 있으니 표 안의 검사는 입고 갈래로 보고 통과시킨다.
     * 원액 품목이 입고 로트로 서는 길은 T2 가 닫는다.
     */
    await t.rejects(
      () => t.rows(
        `insert into material_lot (item_id, lot_no, supplier_id, supplier_lot_no,
           coa_no, coa_date, received_at, registered_by, qty_received, qty_available)
         values ($1,'X-SL03',$2,'SL','COA-X',current_date,now(),$3,1,1)`,
        [sol, m.supplier, m.admin]),
      { code: 'P0001' });
  },
},

// ---- 품목 유형은 로트가 생긴 뒤 바꾸지 못한다 -----------------------------------

{
  id: 'SL-04', expect: '예외',
  name: '불변식 로트가 있는 품목의 유형 변경',
  async run(t) {
    const m = await master(t);

    /* 로트가 있는 품목: 유형 변경은 거부, 다른 칸 고치기는 통과 */
    const withLot = await plainItem(t, 'REAGENT', 'lot');
    await newMaterialLot(t, m, withLot, { qty: 5 });
    await t.rejects(
      () => t.rows(`update item set type = 'SOLUTION' where id = $1`, [withLot]),
      { code: 'P0001' });
    await t.rejects(
      () => t.rows(`update item set type = 'PACK' where id = $1`, [withLot]),
      { code: 'P0001' });
    await t.resolves(
      () => t.rows(`update item set name = '이름만 고침' where id = $1`, [withLot]));
    await t.resolves(
      () => t.rows(`update item set type = 'REAGENT' where id = $1`, [withLot]));
    t.eq(await t.val(`select type::text from item where id = $1`, [withLot]),
         'REAGENT', '거부된 뒤 유형');

    /* 로트가 없는 품목: 유형을 바로잡을 수 있다 */
    const fresh = await plainItem(t, 'PACK', 'nolot');
    await t.resolves(
      () => t.rows(`update item set type = 'REAGENT' where id = $1`, [fresh]));
    t.eq(await t.val(`select type::text from item where id = $1`, [fresh]),
         'REAGENT', '로트 없는 품목의 유형');
  },
},

];
