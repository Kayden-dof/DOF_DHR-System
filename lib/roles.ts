/* 클라이언트 컴포넌트에서도 쓰므로 서버 전용 모듈을 끌어오지 않는다. */

export type RoleCode = 'WORKER' | 'PROD_MGR' | 'QP' | 'SYS_ADMIN' | 'VIEWER';

export const ROLE_LABEL: Record<RoleCode, string> = {
  WORKER: '작업자',
  PROD_MGR: '생산관리자',
  QP: '품질책임자',
  SYS_ADMIN: '시스템관리자',
  VIEWER: '열람자',
};

export const ROLE_NOTE: Record<RoleCode, string> = {
  WORKER: '현장 패드에서 제조기록 작성',
  PROD_MGR: '작업 지시 발행 · 자재 · 출하 관리',
  QP: '시스템 미사용. 인쇄물에 이름만 나온다',
  SYS_ADMIN: '기준정보 · 계정 · 채번 규칙 관리',
  VIEWER: '진행 상황 조회만. 기록도 인쇄도 하지 않는다',
};

export const ROLE_ORDER: RoleCode[] = ['WORKER', 'PROD_MGR', 'QP', 'SYS_ADMIN', 'VIEWER'];

/* ---------------------------------------------------------------------------
   조작 모드는 로그인 계정의 역할이 가른다.

   관리자(시스템관리자·생산관리자)  키보드와 마우스를 쓰는 사무 화면
   작업자                           장갑 낀 손으로 쓰는 현장 패드 화면

   둘을 겸하는 계정은 관리 화면으로 들어가고, 상단에서 현장 화면으로 넘어갈 수
   있다. 기본값을 관리 화면으로 두는 이유는 그쪽에 되돌릴 수 없는 조작
   (작업 지시 발행, 규칙 등록)이 있어 의도치 않게 열리면 곤란하기 때문이다.
--------------------------------------------------------------------------- */
export const ADMIN_ROLES: RoleCode[] = ['SYS_ADMIN', 'PROD_MGR'];

export const isAdmin = (roles: RoleCode[]) => roles.some((r) => ADMIN_ROLES.includes(r));
export const isWorker = (roles: RoleCode[]) => roles.includes('WORKER');

/* ---------------------------------------------------------------------------
   열람자

   보기만 한다. 기록도 인쇄도 하지 않는다.

   ── 인쇄를 막는 이유 ──────────────────────────────────────────────────────
   이 시스템에서 인쇄는 보기가 아니라 쓰기다. 인쇄물 한 장이 record_print 행을
   만들고, 제조기록서라면 그 묶음이 잠긴다 (S04). 잠금을 푸는 방법은 없다.
   보려고 들어온 사람이 인쇄를 누르면 작업 중인 일차가 잠겨 작업자가 더 이상
   기록하지 못한다.

   ── 겸직은 없다 ───────────────────────────────────────────────────────────
   열람자에 다른 역할이 함께 붙어 있으면 그쪽 권한으로 움직인다. 읽기 전용
   세션은 순수 열람자일 때만이다 - 섞이면 어느 쪽으로 도는지 알 수 없다.
--------------------------------------------------------------------------- */
export const isViewer = (roles: RoleCode[]) => roles.includes('VIEWER');

/** 오직 열람자이기만 한가. 이 사람의 세션은 DB 에서도 읽기 전용이 된다 */
export const isViewerOnly = (roles: RoleCode[]) =>
  roles.length > 0 && roles.every((r) => r === 'VIEWER');

/** 로그인 직후 갈 곳. */
export function homePath(roles: RoleCode[]): string {
  if (isAdmin(roles)) return '/';
  if (isWorker(roles)) return '/work';
  /* 열람자는 경영 현황으로. 볼 것이 거기 다 있다 */
  if (isViewer(roles)) return '/board';
  return '/no-role';
}
