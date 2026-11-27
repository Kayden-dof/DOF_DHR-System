// =============================================================================
// 45_solution_check.mjs - 원료 차감과 PBS 제조기록서 칸 대조 (순수 함수, DB 를 쓰지 않는다)
// 근거: 정밀 점검 C (2026-11-27) - 원액 원료가 차감 · 기록서 두 곳에 따로 적히고 견주는 곳이 없었다
//
// 양식 판이 달라도 같은 규칙으로 칸을 찾는다: 부여로트번호 칸(lotno)은 품목 코드(ic)와 자재명(lb),
// 결과 칸(number · bs)은 이름에 그 자재명이 든다. 판정하지 않는다 - 같음 · 다름 · 안 적음만 낸다.
// =============================================================================

import { solutionCheck } from '../../lib/br-form.ts';

/* 지어낸 양식 한 장 - 회사 양식 값은 싣지 않는다 */
const BS = { id: 'p0t2r5c3', base: 5, lo: 3, hi: 3.1, u: '통' };
const page = (lots, qtys) => ({
  texts: [],
  tables: [
    { x: 0, y: 0, w: 100, cols: [], rows: [
      { h: 10, cells: [{ c: 0, t: '알칼리 시약' }, { c: 1, t: 'RG-001' },
        { c: 2, id: 'p0t1r1c2', k: 'lotno', ic: 'RG-001', lb: '알칼리 시약', v: lots['RG-001'] }] },
      { h: 10, cells: [{ c: 0, t: 'H2O2 시약' }, { c: 1, t: 'RG-002' },
        { c: 2, id: 'p0t1r2c2', k: 'lotno', ic: 'RG-002', lb: 'H2O2 시약', v: lots['RG-002'] }] },
    ] },
    { x: 0, y: 20, w: 100, cols: [], rows: [
      { h: 10, cells: [{ c: 3, id: 'p0t2r1c3', k: 'number', bs: BS, u: '통',
        lb: '시험 원액 제작 · 알칼리 시약 · 3 ~ 3.1 통', v: qtys['RG-001'] }] },
      { h: 10, cells: [{ c: 3, id: 'p0t2r2c3', k: 'number', bs: BS, u: '통',
        lb: '시험 원액 제작 · H2O2 시약 · 2 ~ 2.1 통', v: qtys['RG-002'] }] },
      /* 기준 생산량 칸(bb)은 원료가 아니다 - 견주지 않는다 */
      { h: 10, cells: [{ c: 3, id: 'p0t2r5c3', k: 'number', bb: 5, u: 'L', lb: '시험 원액 제작 · 정제수 · 5 L', v: '5' }] },
    ] },
  ],
});
const input = (code, name, lot, qty) => ({
  item_code: code, item_name: name, lot_no: lot, qty: String(qty), usage_uom: '통', amend_reason: null,
});
const USED = [input('RG-001', '알칼리 시약', 'R1', 3), input('RG-002', 'H2O2 시약', 'R2', 2)];
const stateOf = (rows) => Object.fromEntries(rows.map((r) => [r.code, r.state]));

export default [

{
  id: 'PB-01', expect: '통과',
  name: '적은 로트 · 양이 차감과 같으면 같음 (결과 칸은 자재명으로 잇는다)',
  async run(t) {
    const rows = solutionCheck([page({ 'RG-001': 'R1', 'RG-002': 'R2' }, { 'RG-001': '3', 'RG-002': '2.000' })], USED);
    t.eq(stateOf(rows), { 'RG-001': 'same', 'RG-002': 'same' }, '둘 다 같음');
    t.eq(rows.map((r) => r.code), ['RG-001', 'RG-002'], '기준 생산량(정제수) 칸은 원료 줄이 아니다');
    t.eq(rows[0].usedLots, ['R1'], '차감 로트');
    t.eq(rows[0].writtenQty, 3, '적은 양');
  },
},

{
  id: 'PB-02', expect: '통과',
  name: '양이나 로트가 다르면 다름 (예: 차감 14.41 · 기록서 144.1)',
  async run(t) {
    const rows = solutionCheck([page({ 'RG-001': 'R1', 'RG-002': 'R9' }, { 'RG-001': '30', 'RG-002': '2' })], USED);
    t.eq(stateOf(rows), { 'RG-001': 'diff', 'RG-002': 'diff' }, '양 다름 · 로트 다름');
  },
},

{
  id: 'PB-03', expect: '통과',
  name: '안 적은 칸은 안 적음, 차감이 없는데 적었으면 다름',
  async run(t) {
    const blank = solutionCheck([page({}, {})], USED);
    t.eq(stateOf(blank), { 'RG-001': 'blank', 'RG-002': 'blank' }, '아직 안 적음');
    const half = solutionCheck([page({ 'RG-001': 'R1' }, {})], USED);
    t.eq(half[0].state, 'blank', '로트만 적고 양을 비우면 아직 안 적음');
    const none = solutionCheck([page({ 'RG-001': 'R1' }, { 'RG-001': '3' })], [USED[1]]);
    t.eq(none[0].state, 'diff', '차감에 없는 원료를 적었다');
    t.eq(none[0].usedQty, null, '차감 양 없음');
  },
},

{
  id: 'PB-04', expect: '통과',
  name: '한 원료를 두 로트에서 꺼냈으면 로트를 모두 적어야 같음 · 양은 합',
  async run(t) {
    const two = [input('RG-001', '알칼리 시약', 'R1', 1), input('RG-001', '알칼리 시약', 'R3', 2), USED[1]];
    const rows = solutionCheck([page({ 'RG-001': 'R3, R1', 'RG-002': 'R2' }, { 'RG-001': '3', 'RG-002': '2' })], two);
    t.eq(rows[0].usedLots, ['R1', 'R3'], '두 로트');
    t.eq(rows[0].usedQty, 3, '양은 합');
    t.eq(rows[0].state, 'same', '차례와 상관없이 같음');
    const one = solutionCheck([page({ 'RG-001': 'R1', 'RG-002': 'R2' }, { 'RG-001': '3', 'RG-002': '2' })], two);
    t.eq(one[0].state, 'diff', '한 로트만 적으면 다름');
  },
},

];
