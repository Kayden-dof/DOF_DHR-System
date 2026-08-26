/* 표시 시각은 전부 Asia/Seoul로 고정한다. 채번이 KST 기준이라 (§4.10 구현),
   화면이 브라우저 시간대를 따라가면 감사기록 시각과 로트번호 날짜가 어긋나 보인다. */
const TZ = 'Asia/Seoul';

const DATETIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

const DATE = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/* 오늘 안의 일이라 날짜가 이미 문맥에 있는 자리. 시:분까지만 쓴다 */
const TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
});

/* sv-SE 로캘은 ISO 형식(YYYY-MM-DD HH:mm:ss)을 그대로 준다. 파싱해서 다시
   조립할 필요가 없다. */

export function fmtDateTime(v: Date | string | null | undefined): string {
  if (!v) return '';
  return DATETIME.format(new Date(v));
}

export function fmtDate(v: Date | string | null | undefined): string {
  if (!v) return '';
  return DATE.format(new Date(v));
}

export function fmtTime(v: Date | string | null | undefined): string {
  if (!v) return '';
  return TIME.format(new Date(v));
}

export function shortId(v: string | null | undefined): string {
  return v ? v.slice(0, 8) : '';
}
