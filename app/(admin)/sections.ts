import type { NavItem } from './nav';

/* ---------------------------------------------------------------------------
   구역별 하위 메뉴

   화면마다 제 제목과 제 주 동작을 스스로 낸다. 구역 레이아웃이 제목을 내면
   "자재 / 자재 관리 / 자재 로트" 처럼 제목이 세 겹으로 쌓이고, 설명문도 둘이
   된다. 어느 쪽이 이 화면의 이름인지 읽는 사람이 매번 판단해야 한다.

   레이아웃에는 권한 확인만 남기고 하위 메뉴 목록만 여기서 나눠 쓴다.
--------------------------------------------------------------------------- */

export const PRODUCTION_NAV: NavItem[] = [
  { href: '/production', label: '작업 지시' },
  { href: '/production/setup', label: '제품' },
  { href: '/production/deviation', label: '일탈' },
];

export const MATERIAL_NAV: NavItem[] = [
  { href: '/material', label: '자재 로트' },
  { href: '/material/items', label: '품목' },
  { href: '/material/orders', label: '발주' },
  { href: '/material/stock', label: '재고' },
  { href: '/material/movement', label: '증감 · 용액' },
];

export const SHIPPING_NAV: NavItem[] = [
  { href: '/shipping', label: '출하 승인' },
  { href: '/shipping/steril', label: '멸균 위탁' },
  { href: '/shipping/ship', label: '출고' },
];

/*
 * 조회는 추적을 위한 자리만 둔다 (사용자 지시 2026-09-01). 원가는 돈 이야기라
 * 경영으로 옮겼다 - 계보를 되짚는 일과 얼마가 드는지 보는 일은 같은 물음이
 * 아니다.
 */
export const TRACE_NAV: NavItem[] = [
  { href: '/trace', label: '계보 추적' },
  { href: '/trace/verify', label: '인쇄물' },
];

/**
 * 경영. 원가는 품질책임자에게만 막힌다 - 그쪽이 보는 것은 돈이 아니라 기준이다.
 * 못 여는 탭을 보이지 않게 한다 - 눌러서 막히는 것보다 낫다.
 */
export function boardNav(canSeeCost: boolean): NavItem[] {
  return canSeeCost
    ? [{ href: '/board', label: '경영 현황' }, { href: '/board/cost', label: '원가' }]
    : [{ href: '/board', label: '경영 현황' }];
}

export const SETTINGS_NAV: NavItem[] = [
  { href: '/settings', label: '개요' },
  { href: '/settings/brand', label: '회사 표시' },
  { href: '/settings/numbering', label: '채번 규칙' },
  { href: '/settings/items', label: '품목' },
  { href: '/settings/suppliers', label: '공급자' },
  { href: '/settings/dmr', label: '제품표준서' },
  { href: '/settings/users', label: '사용자' },
  { href: '/settings/access', label: '권한' },
  { href: '/settings/audit', label: '감사추적' },
];

/**
 * 설정 하위 차림표. 시스템관리자만 여는 셋은 생산관리자에게 보이지 않는다.
 *
 * 못 여는 자리를 보여 주고 눌렀을 때 막는 것보다 아예 보이지 않는 편이 낫다 -
 * 경영의 원가 탭을 역할에 따라 낸 것과 같은 규율이다.
 */
const ADMIN_ONLY = ['/settings/brand', '/settings/numbering', '/settings/users'];

export function settingsNav(isSysAdmin: boolean): NavItem[] {
  return isSysAdmin ? SETTINGS_NAV
    : SETTINGS_NAV.filter((n) => !ADMIN_ONLY.includes(n.href));
}
