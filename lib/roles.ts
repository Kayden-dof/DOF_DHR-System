/* 클라이언트 컴포넌트에서도 쓰므로 서버 전용 모듈을 끌어오지 않는다. */

export type RoleCode = 'WORKER' | 'PROD_MGR' | 'QP' | 'SYS_ADMIN';

export const ROLE_LABEL: Record<RoleCode, string> = {
  WORKER: '작업자',
  PROD_MGR: '생산관리자',
  QP: '품질책임자',
  SYS_ADMIN: '시스템관리자',
};

export const ROLE_NOTE: Record<RoleCode, string> = {
  WORKER: '현장 패드에서 제조기록 작성',
  PROD_MGR: '작업 지시 발행 · 자재 · 출하 관리',
  QP: '시스템 미사용. 인쇄물에 이름만 나온다',
  SYS_ADMIN: '기준정보 · 계정 · 채번 규칙 관리',
};

export const ROLE_ORDER: RoleCode[] = ['WORKER', 'PROD_MGR', 'QP', 'SYS_ADMIN'];

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

/** 로그인 직후 갈 곳. */
export function homePath(roles: RoleCode[]): string {
  if (isAdmin(roles)) return '/';
  if (isWorker(roles)) return '/work';
  return '/no-role';
}
