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
// SL-12~16 은 원액이 이미 있는 장치에 닿는지 본다 (0120) - 자재 지출에서 빠지는
// 것, 공정 투입(S05), 계보(§8.3), 검토 표시의 기한 경과, 재고(§8.3).
// =============================================================================

import { masterData as master, newMaterialLot, newWorkOrder } from '../fixtures.mjs';

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

/**
 * 재단 전 공정 기록 하나 (알칼리 처리, 열린 기록). 04_rules_m1_m4.mjs 의 newRecord 와
 * 같은 차례로 만든다. 작업일은 한국 날짜다 - 지시 발행일(한국 날짜)보다 앞서면
 * 거부되므로 current_date(UTC) 를 쓰지 않는다.
 */
async function openRecord(t, m, woId, opId = m.ops['WS-DX2401-03'], day = 1) {
  return t.val(
    `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
     values ($1,$2,$3,(timezone('Asia/Seoul', now()))::date,$4) returning id`,
    [woId, opId, day, m.worker]);
}

/** 공정 기록에 자재 로트를 투입한다. */
function issue(t, m, prId, lotId, qty) {
  return t.rows(
    `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
     values ($1,$2,$3,$4)`, [prId, lotId, qty, m.admin]);
}

/** 그 지시서의 검토 표시 가운데 이 갈래에서 이 말이 든 것 (15_review_more.mjs 와 같다) */
async function flags(t, woId, kind, needle) {
  const rows = await t.rows(
    `select detail from review_flags($1) where kind = $2`, [woId, kind]);
  return rows.map((r) => r.detail).filter((d) => d.includes(needle));
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
    /*
     * 제조일은 지난달 날짜다. 번호의 날짜가 제조일에서 오는지 보려면 오늘과 다른
     * 달이어야 한다 - next_number 에 날짜를 안 넘기거나 오늘 날짜를 넘기면 번호가
     * ML-{지금 연월}- 로 나와 아래 단언이 잡는다 (0097 · 설계 3.6).
     */
    const { item, id, a, b } = await brew(t, m, { made: '2026-09-15' });

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
    t.eq(lot.made, '2026-09-15', '제조일');
    t.eq(lot.exp, '2027-03-15', '유효기간 = 제조일 + 6개월');
    t.eq(lot.price, 1000, '단가');                       // (3·1000 + 2·1000) / 5
    t.eq([lot.coa_no, lot.coa_date, lot.supplier_id, lot.supplier_lot_no, lot.qc_passed_on],
         [null, null, null, null, null], '성적서 · 공급자 칸');
    /* 번호 형식은 채번 규칙(픽스처 ML-{YY}{MM}-{SEQ:4})이 정하고, 날짜는 제조일이다 */
    t.ok(/^ML-2609-\d{4}$/.test(lot.lot_no), `번호의 날짜는 제조일: ${lot.lot_no}`);

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
         '2027-03-15', '사용기간을 바꾼 뒤 유효기간');
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
  name: 'S01 원료 줄은 원액을 가리킨다 - 연결 없는 줄 · 원액이 아닌 로트 · 다른 유형 · 되돌림 상한',
  async run(t) {
    const m = await master(t);
    const { id: sol, a, b } = await brew(t, m);               // 원료 a 에서 3, b 에서 2
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

    /*
     * 되돌림 줄은 그 원액에서 꺼낸 만큼까지만 되돌린다. 0056 이 투입 줄의 반납에서
     * 닫은 것과 같은 상한이다 - 상한이 없으면 꺼낸 적 없는 양이 재고로 돌아오고
     * (차감 트리거는 부호만 본다), 순량이 0 이 된 원료가 원액의 원료 목록에서 사라진다.
     */
    const qty = async (lot) => Number(await t.val(
      `select qty_available from material_lot where id = $1`, [lot]));
    const back = (lot, n, link) => t.rows(
      `insert into stock_movement (material_lot_id, type, qty, solution_lot_id,
         reason_code, registered_by)
       values ($1,'RETURN',$2,$3,'계량오차',$4)`, [lot, n, link, m.admin]);

    /* 실제 원액을 가리키지만 그 원액에 들어간 적 없는 원료 로트 */
    await t.rejects(() => back(plain, 1, sol),
                    { code: 'P0001', message: '들어간 적 없는' });
    /* 다른 원액에 들어간 원료 로트도 이 원액으로는 되돌릴 수 없다 */
    const other = await brew(t, m);
    await t.rejects(() => back(other.a, 1, sol),
                    { code: 'P0001', message: '들어간 적 없는' });
    /* 꺼낸 양(3)보다 큰 되돌림 */
    await t.rejects(() => back(a, 5, sol),
                    { code: 'P0001', message: '꺼낸 만큼까지만' });
    t.eq(await qty(a), 7, '거부된 되돌림은 재고를 움직이지 않는다 (10 - 3)');

    /* 이미 되돌린 양을 뺀 나머지까지만: 3 중 1 을 되돌리면 남은 2 */
    await t.resolves(() => back(a, 1, sol));
    await t.rejects(() => back(a, 2.5, sol),
                    { code: 'P0001', message: '꺼낸 만큼까지만' });
    await t.resolves(() => back(a, 2, sol));                   // 정확히 나머지 전부
    await t.rejects(() => back(a, 1, sol),
                    { code: 'P0001', message: '꺼낸 만큼까지만' });
    t.eq(await qty(a), 10, '3 꺼내 3 을 되돌렸다');

    /* 다 되돌린 원료는 원액의 원료 목록에서 빠지고, 안 되돌린 b 는 그대로다 */
    t.eq(await t.val(
      `select count(*)::int from v_solution_input where solution_lot_id = $1`, [sol]),
      1, '원료 목록');
    t.eq((await t.one(
      `select material_lot_id, qty::float8 as qty from v_solution_input where solution_lot_id = $1`,
      [sol])), { material_lot_id: b, qty: 2 }, '남은 원료 b');
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
     *
     * 붙이려는 줄은 이 원액에 실제로 들어간 원료 로트(x.a)의 반납이다. 되돌림
     * 상한(꺼낸 3 - 이미 되돌린 1 = 2 이내)을 지키는 1 이므로 상한은 이 줄을 막지
     * 않는다 - 막는 것은 "적힌 줄에는 뒤늦게 연결할 수 없다" 하나뿐이다.
     */
    const ret = await t.val(
      `insert into stock_movement (material_lot_id, type, qty, reason_code, registered_by)
       values ($1,'RETURN',1,'계량오차',$2) returning id`, [x.a, m.admin]);
    await t.rejects(
      () => t.rows(`update stock_movement set solution_lot_id = $2 where id = $1`, [ret, x.id]),
      { code: 'P0001', message: '뒤늦게' });

    /* 옛 줄 단계가 쓸 이음 없는 입고 로트 */
    const plainLot = await newMaterialLot(t, m, m.reagent, { qty: 10 });

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

// ---- 원액이 이미 있는 장치에 닿는다 (0120) -------------------------------------

{
  id: 'SL-12', expect: '확인',
  name: '지출 원액 로트는 매입이 아니므로 자재 지출과 현황판 지출에 더해지지 않는다',
  async run(t) {
    const m = await master(t);
    /*
     * 원액은 시약 매입으로 이미 잡힌 돈을 다른 모양으로 옮긴 것이다. 원액 로트도
     * 받은 수량 x 단가로 세면 같은 시약 값이 두 번 지출로 나간다.
     *
     * 자료가 쌓인 DB 에서 도는 시험이라 절대값이 아니라 **늘어난 만큼**을 본다.
     * 원료 시약 두 로트(각 10 x 1000)는 정당한 매입이므로 20000 이 늘고, 원액
     * 5 x 1000 = 5000 은 늘지 않는다.
     */
    const day = `(timezone('Asia/Seoul', now()))::date`;
    const monthSpend = async () => Number(await t.val(
      `select coalesce(sum(amount), 0) from v_material_spend
        where month = date_trunc('month', ${day})::date`));
    const boardSpend = async (period) => Number(await t.val(
      `select coalesce(sum(spend), 0) from v_board_period
        where period = $1::text
          and bucket = case $1::text
                         when 'day'  then ${day}
                         when 'week' then date_trunc('week', ${day})::date
                         else             date_trunc('month', ${day})::date end`,
      [period]));

    const before = {
      month: await monthSpend(),
      day: await boardSpend('day'), week: await boardSpend('week'), mon: await boardSpend('month'),
    };

    const { item, id, a, b } = await brew(t, m);

    /* 원액 로트가 서 있고 값이 있다 - 빼지 않으면 5000 이 더해졌을 것이다 */
    const sol = await t.one(
      `select qty_received::float8 as qty, unit_price::float8 as price from material_lot where id = $1`,
      [id]);
    t.eq([sol.qty, sol.price], [5, 1000], '원액 로트 (제조량 5 x 단가 1000)');

    const bought = Number(await t.val(
      `select sum(qty_received * unit_price) from material_lot where id in ($1, $2)`, [a, b]));
    t.eq(bought, 20000, '원료 시약 두 로트의 매입');

    t.eq((await monthSpend()) - before.month, bought, '자재 지출 (그 달) 의 늘어난 몫');
    t.eq(await t.val(`select count(*)::int from v_material_spend where item_id = $1`, [item]),
         0, '원액 품목은 자재 지출에 줄이 없다');
    t.eq((await boardSpend('day'))   - before.day,  bought, '현황판 지출 (일)');
    t.eq((await boardSpend('week'))  - before.week, bought, '현황판 지출 (주)');
    t.eq((await boardSpend('month')) - before.mon,  bought, '현황판 지출 (달)');
  },
},

{
  id: 'SL-13', expect: '예외',
  name: 'S05 자재 구성표에 원액을 걸면 원액 기록 없이는 공정을 마칠 수 없다',
  async run(t) {
    const m = await master(t);
    const sol = await solutionItem(t, { name: '시험 20X PBS' });

    /*
     * 공용 제품표준서(m.dm)에 공정이나 구성표를 더하지 않는다 - 다른 시험이
     * 그 수를 센다. 같은 완제품에 시험 전용 개정본을 하나 세워 그쪽에 건다.
     * 발효 조건(0061)은 사실 셋이다 - ACTIVE · 발효일이 오늘 이전 · 대조 확인.
     */
    const today = await t.val(`select (timezone('Asia/Seoul', now()))::date::text`);
    const dm = await t.val(
      `insert into device_master (item_id, revision, status, effective_from,
         verified_by, verified_at, sheet_min, sheet_max)
       values ($1,'SL-TEST','ACTIVE',$2::date,$3,now(),1,30) returning id`,
      [m.fin, today, m.admin]);
    const op = await t.val(
      `insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
       values ($1,1,'WS-SLT-03','시험 알칼리 처리',false) returning id`, [dm]);
    const bom = await t.val(
      `insert into dmr_bom (operation_id, component_item_id, basis)
       values ($1,$2,'SHEET_TIER') returning id`, [op, sol]);
    for (const [lo, hi, qty] of [[1, 10, 0.8], [11, 30, 1.6]]) {
      await t.rows(
        `insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty) values ($1,$2,$3,$4)`,
        [bom, lo, hi, qty]);
    }
    /* 원액은 시약과 같이 장입 장수 구간의 고정량으로 센다 */
    t.eq(Number(await t.val(`select required_qty($1,$2,20,0)`, [op, sol])), 1.6, '20장 소요량');
    t.eq(Number(await t.val(`select required_qty($1,$2,10,0)`, [op, sol])), 0.8, '10장 소요량');

    const rawLot = await newMaterialLot(t, m, m.raw, { thickness_band: '0510' });
    const wo = await t.val(
      `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision, material_lot_id,
         sheet_count, issued_by_prod, issued_by_qa)
       values (next_number('WORK_ORDER'), next_number('BATCH'), $1, 'SL-TEST', $2, 20, $3, $4)
       returning id`,
      [dm, rawLot, m.admin, m.qa]);
    const pr = await t.val(
      `insert into process_record (work_order_id, operation_id, day_no, work_date, worker_id)
       values ($1,$2,1,$3::date,$4) returning id`, [wo, op, today, m.worker]);

    await t.setActor(m.admin);
    try {
      /* 원액을 기록하지 않았다. 시약을 기록하지 않았을 때와 같은 말로 막힌다 */
      await t.rejects(() => t.rows(`select complete_process($1)`, [pr]),
        { code: 'P0001', message: 'S05: 자재가 기록되지 않았습니다 (시험 20X PBS)' });
      t.eq(await t.val(`select ended_at is null from process_record where id = $1`, [pr]),
           true, '거부된 뒤 종료 시각은 비어 있다');

      /* 원액 로트를 투입으로 넣으면 지나가고, 원액 잔여가 준다 */
      const { id: lot } = await brew(t, m, { item: sol });
      await t.setActor(m.admin);                       // brew 가 배우를 내렸다
      await issue(t, m, pr, lot, 1.6);
      await t.resolves(() => t.rows(`select complete_process($1)`, [pr]));
      t.eq(await t.val(`select ended_at is not null from process_record where id = $1`, [pr]),
           true, '종료 시각이 채워졌다');
      t.eq(Number(await t.val(`select qty_available from material_lot where id = $1`, [lot])),
           3.4, '원액 잔여 (5 - 1.6)');
      t.eq(await t.val(`select status::text from material_lot where id = $1`, [lot]),
           'AVAILABLE', '원액 상태');
    } finally {
      await t.setActor(null);
    }
  },
},

{
  id: 'SL-14', expect: '확인',
  name: '계보 제품 로트 → 배치 → 원액 → 시약 로트, 시약 로트 → 원액 → 영향 배치',
  async run(t) {
    const m = await master(t);
    /* 원액 둘, 배치 둘. 서로 섞이지 않는지 보려면 하나로는 모자란다 */
    const x = await brew(t, m);
    const y = await brew(t, m);
    const woX = await newWorkOrder(t, m);
    const woY = await newWorkOrder(t, m);

    await t.setActor(m.admin);
    let plX;
    try {
      plX = await t.val(`select cut_product_lot($1,$2,10,1)`, [woX.id, m.fin]);
      for (const [wo, lot] of [[woX, x.id], [woY, y.id]]) {
        const pr = await openRecord(t, m, wo.id);
        await issue(t, m, pr, lot, 1.6);
      }
    } finally {
      await t.setActor(null);
    }

    const ids = (rows, col) => rows.map((r) => r[col]).sort();

    /* v_lot_genealogy 는 그대로 원액 로트까지 낸다 (공급자를 묶지 않는다) */
    const g = await t.rows(
      `select material_lot_id, item_type::text as item_type, qty::float8 as qty
         from v_lot_genealogy where work_order_id = $1`, [woX.id]);
    t.eq(g, [{ material_lot_id: x.id, item_type: 'SOLUTION', qty: 1.6 }], '배치 X 가 쓴 자재');

    /* 역추적: 제품 로트 → 배치 → 원액 → 시약 로트 */
    const back = await t.rows(
      `select si.material_lot_id, si.solution_lot_id
         from product_lot pl
         join v_lot_genealogy g on g.work_order_id = pl.work_order_id
         join v_solution_input si on si.solution_lot_id = g.material_lot_id
        where pl.id = $1`, [plX]);
    t.eq(ids(back, 'material_lot_id'), [x.a, x.b].sort(), '제품 로트 X 에서 거슬러 닿은 시약 로트');
    t.eq([...new Set(back.map((r) => r.solution_lot_id))], [x.id], '거친 원액은 X 의 것 하나');

    /* 정추적: 시약 로트 → 원액 → 배치 (→ 제품 로트) */
    const forward = (lot) => t.rows(
      `select distinct g.work_order_id
         from v_solution_input si
         join v_lot_genealogy g on g.material_lot_id = si.solution_lot_id
        where si.material_lot_id = $1`, [lot]);
    t.eq(ids(await forward(x.a), 'work_order_id'), [woX.id], '시약 로트 a 가 닿은 배치');
    t.eq(ids(await forward(x.b), 'work_order_id'), [woX.id], '시약 로트 b 가 닿은 배치');
    t.eq(ids(await forward(y.a), 'work_order_id'), [woY.id], '다른 원액의 시약 로트는 다른 배치');
    t.eq(ids(await t.rows(
      `select distinct pl.id
         from v_solution_input si
         join v_lot_genealogy g on g.material_lot_id = si.solution_lot_id
         join product_lot pl on pl.work_order_id = g.work_order_id
        where si.material_lot_id = $1`, [x.a]), 'id'), [plX], '영향 제품 로트');

    /* 원액을 거치지 않은 시약 로트는 어느 배치에도 닿지 않는다 */
    const lone = await newMaterialLot(t, m, m.reagent, { qty: 10 });
    t.eq((await forward(lone)).length, 0, '원액에 들어간 적 없는 시약 로트');
  },
},

{
  id: 'SL-15', expect: '확인',
  name: '검토 기한이 지난 원액은 막지 않고 투입되며, 검토 표시가 원액 로트번호로 짚는다',
  async run(t) {
    const m = await master(t);
    /* 제조일 2020-01-01 + 6개월 = 2020-07-01. 오늘은 한참 지났다 */
    const x = await brew(t, m, { made: '2020-01-01' });
    const lot = await t.one(
      `select lot_no, expiry_date::text as exp from material_lot where id = $1`, [x.id]);
    t.eq(lot.exp, '2020-07-01', '유효기간');

    const wo = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    try {
      const pr = await openRecord(t, m, wo.id);
      /* 막지 않는다 - 기한이 지났다는 사실을 짚을 뿐이다 (§2 경고만) */
      await t.resolves(() => issue(t, m, pr, x.id, 1));

      const hit = await flags(t, wo.id, '기한 경과', lot.lot_no);
      t.eq(hit.length, 1, '지난 원액을 짚는다');
      t.ok(hit[0].includes('2020-07-01'), '유효기한을 적는다');
      t.ok(hit[0].includes(lot.lot_no), '원액 로트번호를 적는다');

      /* 원액에는 공급자가 없다. 공급자 승인을 묻지 않는다 */
      t.eq((await flags(t, wo.id, '미승인 공급자', lot.lot_no)).length, 0, '공급자 표시');
    } finally {
      await t.setActor(null);
    }

    /* 기한이 남은 원액은 같은 자리에서 짚히지 않는다 */
    const fresh = await brew(t, m, { made: '2026-10-22' });
    const freshNo = await t.val(`select lot_no from material_lot where id = $1`, [fresh.id]);
    const wo2 = await newWorkOrder(t, m);
    await t.setActor(m.admin);
    try {
      await issue(t, m, await openRecord(t, m, wo2.id), fresh.id, 1);
      t.eq((await flags(t, wo2.id, '기한 경과', freshNo)).length, 0, '남은 원액은 안 짚는다');
    } finally {
      await t.setActor(null);
    }
  },
},

{
  id: 'SL-16', expect: '확인',
  name: '재고 원액 5 - 투입 1.6 - 재고 폐기 0.2 = 3.2, 장부 합과 같다',
  async run(t) {
    const m = await master(t);
    const { id, a, b } = await brew(t, m);               // 원액 5, 원료 a 3 · b 2 를 꺼냄
    const wo = await newWorkOrder(t, m);
    const lotQty = async (lot) => Number(await t.val(
      `select qty_available from material_lot where id = $1`, [lot]));

    t.eq(await lotQty(id), 5, '제조 직후');

    await t.setActor(m.admin);
    try {
      await issue(t, m, await openRecord(t, m, wo.id), id, 1.6);
    } finally {
      await t.setActor(null);
    }
    t.eq(await lotQty(id), 3.4, '투입 뒤 (5 - 1.6)');

    /* 잔량을 버린다. 원액도 재고 폐기 길이 그대로 열려 있다 */
    await t.resolves(() => t.rows(
      `insert into stock_movement (material_lot_id, type, qty, reason_code, reason_detail,
         registered_by)
       values ($1,'DISPOSAL_STOCK',-0.2,'파손','잔량 따라냄',$2)`, [id, m.admin]));
    t.eq(await lotQty(id), 3.2, '폐기 뒤 (3.4 - 0.2)');
    t.eq(await t.val(`select status::text from material_lot where id = $1`, [id]),
         'AVAILABLE', '상태');

    /*
     * 장부: 받은(만든) 수량 + 이 로트에 닿은 재고 증감 - 이 로트에서 나간 투입.
     * 증감은 material_lot_id 로 센다. 원액을 만든 원료 줄은 solution_lot_id 로 원액을
     * 가리키지만 줄이 닿은 로트는 원료 쪽이라 원액의 장부에 들지 않는다.
     */
    const ledger = Number(await t.val(
      `select ml.qty_received
            + coalesce((select sum(qty) from stock_movement where material_lot_id = ml.id), 0)
            - coalesce((select sum(qty) from material_issue where material_lot_id = ml.id), 0)
         from material_lot ml where ml.id = $1`, [id]));
    t.eq(ledger, 3.2, '장부 합');
    t.eq(ledger, await lotQty(id), '장부 합과 잔여가 같다');

    /* 원료 쪽은 원액 제조 때 꺼낸 그대로이고, 원액의 구성(계보)도 그대로다 */
    t.eq([await lotQty(a), await lotQty(b)], [7, 8], '원료 잔여');
    t.eq(await t.rows(
      `select material_lot_id, qty::float8 as qty from v_solution_input
        where solution_lot_id = $1 order by qty desc`, [id]),
      [{ material_lot_id: a, qty: 3 }, { material_lot_id: b, qty: 2 }], '원액의 구성');
  },
},

];
