export type FormState = { ok?: boolean; message?: string; error?: string };
export const EMPTY_FORM_STATE: FormState = {};

export const NUMBERING_TARGETS = [
  { code: 'WORK_ORDER',   label: '작업 지시서 번호', note: 'work_order.wo_no' },
  { code: 'BATCH',        label: '배치번호',        note: 'work_order.batch_no' },
  { code: 'PRODUCT_LOT',  label: '제조번호',        note: 'product_lot.lot_no · 재단 시 부여' },
  { code: 'MATERIAL_LOT', label: '자재 로트번호',   note: 'material_lot.lot_no · 바코드 값' },
  { code: 'STERIL_BATCH', label: '멸균 배치번호',   note: 'steril_batch.batch_no' },
  { code: 'DEVIATION',    label: '일탈 번호',       note: '일탈 기록' },
] as const;

export const RESET_CYCLES = [
  { code: 'NEVER',   label: '없음',   note: '순번이 계속 이어집니다' },
  { code: 'YEARLY',  label: '연 단위', note: '해가 바뀌면 1부터' },
  { code: 'MONTHLY', label: '월 단위', note: '달이 바뀌면 1부터' },
  { code: 'DAILY',   label: '일 단위', note: '날짜가 바뀌면 1부터' },
] as const;

/** M1 자재 로트 등록이 의존하는 대상 (§4.10). */
export const M1_CRITICAL_TARGETS = ['MATERIAL_LOT', 'WORK_ORDER', 'BATCH'];

export const ITEM_TYPES = [
  { code: 'RAW',     label: '원재료',   note: '동물유래물질. 배치당 1개 로트' },
  { code: 'REAGENT', label: '시약',     note: '장입 장수 구간별로 소모' },
  { code: 'PROCESS', label: '공정 자재', note: '공정에서 쓰는 소모품' },
  { code: 'PACK',    label: '포장재',   note: '제품 개수에 비례' },
  { code: 'FIN',     label: '완제품',   note: '형명. 모델명 규칙으로 생성' },
] as const;

export const SUPPLIER_STATUS = [
  { code: 'APPROVED',  label: '승인',   tone: 'ok' },
  { code: 'PENDING',   label: '미승인', tone: 'warn' },
  { code: 'SUSPENDED', label: '정지',   tone: 'danger' },
] as const;

export const MOVEMENT_TYPES = [
  { code: 'RETURN',         label: '반납',      sign: 1,  note: '원 로트로 되돌립니다.' },
  { code: 'DISPOSAL_WIP',   label: '공정 폐기', sign: -1, note: '작업 지시를 지정해야 합니다.' },
  { code: 'DISPOSAL_STOCK', label: '재고 폐기', sign: -1, note: '기한 경과 · 파손 등' },
  { code: 'ADJUSTMENT',     label: '조정',      sign: 0,  note: '실사 차이' },
] as const;

export const MOVEMENT_REASONS = ['파손', '오염', '계량오차', '기한경과', '실사차이', '기타'] as const;

export const PL_STATUS_LABEL: Record<string, string> = {
  CUT: '재단 완료',
  PACKED: '포장 완료',
  STERILIZING: '멸균 중',
  TESTED: '멸균 회수',
  RELEASE_APPROVED: '출하 승인',
  SHIPPED: '출고 완료',
  DISPOSED: '폐기',
};

export const WO_STATUS_LABEL: Record<string, string> = {
  ISSUED: '발행',
  IN_PROCESS: '진행 중',
  CUT: '재단 완료',
  DONE: '종료',
  CANCELLED: '취소',
};

export const MATERIAL_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: '사용 가능',
  CONSUMED: '소진',
  EXPIRED: '기한 경과',
  DISPOSED: '폐기',
};

/* ---------------------------------------------------------------------------
   표 이름 한글 표기

   감사추적과 현황에 표 이름이 그대로 나오면 읽는 사람이 스키마를 알아야 한다.
   여기 한 곳에서만 옮긴다. 표가 늘면 여기에 한 줄 더한다. 옮긴 말이 없으면
   원래 이름을 그대로 보여 준다 - 빈칸이 뜨는 것보다 낫다.
--------------------------------------------------------------------------- */
export const TABLE_LABEL: Record<string, string> = {
  app_user:            '계정',
  user_role:           '역할',
  numbering_rule:      '채번 규칙',
  item:                '품목',
  supplier:            '공급자',
  item_supplier:       '공급자 단가',
  price_history:       '단가 이력',
  shelf_life_history:  '사용기간 이력',
  device_master:       '제품표준서',
  dmr_operation:       '공정',
  dmr_bom:             '자재 구성표',
  dmr_bom_tier:        '장입 구간',
  purchase_order:      '발주',
  material_lot:        '자재 로트',
  work_order:          '작업 지시',
  product_lot:         '제품 로트',
  process_record:      '공정 기록',
  material_issue:      '자재 투입',
  stock_movement:      '재고 증감',
  record_print:        '인쇄',
  day_lock:            '일차 잠금',
  steril_batch:        '멸균 배치',
  steril_batch_lot:    '멸균 동봉',
  shipment:            '출고',
};

export const tableLabel = (name: string) => TABLE_LABEL[name] ?? name;
