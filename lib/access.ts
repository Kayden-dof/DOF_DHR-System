import { ROLE_LABEL, type RoleCode } from './roles';

/* ---------------------------------------------------------------------------
   권한 매트릭스 (사용자 요청 2026-09-01)

   어느 역할이 어느 화면에 닿는가. 설정 화면이 이것을 그대로 그린다.

   ── 왜 여기 적어 두는가 ───────────────────────────────────────────────────
   화면마다 requireUser · hasRole · blocksViewer · blocksReadOnly 가 제각기
   걸려 있다. 화면이 스물일곱이라 눈으로 훑어서는 전체 그림이 서지 않고,
   역할 하나를 고칠 때 어디가 함께 바뀌는지 짚이지 않는다.

   ── 이 표가 낡지 않게 하는 것 ─────────────────────────────────────────────
   여기 적은 것은 **선언**이고, 진짜는 각 화면의 판정이다. 둘이 갈라지면 이
   표는 거짓말이 된다.

   그래서 `npm run access` 가 실제로 두드려 재고 이 표와 대조한다. 한 칸이라도
   어긋나면 멈춘다 (scripts/access-matrix.mjs). 화면의 판정을 고치고 여기를
   안 고치면 그 자리에서 걸린다.
--------------------------------------------------------------------------- */

export type Access = 'open' | 'blocked' | 'away';

export const ACCESS_LABEL: Record<Access, string> = {
  open:    '열림',
  blocked: '막힘',
  away:    '내보냄',
};

export const ACCESS_NOTE: Record<Access, string> = {
  open:    '화면이 그려진다',
  blocked: '주소로 들어가도 권한 없음 안내가 나온다',
  away:    '다른 화면으로 넘긴다',
};

/** 표의 열 순서 */
export const ACCESS_ROLES: RoleCode[] = [
  'SYS_ADMIN', 'PROD_MGR', 'WORKER', 'QP', 'VIEWER',
];

export interface AccessRow {
  /** 상단 메뉴 구역. 표를 이 단위로 묶는다 */
  group: string;
  label: string;
  path: string;
  /** ACCESS_ROLES 순서대로 다섯 글자. ● 열림 · X 막힘 · - 내보냄 */
  marks: string;
}

const M: Record<string, Access> = { '●': 'open', 'X': 'blocked', '-': 'away' };

export const ACCESS_ROWS: AccessRow[] = [
  { group: '현황 · 경영', label: '현황',        path: '/',                     marks: '●●-●●' },
  { group: '현황 · 경영', label: '경영 현황',   path: '/board',                marks: '●●-●●' },
  { group: '현황 · 경영', label: '원가',        path: '/board/cost',           marks: '●●-X●' },

  { group: '생산', label: '작업 지시',   path: '/production',            marks: '●●-●●' },
  { group: '생산', label: '제품',        path: '/production/setup',      marks: '●●-XX' },
  { group: '생산', label: '일탈',        path: '/production/deviation',  marks: '●●-XX' },

  { group: '자재', label: '자재 로트',   path: '/material',              marks: '●●-●X' },
  { group: '자재', label: '품목',        path: '/material/items',        marks: '●●-XX' },
  { group: '자재', label: '발주',        path: '/material/orders',       marks: '●●-XX' },
  { group: '자재', label: '재고',        path: '/material/stock',        marks: '●●-XX' },
  { group: '자재', label: '증감 · 용액', path: '/material/movement',     marks: '●●-XX' },

  { group: '설비', label: '설비',        path: '/equipment',             marks: '●●-●X' },

  { group: '출하', label: '출하 승인',   path: '/shipping',              marks: '●●-XX' },
  { group: '출하', label: '멸균 위탁',   path: '/shipping/steril',       marks: '●●-XX' },
  { group: '출하', label: '출고',        path: '/shipping/ship',         marks: '●●-XX' },

  { group: '조회', label: '계보 추적',   path: '/trace',                 marks: '●●-●●' },
  { group: '조회', label: '인쇄물',      path: '/trace/verify',          marks: '●●-●X' },

  { group: '설정', label: '개요',        path: '/settings',              marks: '●●-XX' },
  { group: '설정', label: '회사 표시',   path: '/settings/brand',        marks: '●X-XX' },
  { group: '설정', label: '채번 규칙',   path: '/settings/numbering',    marks: '●X-XX' },
  { group: '설정', label: '품목',        path: '/settings/items',        marks: '●●-XX' },
  { group: '설정', label: '공급자',      path: '/settings/suppliers',    marks: '●●-●X' },
  { group: '설정', label: '제품표준서',  path: '/settings/dmr',          marks: '●●-●X' },
  { group: '설정', label: '사용자',      path: '/settings/users',        marks: '●X-XX' },
  { group: '설정', label: '권한',        path: '/settings/access',       marks: '●●-XX' },
  { group: '설정', label: '감사추적',    path: '/settings/audit',        marks: '●●-●●' },

  { group: '현장', label: '현장',        path: '/work',                  marks: '●●●--' },
];

/** 한 화면 · 한 역할의 판정 */
export function accessOf(row: AccessRow, role: RoleCode): Access {
  const i = ACCESS_ROLES.indexOf(role);
  return M[row.marks[i]] ?? 'away';
}

/** 화면 하나가 열리는 역할들. 화면 설명에 쓴다 */
export function openTo(row: AccessRow): string {
  const who = ACCESS_ROLES.filter((r) => accessOf(row, r) === 'open');
  return who.map((r) => ROLE_LABEL[r]).join(' · ');
}
