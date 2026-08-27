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
  { href: '/production/setup', label: '품목 설정' },
];

export const MATERIAL_NAV: NavItem[] = [
  { href: '/material', label: '자재 로트' },
  { href: '/material/orders', label: '발주' },
  { href: '/material/stock', label: '재고' },
  { href: '/material/movement', label: '증감 · 용액' },
];

export const SHIPPING_NAV: NavItem[] = [
  { href: '/shipping', label: '출하 승인' },
  { href: '/shipping/steril', label: '멸균 위탁' },
  { href: '/shipping/ship', label: '출고' },
];

export const TRACE_NAV: NavItem[] = [
  { href: '/trace', label: '계보 추적' },
  { href: '/trace/verify', label: '인쇄물' },
  { href: '/trace/cost', label: '원가' },
];

export const SETTINGS_NAV: NavItem[] = [
  { href: '/settings', label: '개요' },
  { href: '/settings/numbering', label: '채번 규칙' },
  { href: '/settings/items', label: '품목' },
  { href: '/settings/suppliers', label: '공급자' },
  { href: '/settings/dmr', label: '제품표준서' },
  { href: '/settings/users', label: '사용자' },
  { href: '/settings/audit', label: '감사추적' },
];
