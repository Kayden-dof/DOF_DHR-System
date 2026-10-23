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
// SL-01~04 는 그 갈래가 **한 문장 안에서** 거부되는 것을 본다.
// SL-05~11 은 원료 줄이 생긴 뒤의 것이다 (0119) - 원료 줄이 하나도 없는 원액
// 로트를 막는 커밋 시 검사(T1), 원액을 실제로 세우는 make_solution_lot, 원료
// 줄이 원액을 가리키는 방식(T3)과 고쳐 쓰기 차단(T5).
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

/**
 * 원액 한 로트를 make_solution_lot 으로 세운다. 원료는 시약 두 종 (각 10) 에서
 * 꺼낸다 - 화면이 부르는 것과 같은 함수를 같은 순서로 부른다.
 *
 *   o.item    원액 품목. 없으면 새로 세운다
 *   o.qty     제조량 (기본 5)
 *   o.draw    원료 두 로트에서 꺼내는 양 (기본 [3, 2])
 *   o.prices  원료 두 로트의 단가 (기본 [1000, 1000]). null 이면 단가 없음
 *   o.made    제조일 (기본 2026-10-22)
 *   o.note    비고
 */
async function brew(t, m, o = {}) {
  const item = o.item ?? await solutionItem(t);
  const prices = o.prices ?? [1000, 1000];
  const draw = o.draw ?? [3, 2];
  const a = await newMaterialLot(t, m, m.reagent,  { qty: 10 });
  const b = await newMaterialLot(t, m, m.reagent2, { qty: 10 });
  /* 픽스처의 단가는 비어 있으면 1000 으로 채워지므로 따로 맞춘다 */
  for (const [lot, price] of [[a, prices[0]], [b, prices[1]]]) {
    if (price !== 1000) {
      await t.rows(`update material_lot set unit_price = $2 where id = $1`, [lot, price]);
    }
  }
  await t.setActor(m.admin);
  try {
    const id = await t.val(
      `select make_solution_lot($1, $2::date, $3, array[$4,$5]::uuid[],
                                array[$6,$7]::numeric[], $8)`,
      [item, o.made ?? '2026-10-22', o.qty ?? 5, a, b, draw[0], draw[1], o.note ?? null]);
    return { item, id, a, b };
  } finally {
    await t.setActor(null);
  }
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

// ---- 원액 로트는 원료 로트에서 선다 (0119) -------------------------------------

{
  id: 'SL-05', expect: '예외',
  name: '불변식 원액 로트의 제조일 고쳐 쓰기',
  async run(t) {
    const m = await master(t);
    const { id } = await brew(t, m);
    t.eq(await t.val(`select made_on::text from material_lot where id = $1`, [id]),
         '2026-10-22', '제조일');

    /*
     * 제조일은 번호의 날짜이고 유효기간의 출발점이다. 입고 로트와 원액 로트가
     * 서로 바뀌면 그 로트를 쓴 배치의 계보가 통째로 뒤집히므로 item_id 와 같은
     * 자리에서 잠근다 (material_lot_coa_once). 메시지에 칸 이름이 든 것으로
     * 그 트리거가 막았음을 가린다 - 제조일 검사(T2)의 말과 다르다.
     */
    await t.rejects(
      () => t.rows(`update material_lot set made_on = date '2026-10-23' where id = $1`, [id]),
      { code: 'P0001', message: 'made_on' });
    await t.rejects(
      () => t.rows(`update material_lot set made_on = null where id = $1`, [id]),
      { code: 'P0001', message: 'made_on' });
    t.eq(await t.val(`select made_on::text from material_lot where id = $1`, [id]),
         '2026-10-22', '거부된 뒤 제조일');

    /* 정상 작업은 막지 않는다 - 보관 위치 같은 칸은 그대로 고친다 */
    await t.resolves(
      () => t.rows(`update material_lot set location = '냉장 1단' where id = $1`, [id]));
  },
},

{
  id: 'SL-06', expect: '예외',
  name: 'S02 원액 로트를 원료 줄 없이 (커밋 때 검사)',
  async run(t) {
    /*
     * 기준정보를 쓰지 않는다. 원액 품목 하나와 시험 계정이면 된다 - 돌연변이
     * 훈련은 시험마다 트랜잭션을 되돌리므로 기준정보 캐시가 되돌려진 행을
     * 가리키게 되고, 이 시험은 그 영향을 받지 않아야 M-S02b 가 이 검사를 본다.
     */
    const sol = await solutionItem(t);
    const admin = t.fx.admin;

    /*
     * 표 안의 검사(material_lot_source)는 제조일이 있고 성적서 · 공급자가 모두
     * 빈 줄을 원액 갈래로 보고 통과시킨다. 원료 줄이 있는지는 다른 표를 봐야
     * 하므로 커밋 때 도는 제약 트리거(T1)가 묻는다.
     *
     * 이 시험 실행기는 문장마다 자동 커밋이라 단독 insert 가 그 커밋에서
     * 거부된다. 돌연변이 훈련은 한 트랜잭션 안에서 돌아 커밋이 오지 않으므로,
     * `set constraints all immediate` 로 같은 자리를 앞당긴다. 어느 쪽에서도
     * 같은 검사를 본다. (로트와 원료 줄이 한 문장 안에 함께 들어오면 통과하는 것은
     * SL-07 의 make_solution_lot 이 보인다 - 로트를 먼저 넣고 줄을 나중에 넣는다.)
     */
    await t.rejects(
      () => t.exec(
        `insert into material_lot (item_id, lot_no, made_on, received_at,
           registered_by, qty_received, qty_available)
         values ('${sol}','X-SL06',date '2026-10-22',now(),'${admin}',5,5);
         set constraints all immediate`),
      { code: 'P0001', message: '원료 로트 없이' });
  },
},

{
  id: 'SL-07', expect: '확인',
  name: 'S02 make_solution_lot 정상 - 차감 · 유효기간 · 단가 · 원료 연결',
  async run(t) {
    const m = await master(t);
    const { item, id, a, b } = await brew(t, m);

    /* 원료 두 종에서 3 · 2 가 빠졌다 (각 10) */
    t.eq(Number(await t.val(`select qty_available from material_lot where id = $1`, [a])), 7, 'a 잔여');
    t.eq(Number(await t.val(`select qty_available from material_lot where id = $1`, [b])), 8, 'b 잔여');

    /* 원액 로트: 제조량 5 L, 가용 5, 성적서 · 공급자 칸은 비어 있다 */
    const lot = await t.one(
      `select qty_received::float8 as rec, qty_available::float8 as av, status::text as st,
              made_on::text as made, expiry_date::text as exp, unit_price::float8 as price,
              coa_no, coa_date, supplier_id, supplier_lot_no, qc_passed_on, lot_no
         from material_lot where id = $1`, [id]);
    t.eq([lot.rec, lot.av, lot.st], [5, 5, 'AVAILABLE'], '제조량 · 가용 · 상태');
    t.eq(lot.made, '2026-10-22', '제조일');
    t.eq(lot.exp, '2027-04-22', '유효기간 = 제조일 + 6개월');
    t.eq(lot.price, 1000, '단가');                       // (3·1000 + 2·1000) / 5
    t.eq([lot.coa_no, lot.coa_date, lot.supplier_id, lot.supplier_lot_no, lot.qc_passed_on],
         [null, null, null, null, null], '성적서 · 공급자 칸');
    t.ok(/\S/.test(lot.lot_no), '번호가 나왔다');

    /* 원료 줄: 두 건, 모두 새 원액을 가리킨다. 사유 '용액제조', 상세는 원액 번호 */
    const lines = await t.rows(
      `select material_lot_id, qty::float8 as qty, reason_code, reason_detail
         from stock_movement
        where type = 'SOLUTION' and solution_lot_id = $1
        order by qty`, [id]);
    t.eq(lines.length, 2, '원료 줄');
    t.eq(lines.map((x) => x.qty), [-3, -2], '원료 줄 수량 (부호는 차감)');
    t.eq(lines.map((x) => x.reason_code), ['용액제조', '용액제조'], '사유');
    t.eq(lines.map((x) => x.reason_detail), [lot.lot_no, lot.lot_no], '상세 = 원액 번호');

    /* 계보 뷰: 원액 → 원료 로트별 꺼낸 순량 */
    t.eq(await t.val(`select count(*)::int from v_solution_input where solution_lot_id = $1`, [id]),
         2, '원료 2');
    const va = await t.one(
      `select qty::float8 as qty, material_lot_no, item_code, usage_uom, solution_lot_no
         from v_solution_input where solution_lot_id = $1 and material_lot_id = $2`, [id, a]);
    t.eq(va.qty, 3, 'a 순량');
    t.eq(va.item_code, 'RG-001', '원료 품목');
    t.eq(va.solution_lot_no, lot.lot_no, '원액 번호');
    t.eq(va.material_lot_no, await t.val(`select lot_no from material_lot where id = $1`, [a]),
         '원료 로트 번호');

    /*
     * 정정: a 에서 1 을 되돌린다. 원료 줄은 고쳐 쓰지 않고 같은 원액을 가리키는
     * 반대 줄(RETURN, +)로 되돌린다 - 두 줄이 다 남고 순량이 줄어든다.
     */
    await t.resolves(() => t.rows(
      `insert into stock_movement (material_lot_id, type, qty, solution_lot_id,
         reason_code, reason_detail, registered_by)
       values ($1,'RETURN',1,$2,'계량오차','원액 정정',$3)`, [a, id, m.admin]));
    t.eq(Number(await t.val(`select qty_available from material_lot where id = $1`, [a])), 8,
         '되돌린 뒤 a 잔여');
    t.eq((await t.one(
      `select qty::float8 as qty from v_solution_input where solution_lot_id = $1 and material_lot_id = $2`,
      [id, a])).qty, 2, 'a 순량 (3 - 1)');
    t.eq((await t.one(
      `select qty::float8 as qty from v_solution_input where solution_lot_id = $1 and material_lot_id = $2`,
      [id, b])).qty, 2, 'b 순량');
    t.eq(await t.val(
      `select count(*)::int from stock_movement where solution_lot_id = $1`, [id]),
      3, '줄은 지우지도 고치지도 않고 한 줄이 더해졌다');

    /*
     * 유효기간은 만든 시점에 고정이다. 품목의 사용기간을 나중에 바꿔도 이미 만든
     * 원액은 그대로다 (제품 로트와 같은 원칙, §4.2).
     */
    await t.rows(`update item set shelf_life_months = 12 where id = $1`, [item]);
    t.eq(await t.val(`select expiry_date::text from material_lot where id = $1`, [id]),
         '2027-04-22', '사용기간을 바꾼 뒤 유효기간');
  },
},

{
  id: 'SL-08', expect: '확인',
  name: 'S02 사용기간이 비어 있는 원액 품목 - 로트는 서고 유효기간은 비어 있다',
  async run(t) {
    const m = await master(t);
    const item = await solutionItem(t, { shelf_life_months: null });
    const { id } = await brew(t, m, { item, note: '시험 메모' });

    /* 막지 않는다 - 비워 두고 화면이 그렇다고 적는다 */
    const lot = await t.one(
      `select expiry_date is null as no_expiry, made_on::text as made, qty_available::float8 as av,
              lot_no
         from material_lot where id = $1`, [id]);
    t.eq(lot.no_expiry, true, '유효기간');
    t.eq(lot.made, '2026-10-22', '제조일');
    t.eq(lot.av, 5, '제조량');

    /* 비고는 원료 줄의 상세에 원액 번호 뒤로 붙는다 */
    const details = await t.rows(
      `select distinct reason_detail from stock_movement where solution_lot_id = $1`, [id]);
    t.eq(details.map((x) => x.reason_detail), [`${lot.lot_no} / 시험 메모`], '상세');
  },
},

{
  id: 'SL-09', expect: '확인',
  name: 'S02 원액 단가 - 원료 단가의 가중 평균, 단가 없는 원료가 섞이면 비움',
  async run(t) {
    const m = await master(t);

    /* (3·1000 + 2·4000) / 5 = 2200 */
    const x = await brew(t, m, { prices: [1000, 4000] });
    t.eq(Number(await t.val(`select unit_price from material_lot where id = $1`, [x.id])),
         2200, '가중 평균');

    /* 제조량으로 나누고 소수 넷째 자리에서 반올림한다: 3·1000 / 7 = 428.5714 */
    const y = await brew(t, m, { qty: 7, draw: [3, 1], prices: [1000, 0] });
    t.eq(Number(await t.val(`select unit_price from material_lot where id = $1`, [y.id])),
         428.5714, '반올림');

    /* 원료 가운데 단가 없는 것이 하나라도 있으면 원액 단가를 비운다 (0 으로 지어내지 않는다) */
    const z = await brew(t, m, { prices: [1000, null] });
    t.eq(await t.val(`select unit_price is null from material_lot where id = $1`, [z.id]),
         true, '단가 없는 원료가 섞임');
  },
},

{
  id: 'SL-10', expect: '예외',
  name: 'S01 원료 줄은 원액을 가리킨다 - 연결 없는 원료 줄 · 원액이 아닌 로트 · 다른 유형의 줄',
  async run(t) {
    const m = await master(t);
    const { id: sol } = await brew(t, m);
    const plain = await newMaterialLot(t, m, m.reagent, { qty: 10 });
    const ins = (type, qty, link) => t.rows(
      `insert into stock_movement (material_lot_id, type, qty, solution_lot_id,
         reason_code, registered_by)
       values ($1,$2::movement_type,$3,$4,'시험',$5)`, [plain, type, qty, link, m.admin]);

    /* 원료 줄(SOLUTION)이 원액 로트를 안 가리킨다 */
    await t.rejects(() => ins('SOLUTION', -1, null), { code: 'P0001', message: 'S01' });
    /* 원료 줄이 원액이 아닌 로트를 가리킨다 (입고 로트) */
    await t.rejects(() => ins('SOLUTION', -1, plain), { code: 'P0001', message: 'S01' });
    /* 되돌림 줄도 원액이 아닌 로트는 가리키지 못한다 */
    await t.rejects(() => ins('RETURN', 1, plain), { code: 'P0001', message: 'S01' });
    /* 폐기 · 조정 줄이 원액 로트를 가리킨다 */
    await t.rejects(() => ins('DISPOSAL_STOCK', -1, sol), { code: 'P0001', message: 'S01' });
    await t.rejects(() => ins('DISPOSAL_WIP', -1, sol), { code: 'P0001', message: 'S01' });
    await t.rejects(() => ins('ADJUSTMENT', 1, sol), { code: 'P0001', message: 'S01' });
    t.eq(Number(await t.val(`select qty_available from material_lot where id = $1`, [plain])),
         10, '거부된 줄은 재고를 움직이지 않는다');

    /*
     * 원액을 가리키지 않는 줄은 전과 같이 서고 재고를 움직인다 (반납 · 폐기 · 조정).
     * 새 검사는 원액에 닿는 줄만 묻는다.
     */
    await t.resolves(() => ins('RETURN', 2, null));
    await t.resolves(() => ins('DISPOSAL_STOCK', -3, null));
    await t.resolves(() => ins('ADJUSTMENT', 4, null));
    t.eq(Number(await t.val(`select qty_available from material_lot where id = $1`, [plain])),
         13, '10 + 2 - 3 + 4');
  },
},

{
  id: 'SL-11', expect: '예외',
  name: '불변식 원료 줄의 원료 로트 · 원액 로트 · 수량 · 유형 고쳐 쓰기',
  async run(t) {
    const m = await master(t);
    const x = await brew(t, m);
    const other = await brew(t, m);                    // 다른 원액 (가리킬 수는 있는 로트)
    const line = await t.val(
      `select id from stock_movement where solution_lot_id = $1 and material_lot_id = $2`,
      [x.id, x.a]);
    const upd = (set, params = []) => t.rows(
      `update stock_movement set ${set} where id = $1`, [line, ...params]);

    /* 원료 줄은 계보의 실체다 - 어느 로트에서 얼마를 꺼내 어느 원액으로 갔는가 */
    await t.rejects(() => upd('qty = -1'), { code: 'P0001', message: 'qty' });
    await t.rejects(() => upd('material_lot_id = $2', [x.b]),
                    { code: 'P0001', message: 'material_lot_id' });
    await t.rejects(() => upd('solution_lot_id = $2', [other.id]),
                    { code: 'P0001', message: 'solution_lot_id' });
    await t.rejects(() => upd('solution_lot_id = null'), { code: 'P0001' });
    await t.rejects(() => upd(`type = 'ADJUSTMENT'`), { code: 'P0001' });
    t.eq(await t.one(
      `select qty::float8 as qty, material_lot_id, solution_lot_id from stock_movement where id = $1`,
      [line]),
      { qty: -3, material_lot_id: x.a, solution_lot_id: x.id }, '거부된 뒤 원료 줄');

    /* 상세 문구 같은 다른 칸은 그대로 고친다 */
    await t.resolves(() => upd(`reason_detail = '문구 정정'`));

    /*
     * 틀리게 적었으면 같은 원액을 가리키는 반대 줄(RETURN, +)로 되돌린다.
     * 되돌림 줄도 한 번 적으면 고치지 않는다.
     */
    const back = await t.val(
      `insert into stock_movement (material_lot_id, type, qty, solution_lot_id,
         reason_code, registered_by)
       values ($1,'RETURN',1,$2,'계량오차',$3) returning id`, [x.a, x.id, m.admin]);
    await t.rejects(
      () => t.rows(`update stock_movement set qty = 2 where id = $1`, [back]),
      { code: 'P0001', message: 'qty' });

    /*
     * 원액에 닿지 않던 줄에 나중에 원액을 붙이지 못한다. 빈 값에서 값으로 가는
     * 것은 한 번 적기 검사가 보내 주므로 연결을 거는 쪽에서 닫는다 - 이미 반영된
     * 반납 줄이 뒤늦게 원액의 순량을 깎는 길이 된다.
     */
    const plainLot = await newMaterialLot(t, m, m.reagent, { qty: 10 });
    const ret = await t.val(
      `insert into stock_movement (material_lot_id, type, qty, reason_code, registered_by)
       values ($1,'RETURN',1,'계량오차',$2) returning id`, [plainLot, m.admin]);
    await t.rejects(
      () => t.rows(`update stock_movement set solution_lot_id = $2 where id = $1`, [ret, x.id]),
      { code: 'P0001' });

    /*
     * 옛 용액 제조가 남긴 줄(원액 연결 없는 SOLUTION)은 다시 묻지 않는다. 검사가
     * 아니라 트리거이므로 복구 때처럼 물린 채로 하나 들여 놓고 본다. 상세는 고칠
     * 수 있고, 수량은 원료 줄과 같이 잠겨 있다.
     */
    await t.exec('set session_replication_role = replica');
    let legacy;
    try {
      legacy = await t.val(
        `insert into stock_movement (material_lot_id, type, qty, reason_code, reason_detail,
           registered_by)
         values ($1,'SOLUTION',-1,'용액제조','옛 줄',$2) returning id`, [plainLot, m.admin]);
    } finally {
      await t.exec('set session_replication_role = origin');
    }
    await t.resolves(
      () => t.rows(`update stock_movement set reason_detail = '옛 줄 정정' where id = $1`, [legacy]));
    await t.rejects(
      () => t.rows(`update stock_movement set qty = -2 where id = $1`, [legacy]),
      { code: 'P0001', message: 'qty' });
  },
},

];
