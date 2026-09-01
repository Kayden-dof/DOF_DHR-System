/* ---------------------------------------------------------------------------
   오늘이 며칠인가 — 한 곳에서만 정한다

   이 시스템의 축은 작업일이다. 제조일 · 작업일 · 유효기한 · 발주일이 전부
   날짜 하나로 걸려 있고, 그 날짜가 하루 어긋나면 종이에 그렇게 찍혀 굳는다.
   제조일과 유효기한은 재단 시점 값으로 고정되어 사후 정정도 안 된다 (0052).

   그런데 자바스크립트의 날짜는 그것이 도는 컴퓨터의 시각대를 따른다. 서버는
   UTC 로 돌고 현장 패드는 KST 로 돈다. 같은 순간에 두 곳이 다른 날짜를
   말한다.

   실제로 그랬다. 현장 재단 화면의 제조일 기본값만 toISOString 으로 만들어져,
   아침 9시 이전에 재단하면 전날이 들어갔다 (2차 검수 결함 8).

   그래서 "오늘" 을 여기 한 곳에서만 정한다. 화면이든 서버든 이 파일을 지나야
   한다. DB 쪽은 timezone('Asia/Seoul', now()) 로 같은 답을 낸다.

   ── 왜 sv-SE 인가 ─────────────────────────────────────────────────────────
   스웨덴 표기가 YYYY-MM-DD 다. 날짜 입력 칸(<input type="date">)과 DB 의
   date 리터럴이 요구하는 모양과 같아서, 자르거나 이어 붙일 일이 없다.
--------------------------------------------------------------------------- */

export const KST = 'Asia/Seoul';

/** 한국 시각으로 오늘. 'YYYY-MM-DD'. 날짜 칸과 DB 에 그대로 넣을 수 있다 */
export function todayKST(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: KST }).format(new Date());
}

/** 한국 시각으로 지금 연도. 바닥글 저작권 표기처럼 해가 걸린 자리에 쓴다 */
export function yearKST(): number {
  return Number(new Intl.DateTimeFormat('en-CA', {
    timeZone: KST, year: 'numeric',
  }).format(new Date()));
}

/** 한국 시각으로 지금 시(0~23). 인사말처럼 때를 가르는 자리에 쓴다 */
export function hourKST(): number {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: KST, hour: 'numeric', hour12: false,
  }).format(new Date()));
}

/**
 * 날짜 문자열이 오늘보다 앞서는가. 유효기한 · 승인기한 판정에 쓴다.
 *
 * Date 로 바꿔 견주지 않는다. 'YYYY-MM-DD' 는 UTC 자정으로 해석되므로
 * 한국 시각 자정 언저리에서 하루씩 어긋난다. 글자끼리 견주면 그 일이 없다.
 */
export function isPastKST(date: string | null | undefined): boolean {
  return !!date && date.slice(0, 10) < todayKST();
}

/** 오늘부터 며칠 안인가. 유효기한 임박 표시에 쓴다 */
/**
 * 오늘부터 그 날짜까지 며칠인가. 지난 날짜는 음수다.
 *
 * 여기서도 Date 산술을 쓰지 않는다. 'YYYY-MM-DD' 를 Date 로 만들면 UTC 자정이
 * 되어 한국 시각과 아홉 시간 어긋나고, 자정 언저리에서 하루가 밀린다. 두 날짜를
 * 각각 UTC 정오로 놓고 빼면 시간대가 상쇄되어 날수만 남는다.
 */
export function daysUntilKST(date: string | null | undefined): number | null {
  if (!date) return null;
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12);
  return Math.round((at(date.slice(0, 10)) - at(todayKST())) / 86_400_000);
}

export function withinDaysKST(date: string | null | undefined, days: number): boolean {
  if (!date) return false;
  const limit = new Intl.DateTimeFormat('sv-SE', { timeZone: KST })
    .format(new Date(Date.now() + days * 86_400_000));
  const d = date.slice(0, 10);
  return d >= todayKST() && d <= limit;
}
