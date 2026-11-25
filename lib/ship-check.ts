/* ---------------------------------------------------------------------------
   출고 전 형명 검토 - 제조기록서 재단 줄 (0159 · 사용자 2026-11-25)

   «발주 형명이 맞는지 작업지시서 및 제조기록서 일괄 검토해서 출고시 오규격이 나가지 않도록»

   재단 기록서 «제조번호 · 모델명 · 수량» 줄의 칸 자리는 양식 코드(lib/br-form.ts)가 안다. DB 트리거가
   볼 수 없으므로 처리 함수(ship)가 채운 기록서 칸을 이 함수에 넘겨 본다. 화면의 검토 표도 같은 함수다.
   가져오는 것이 없다 - 시험(test/cases/40_sales_order.mjs)이 그대로 읽는다.
--------------------------------------------------------------------------- */

/** 재단 줄의 칸 하나. value 는 현장이 적은 값, 없으면 시스템이 채운 값 */
export interface CutRowCell { row: number; role: 'cutlot' | 'model' | 'qty'; value: string }

export interface CutRowResult {
  /** true 맞음 · false 다름(또는 이 로트 줄이 없음) · null 재단 칸이 없는 양식(볼 수 없음) */
  ok: boolean | null;
  /** 그 줄에 적힌 모델명 */
  actual: string | null;
  /** 이 로트로 본 줄 */
  row: number | null;
}

/** 영문 · 숫자만, 대문자로. 손으로 적은 'GM261110-01' 과 'GM-26111001' 을 같게 본다 */
export const alnum = (s: string) => s.replace(/[^0-9A-Za-z]/g, '').toUpperCase();

/**
 * 이 로트의 재단 줄을 찾아 모델명을 주문 형명과 견준다.
 * 줄은 제조번호 칸이 이 로트 제조번호와 같은 줄, 없으면 채우기와 같은 셈으로 lotIndex 번째 줄(줄 차례)인데
 * 그 줄의 제조번호 칸이 비어 있을 때만이다 - 다른 제조번호가 적힌 줄은 다른 로트의 줄이다.
 */
export function cutRowCheck(cells: CutRowCell[], lotNo: string, lotIndex: number, orderCode: string): CutRowResult {
  if (cells.length === 0) return { ok: null, actual: null, row: null };
  const rows = [...new Set(cells.map((c) => c.row))].sort((a, b) => a - b);
  const cell = (row: number, role: CutRowCell['role']) =>
    cells.find((c) => c.row === row && c.role === role)?.value ?? '';

  const want = alnum(lotNo);
  let row = rows.find((r) => alnum(cell(r, 'cutlot')) === want);
  if (row === undefined) {
    const nth = rows[lotIndex];
    if (nth !== undefined && alnum(cell(nth, 'cutlot')) === '') row = nth;
  }
  if (row === undefined) return { ok: false, actual: null, row: null };

  const actual = cell(row, 'model');
  return { ok: alnum(actual) === alnum(orderCode), actual, row };
}
