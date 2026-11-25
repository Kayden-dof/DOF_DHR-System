/* ---------------------------------------------------------------------------
   오늘이 며칠인가 - 한 곳에서만 정한다

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

/**
 * 한국 시각으로 지금 (또는 준 시각). 'YYYY-MM-DDTHH:MM' - datetime-local 칸의 값
 * 꼴이다. 사람이 고칠 수 있게 채워 두는 기본값에 쓴다 (0139).
 */
export function nowLocalKST(at?: Date | string | null): string {
  const d = at ? new Date(at) : new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * 화면에서 받은 한국 벽시계 값을 timestamptz 로 넣을 글자로. 시간대 없는 값을
 * 그대로 넣으면 서버 시간대(UTC)로 읽혀 9시간 밀린다 (§10).
 * 'YYYY-MM-DDTHH:MM' 또는 날짜 · 시각을 따로 받는다. 꼴이 틀리면 null.
 */
export function kstStamp(dateOrLocal: string | null | undefined, time?: string | null): string | null {
  const v = (dateOrLocal ?? '').trim();
  const local = time != null ? `${v}T${time.trim()}` : v;
  const m = local.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/);
  return m ? `${m[1]}T${m[2]}${m[3] ?? ':00'}+09:00` : null;
}

/** 한국 시각으로 지금 연도. 바닥글 저작권 표기처럼 해가 걸린 자리에 쓴다 */
export function yearKST(): number {
  return Number(new Intl.DateTimeFormat('en-CA', {
    timeZone: KST, year: 'numeric',
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
