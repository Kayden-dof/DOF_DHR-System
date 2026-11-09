/* ---------------------------------------------------------------------------
   설비 검교정 주기 (0126)

   주기와 «기한 없음» 날짜 읽기를 한 곳에 둔다. 화면마다 따로 읽으면 같은
   설비가 화면마다 다르게 보인다 (§10).
--------------------------------------------------------------------------- */

export type CheckCycle = 'ANNUAL' | 'ONCE' | 'NONE';

export const CHECK_CYCLES: { code: CheckCycle; label: string }[] = [
  { code: 'ANNUAL', label: '매년' },
  { code: 'ONCE', label: '최초 설치시 1회' },
  { code: 'NONE', label: '대상 아님' },
];

export const cycleLabel = (c: string | null | undefined) =>
  CHECK_CYCLES.find((x) => x.code === c)?.label ?? '매년';

/** 1회 검교정은 만료일을 9999-12-31 로 적는다 (0126) */
export const NO_EXPIRY = '9999-12-31';

export const isNoExpiry = (d: string | null | undefined) => !!d && d >= '9000-01-01';

/** 만료일 글자. «기한 없음» 을 날짜로 내보내지 않는다 */
export const validText = (d: string | null | undefined) =>
  !d ? '' : isNoExpiry(d) ? '기한 없음' : d.slice(0, 10);
