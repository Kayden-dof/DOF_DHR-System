import { ROLE_LABEL } from './roles';
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
  equipment:           '설비',
  operation_equipment: '공정 설비',
  equipment_validation: '설비 밸리데이션',
  record_print:        '인쇄',
  day_lock:            '일차 잠금',
  steril_batch:        '멸균 배치',
  steril_batch_lot:    '멸균 동봉',
  shipment:            '출고',
  deviation:            '일탈',
  labour_rate:          '공수 단가',
  org_brand:            '회사 표시',
  model_scheme:         '형명 체계',
  model_segment:        '형명 자리',
  product_nonconformity:'제품 부적합',
  wip_nonconformity:    '반제품 부적합',
  sample_plan:          '시료 기준',
  work_order_plan:      '생산 계획',
};

export const tableLabel = (name: string) => TABLE_LABEL[name] ?? name;


/* ---------------------------------------------------------------------------
   감사추적의 열 이름 (사용자 요청 2026-09-01)

   감사추적은 무엇이 언제 누구에 의해 바뀌었는가를 보여 주는 자리다. 그런데
   바뀐 열의 이름이 `qty_available` `no_material_reason` 처럼 영문 그대로 떠서,
   읽는 사람이 그것이 무엇인지 알려면 스키마를 알아야 했다.

   ── 여기 한 곳에서만 옮긴다 ───────────────────────────────────────────────
   TABLE_LABEL 과 나란히 둔다. 화면이 각자 옮기면 같은 열이 화면마다 다른
   이름으로 뜬다 (§10 복제 금지).

   옮긴 말이 없으면 원래 이름을 그대로 보여 준다 - 빈칸이 뜨는 것보다 낫다.
   열이 늘면 여기에 한 줄 더한다.
--------------------------------------------------------------------------- */
export const FIELD_LABEL: Record<string, string> = {
  id:                     '식별자',
  code:                   '코드',
  name:                   '이름',
  note:                   '비고',
  title:                  '제목',
  detail:                 '상세',
  status:                 '상태',
  type:                   '유형',
  kind:                   '종류',
  seq:                    '순번',
  qty:                    '수량',
  pages:                  '쪽 수',
  is_active:              '쓰는 중',
  reason_code:            '사유 구분',
  reason_detail:          '사유',
  registered_by:          '등록자',
  registered_at:          '등록 일시',
  updated_by:             '고친 사람',
  updated_at:             '고친 일시',
  effective_from:         '적용일',
  expiry_date:            '유효기한',
  location:               '보관 위치',
  amend_reason:           '정정 사유',
  login_code:             '로그인 번호',
  full_name:              '이름',
  is_developer:           '개발 계정',
  can_login:              '로그인 사용',
  pin_hash:               '비밀번호',
  pin_changed_at:         '비밀번호 바꾼 일시',
  must_change_pin:        '비밀번호 변경 필요',
  role:                   '역할',
  user_id:                '대상 계정',
  pattern:                '번호 형식',
  reset:                  '초기화 주기',
  seq_width:              '순번 자릿수',
  target:                 '채번 대상',
  item_id:                '품목',
  purchase_uom:           '구매 단위',
  usage_uom:              '사용 단위',
  conversion:             '환산 계수',
  min_stock:              '최소 재고선',
  min_stock_auto:         '최소 재고선 제안값',
  min_stock_basis:        '산출 근거',
  lead_days:              '조달 일수',
  default_supplier_id:    '기본 공급자',
  shelf_life_months:      '사용기간 (개월)',
  shelf_life_ref:         '사용기간 근거',
  supplier_id:            '공급자',
  approved_until:         '승인 만료일',
  contact_name:           '담당자',
  contact_phone:          '연락처',
  contact_email:          '이메일',
  biz_no:                 '사업자번호',
  address:                '주소',
  payment_terms:          '결제 조건',
  current_price:          '현재 단가',
  price:                  '단가',
  unit_price:             '단가',
  months:                 '개월',
  study_report_no:        '안정성 시험 보고서',
  study_date:             '시험일',
  approved_by:            '승인자',
  approved_on:            '승인일',
  revision:               '개정번호',
  device_master_id:       '제품표준서',
  verified_by:            '대조 확인자',
  verified_at:            '대조 확인 일시',
  after_cutting:          '재단 이후 공정',
  operation_id:           '공정',
  component_item_id:      '자재',
  basis:                  '소요 기준',
  qty_per_unit:           '개당 소요량',
  dmr_bom_id:             '자재 구성표',
  min_sheets:             '장입 하한',
  max_sheets:             '장입 상한',
  sheet_min:              '장입 하한',
  sheet_max:              '장입 상한',
  steril_box_qty:         '멸균 박스 수량',
  min_qty:                '수량 하한',
  max_qty:                '수량 상한',
  sample_qty:             '시료 수량',
  sample_basis:           '시료 기준',
  po_no:                  '발주번호',
  ordered_at:             '발주일',
  ordered_by:             '발주자',
  expected_at:            '입고 예정일',
  purchase_order_id:      '발주',
  lot_no:                 '로트번호',
  supplier_lot_no:        '공급자 로트번호',
  coa_no:                 '성적서 번호',
  coa_date:               '성적서 일자',
  received_at:            '입고 일시',
  qty_received:           '입고 수량',
  qty_available:          '남은 수량',
  thickness_band:         '두께 구간',
  material_lot_id:        '자재 로트',
  material_issue_id:      '자재 투입',
  wo_no:                  '지시서 번호',
  batch_no:               '배치번호',
  dmr_revision:           '제품표준서 개정',
  sheet_count:            '장입 장수',
  sheets:                 '장수',
  issued_by_prod:         '생산 발행자',
  issued_by_qa:           '품질 발행자',
  issued_at:              '발행 일시',
  issued_by:              '발행자',
  cancelled_reason:       '취소 사유',
  work_order_id:          '작업 지시',
  product_lot_id:         '제품 로트',
  qty_produced:           '생산 수량',
  qty_sample:             '시료 수량',
  manufactured_on:        '제조일',
  release_approved_by:    '출하 승인자',
  release_approved_on:    '출하 승인일',
  release_request_no:     '출하 승인 요청번호',
  planned_qty:            '예정 수량',
  planned_units:          '예정 개수',
  expected_units:         '예상 개수',
  typical_day:            '표준 일차',
  product_code:           '제품 코드',
  product_name:           '제품명',
  attempt:                '회차',
  day_no:                 '일차',
  work_date:              '작업일',
  worker_id:              '작업자',
  rotation_worker_id:     '순환자',
  equipment_id:           '설비',
  equipment_ref:          '설비',
  started_at:             '시작 시각',
  ended_at:               '종료 시각',
  rework_qty:             '재작업 수량',
  no_material_reason:     '자재 해당없음 사유',
  process_record_id:      '공정 기록',
  locked_by:              '마감한 사람',
  locked_at:              '마감 일시',
  data_hash:              '자료 식별자',
  printed_by:             '인쇄자',
  printed_at:             '인쇄 일시',
  retrieved_at:           '회수 일시',
  retrieve_reason:        '회수 사유',
  request_no:             '의뢰서 번호',
  cert_no:                '멸균 성적서 번호',
  steril_batch_id:        '멸균 배치',
  shipped_at:             '출고일',
  shipped_by:             '출고자',
  customer_name:          '거래처',
  deviation_no:           '일탈번호',
  occurred_on:            '발생일',
  found_at:               '발견 시점',
  report_no:              '보고서 번호',
  outcome:                '결말',
  closed_on:              '종결일',
  concession_doc_no:      '특채 기록지 번호',
  performed_on:           '실시일',
  valid_until:            '유효기한',
  purchased_on:           '구입일',
  purchase_price:         '취득원가',
  useful_life_months:     '내용연수 (개월)',
  salvage_value:          '잔존가치',
  monthly_hours:          '기준 월 가동시간',
  vendor_name:            '판 곳',
  vendor_contact_name:    '판 곳 담당자',
  vendor_phone:           '판 곳 연락처',
  vendor_email:           '판 곳 이메일',
  vendor_site:            '판 곳 사이트',
  vendor_address:         '판 곳 주소',
  hourly_rate:            '시간당 단가',
  company_name:           '회사 이름',
  company_tagline:        '회사 슬로건',
  brand_color:            '강조색',
  logo_bytes:             '로고 그림',
  logo_mime:              '로고 형식',
  logo_name:              '로고 파일명',
  logo_dark_bytes:        '어두운 바탕용 로고 그림',
  logo_dark_mime:         '어두운 바탕용 로고 형식',
  logo_dark_name:         '어두운 바탕용 로고 파일명',
  system_name:            '시스템 이름',
  system_name_long:       '풀어 쓴 이름',
  system_tagline:         '한 줄 설명',
  unit_from:              '환산 전 단위',
  unit_to:                '환산 후 단위',
};

