export type FormState = { ok?: boolean; message?: string; error?: string };
export const EMPTY_FORM_STATE: FormState = {};

export const NUMBERING_TARGETS = [
  { code: 'WORK_ORDER',   label: '작업지시서 번호', note: 'work_order.wo_no' },
  { code: 'BATCH',        label: '배치번호',        note: 'work_order.batch_no' },
  { code: 'PRODUCT_LOT',  label: '제조번호',        note: 'product_lot.lot_no · 재단 시 부여' },
  { code: 'MATERIAL_LOT', label: '자재 로트번호',   note: 'material_lot.lot_no · 바코드 값' },
  { code: 'STERIL_BATCH', label: '멸균 배치번호',   note: 'steril_batch.batch_no' },
  { code: 'DEVIATION',    label: '일탈 번호',       note: '일탈 기록' },
] as const;

export const RESET_CYCLES = [
  { code: 'NEVER',   label: '없음',   note: '순번이 계속 이어진다' },
  { code: 'YEARLY',  label: '연 단위', note: '해가 바뀌면 1부터' },
  { code: 'MONTHLY', label: '월 단위', note: '달이 바뀌면 1부터' },
  { code: 'DAILY',   label: '일 단위', note: '날짜가 바뀌면 1부터' },
] as const;

/** M1 자재 로트 등록이 의존하는 대상 (§4.10). */
export const M1_CRITICAL_TARGETS = ['MATERIAL_LOT', 'WORK_ORDER', 'BATCH'];
