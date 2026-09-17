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

  { group: '설정', label: '개요',        path: '/settings',              marks: '●●-●X' },
  { group: '설정', label: '회사 표시',   path: '/settings/brand',        marks: '●X-XX' },
  { group: '설정', label: '채번 규칙',   path: '/settings/numbering',    marks: '●●-●X' },
  { group: '설정', label: '품목',        path: '/settings/items',        marks: '●●-XX' },
  { group: '설정', label: '형명 체계',   path: '/settings/model',        marks: '●X-XX' },
  { group: '설정', label: '공급자',      path: '/settings/suppliers',    marks: '●●-●X' },
  { group: '설정', label: '제품 세우기', path: '/settings/product',      marks: '●●-●X' },
  { group: '설정', label: '제품표준서',  path: '/settings/dmr',          marks: '●●-●X' },
  { group: '설정', label: '사용자',      path: '/settings/users',        marks: '●●-●X' },
  { group: '설정', label: '백업',        path: '/settings/backup',       marks: '●X-XX' },
  { group: '설정', label: '권한',        path: '/settings/access',       marks: '●●-XX' },
  { group: '설정', label: '감사추적',    path: '/settings/audit',        marks: '●●-●●' },

  { group: '현장', label: '현장',        path: '/work',                  marks: '●●●--' },
];

/** 한 화면 · 한 역할의 판정 */
export function accessOf(row: AccessRow, role: RoleCode): Access {
  const i = ACCESS_ROLES.indexOf(role);
  return M[row.marks[i]] ?? 'away';
}

/**
 * 역할이 정하는 기본값. 역할이 둘이면 여는 쪽을 따른다.
 *
 * 표에 없는 주소는 막지 않는다 (기본 열림).
 */
export function roleDefault(path: string, roles: RoleCode[]): boolean {
  const row = ACCESS_ROWS.find((r) => r.path === path);
  if (!row) return true;
  return roles.some((r) => accessOf(row, r) === 'open');
}

/* ---------------------------------------------------------------------------
   계정별 배정 (사용자 요청 2026-09-17 · §2.0)

   위 표는 이제 **기본값**이다. 제조소마다 조직이 다른데 그것을 코드가 정하면
   "다른 제조소가 코드를 고치지 않고 받아 쓸 수 있는가" 가 성립하지 않는다.

   관리자가 계정마다 칸을 열고 닫는다 (user_screen · 0116). 손대지 않은 칸은
   역할 기본값을 따르므로, 사람을 하나 만들 때마다 서른 칸을 채우지 않는다.

   ── 열어 준다고 할 수 있는 일이 늘지는 않는다 ────────────────────────────
   이 판정은 **보이는 것**만 정한다. 저장하는 동작은 저마다 제 문을 갖고 있고
   (각 actions.ts 의 역할 확인), 읽기 전용 세션은 app_readonly 로 돌아 DB 가
   쓰기를 거부하며, S01~S05 와 §2.1 불변식은 권한과 무관하게 선다.
--------------------------------------------------------------------------- */

/** 계정별 배정. 손댄 칸만 들어 있다. 값이 없으면 역할 기본값 */
export type ScreenOverrides = ReadonlyMap<string, boolean>;

/**
 * 이 사람이 이 주소를 열 수 있는가.
 *
 * 차림표와 타일이 이것을 쓴다 - 못 여는 자리를 내놓고 눌렀을 때 막는 것보다
 * 아예 보이지 않는 편이 낫다. 그리고 **같은 판정이 문에서 한 번 더 선다**
 * (lib/session.ts) - 보이지 않는 것과 못 여는 것은 다른 일이다.
 */
export function canOpen(
  path: string, roles: RoleCode[], overrides?: ScreenOverrides,
): boolean {
  const own = overrides?.get(path);
  if (own !== undefined) return own;
  return roleDefault(path, roles);
}

/**
 * 못 열 때 **어떻게** 막는가까지 답한다.
 *
 * 막힘과 내보냄은 다른 일이다 - 앞은 "권한이 없다" 를 그 자리에서 말하고,
 * 뒤는 "여기는 당신이 일하는 자리가 아니다" 라며 제 화면으로 보낸다. 작업자를
 * 관리 화면에 세워 두고 안내문을 읽게 하는 것은 그 사람의 일이 아니다.
 *
 * 역할이 둘이면 여는 쪽을 따르고, 둘 다 못 열면 내보내는 쪽을 따른다 - 더
 * 부드러운 처리가 이긴다.
 */
export function screenAccess(
  path: string, roles: RoleCode[], overrides?: ScreenOverrides,
): Access {
  /* 관리자가 정한 것이 역할 기본값을 이긴다 */
  const own = overrides?.get(path);
  if (own === true) return 'open';

  /*
   * 관리자가 닫았으면 막힘이다. 여기까지 오는 일은 드물다 - 문지기가 먼저
   * /no-access 로 보낸다 (lib/session.ts). 그래도 답은 정해 둔다.
   */
  if (own === false) return 'blocked';

  const row = ACCESS_ROWS.find((r) => r.path === path);
  if (!row) return 'open';
  const marks = roles.map((r) => accessOf(row, r));
  if (marks.includes('open')) return 'open';
  if (marks.includes('away')) return 'away';
  return 'blocked';
}

/** 화면 하나가 열리는 역할들. 화면 설명에 쓴다 */
export function openTo(row: AccessRow): string {
  const who = ACCESS_ROLES.filter((r) => accessOf(row, r) === 'open');
  return who.map((r) => ROLE_LABEL[r]).join(' · ');
}