export const fieldLabel = (name: string) => FIELD_LABEL[name] ?? name;


/* ---------------------------------------------------------------------------
   감사추적의 값 (사용자 요청 2026-09-01)

   열 이름을 옮겨도 값이 `ISSUED` `SHEET_TIER` `WORKER` 로 뜨면 읽는 사람은
   여전히 코드를 알아야 한다.

   ── 열 이름으로 어느 목록을 쓸지 고른다 ───────────────────────────────────
   같은 글자가 표마다 다른 뜻일 수 있다. 'CUT' 은 작업 지시에서는 재단 완료
   상태이고 제품 로트에서도 재단 완료다 - 우연히 같지만, 다른 열은 그렇지
   않다. 그래서 값만 보고 옮기지 않고 **어느 열의 값인가**로 목록을 고른다.

   옮긴 말이 없으면 값을 그대로 보여 준다. 지어내지 않는다.
--------------------------------------------------------------------------- */
const VALUE_LABEL: Record<string, Record<string, string>> = {
  role:        ROLE_LABEL as Record<string, string>,
  type:        { RAW: '원재료', REAGENT: '시약', PROCESS: '공정 자재',
                 PACK: '포장재', FIN: '완제품' },
  basis:       { SHEET_TIER: '장입 구간 기준', PER_UNIT: '제품 개수 기준' },
  reset:       { NEVER: '초기화 없음', YEARLY: '연 단위',
                 MONTHLY: '월 단위', DAILY: '일 단위' },
  target:      { WORK_ORDER: '작업 지시서 번호', BATCH: '배치번호',
                 PRODUCT_LOT: '제조번호', MATERIAL_LOT: '자재 로트번호',
                 STERIL_BATCH: '멸균 배치번호', DEVIATION: '일탈번호' },
  kind:        { WORK_ORDER: '작업지시서', DAY_RECORD: '제조기록서',
                 COVER: '편철 표지', LABEL: '자재 라벨',
                 LABEL_REQUEST: '라벨요청서', RELEASE_REQUEST: '출하 승인 요청서',
                 EQUIPMENT_LOG: '설비 사용 기록' },
  outcome:     { REWORK: '재작업', CONCESSION: '특채', SCRAP: '불량' },
  sample_basis: { SHEET_TIER: '장입 구간 기준', PER_UNIT: '제품 개수 기준' },
};

/* 표마다 status 의 뜻이 다르다. 표 이름과 함께 고른다 */
const STATUS_LABEL_BY_TABLE: Record<string, Record<string, string>> = {
  work_order:   WO_STATUS_LABEL,
  product_lot:  PL_STATUS_LABEL,
  material_lot: MATERIAL_STATUS_LABEL,
  supplier:     { PENDING: '미승인', APPROVED: '승인', SUSPENDED: '정지' },
  device_master: { DRAFT: '초안', ACTIVE: '발효', RETIRED: '폐지' },
  purchase_order: { ORDERED: '발주', RECEIVED: '입고', CANCELLED: '취소' },
};

/**
 * 감사추적에 뜨는 값을 사람 말로. 옮길 말이 없으면 그대로 돌려준다.
 *
 * @param table 어느 표의 값인가. status 처럼 표마다 뜻이 다른 열에 쓴다
 */
export function valueLabel(table: string, key: string, v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (key === 'status') return STATUS_LABEL_BY_TABLE[table]?.[v] ?? null;
  if (key === 'type' && table === 'stock_movement') {
    return MOVEMENT_TYPES.find((m) => m.code === v)?.label ?? null;
  }
  return VALUE_LABEL[key]?.[v] ?? null;
}
