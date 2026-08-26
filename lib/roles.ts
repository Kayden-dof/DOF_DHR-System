/* 클라이언트 컴포넌트에서도 쓰므로 서버 전용 모듈을 끌어오지 않는다. */

export type RoleCode = 'WORKER' | 'PROD_MGR' | 'QP' | 'SYS_ADMIN';

export const ROLE_LABEL: Record<RoleCode, string> = {
  WORKER: '작업자',
  PROD_MGR: '생산관리자',
  QP: '품질책임자',
  SYS_ADMIN: '시스템관리자',
};

export const ROLE_NOTE: Record<RoleCode, string> = {
  WORKER: '공정 기록 작성',
  PROD_MGR: '작업지시 발행 · 생산 관리',
  QP: '시스템 미사용. 인쇄물에 이름만 나온다',
  SYS_ADMIN: '기준정보 · 계정 · 채번 규칙 관리',
};

export const ROLE_ORDER: RoleCode[] = ['WORKER', 'PROD_MGR', 'QP', 'SYS_ADMIN'];
