/* 클라이언트 컴포넌트에서도 쓰므로 서버 전용 모듈을 끌어오지 않는다. */

export type RoleCode = 'WORKER' | 'PROD_MGR' | 'QP' | 'SYS_ADMIN' | 'VIEWER';

export const ROLE_LABEL: Record<RoleCode, string> = {
  WORKER: '작업자',
  PROD_MGR: '생산관리자',
  QP: '품질책임자',
  SYS_ADMIN: '시스템관리자',
  VIEWER: '경영열람',
};

export const ROLE_NOTE: Record<RoleCode, string> = {
  WORKER: '현장 패드에서 제조기록 작성',
  PROD_MGR: '작업 지시 발행 · 자재 · 출하 관리',
  QP: '기록과 종이를 열람한다. 판정과 서명은 종이 위에서',
  SYS_ADMIN: '기준정보 · 계정 · 채번 규칙 관리',
  VIEWER: '경영 현황과 제품 이력 열람. 기록하지 않는다',
};

export const ROLE_ORDER: RoleCode[] = ['WORKER', 'PROD_MGR', 'QP', 'SYS_ADMIN', 'VIEWER'];

/* ---------------------------------------------------------------------------
   조작 모드는 로그인 계정의 역할이 가른다.

   관리자(시스템관리자·생산관리자)  키보드와 마우스를 쓰는 사무 화면
   작업자                           장갑 낀 손으로 쓰는 현장 패드 화면

   둘을 겸하는 계정은 로그인할 때 어느 역할로 들어갈지 고른다 (아래 seatOf ·
   사용자 요청 2026-11-20). 전에는 늘 관리 화면으로 들어가고 상단에서 현장
   화면으로 넘어갔다.
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

/* ---------------------------------------------------------------------------
   품질책임자

   §4.1 은 품질책임자에게 계정을 주지 않기로 했다 - "시스템 미사용, 인쇄물에
   이름만". 판정이 종이 위에서 일어나므로 시스템에 들어올 이유가 없다는 뜻이었다.

   그런데 판정하려면 **지금 무엇을 기준으로 돌고 있는지**를 봐야 한다. 어느
   제품표준서 개정이 발효 중인지, 자재 구성표에 무엇이 걸려 있는지, 설비
   밸리데이션이 언제까지인지. 그때마다 생산에 물어보는 것은 검토가 아니다
   (사용자 결정 2026-09-01).

   ── 여전히 아무것도 쓰지 않는다 ───────────────────────────────────────────
   품질책임자 계정은 열람자와 같은 읽기 전용 세션으로 돈다 (app_readonly).
   쓰기 함수의 실행 권한이 DB 에서 걷혀 있으므로, 화면이 실수로 단추를 내놓아도
   거기서 막힌다 (0053).

   판정은 여전히 종이 위에서 일어난다. release_approved_by 가 계정이 아니라
   text 인 것도 그대로다 (§4.5). 전자서명은 받지 않는다 (§1).

   ── 열람자와 보는 것이 다르다 ─────────────────────────────────────────────
   열람자(대표)는 숫자를 본다. 품질책임자는 기준을 본다. 그래서 메뉴가 다르다.
--------------------------------------------------------------------------- */
export const isQpOnly = (roles: RoleCode[]) =>
  roles.length > 0 && roles.every((r) => r === 'QP');

/** 쓰기 역할이 하나도 없는가. 이 세션은 DB 에서도 읽기 전용이 된다 */
export const isReadOnly = (roles: RoleCode[]) =>
  roles.length > 0 && roles.every((r) => r === 'VIEWER' || r === 'QP');

/* ---------------------------------------------------------------------------
   이번에 앉은 자리 (사용자 요청 2026-11-20)

   역할이 둘 이상인 계정은 로그인할 때 어느 역할로 일할지 고른다. 전에는 관리
   역할이 늘 이겨서, 생산관리자 겸 작업자가 현장 패드에서 로그인해도 관리 화면이
   먼저 떴다.

   ── 고른 역할이 정하는 것은 보이는 범위뿐이다 (사용자 결정 2026-11-20) ────
   첫 화면 · 차림표 · 화면 문(canOpen · requireUser · blocksScreen)이 이 값을
   쓴다. 저장하는 동작은 지금처럼 **가진 역할 전부**로 확인한다 - 계정별 화면
   배정(0116)과 같은 성격이다. 언제든 역할을 바꿀 수 있으므로 저장까지 좁혀도
   막아 주는 것이 없다.

   chosen 은 세션 쿠키에 봉한 값이다.
     없음        고르지 않는 세션 (역할이 하나이거나, 이 기능 전에 연 세션)
     빈 글자     고르기 전 (로그인 직후)
     역할 코드   고른 역할
   고른 역할을 그 사이 관리자가 거둬 갔으면 다시 고른다.
--------------------------------------------------------------------------- */
export interface Seat {
  /** 화면을 가리는 역할들. 고른 역할 하나, 아니면 가진 역할 전부 */
  seat: RoleCode[];
  /** 아직 고르지 않았다. 고르기 전에는 어느 화면으로도 들이지 않는다 */
  pick: boolean;
}

export function seatOf(held: RoleCode[], chosen: string | undefined): Seat {
  if (chosen === undefined || held.length < 2) return { seat: held, pick: false };
  if ((held as string[]).includes(chosen)) return { seat: [chosen as RoleCode], pick: false };
  return { seat: held, pick: true };
}

/** 로그인 직후 갈 곳. */
export function homePath(roles: RoleCode[]): string {
  if (isAdmin(roles)) return '/';
  if (isWorker(roles)) return '/work';
  /* 열람자는 경영 현황으로. 볼 것이 거기 다 있다 */
  if (isViewer(roles)) return '/board';
  /*
   * 품질책임자는 생산으로. 차림표의 첫 칸이다 (사용자 결정 2026-11-20). 전에는 이
   * 갈래가 없어 품질책임자 계정이 로그인하면 «역할 없음» 화면에 떨어졌다.
   */
  if (roles.includes('QP')) return '/production';
  return '/no-role';
}
