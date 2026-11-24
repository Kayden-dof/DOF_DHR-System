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

/*
 * 화학식의 숫자를 아래첨자로 (사용자 2026-11-25 «H2O2 표기 저거 맞아?? 2는 아래첨자»). 제품표준서의 공정
 * 이름은 «H2O2 처리» 로 적혀 있고 회사 양식은 H₂O₂ 다. 이름을 고치면 표준서 대조가 풀리고 나간 종이의
 * 자료 식별자가 흔들리므로, 저장된 값은 두고 화면 · 종이에 낼 때만 바꾼다. 아는 식만, 낱말 단위로 -
 * 코드(DX2401 · WS-DX2401-04)는 건드리지 않는다.
 */
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const FORMULA = /(?<![A-Za-z0-9])(H2O2|H2O|CO2|O2|N2|NaHCO3|H2SO4|Na2CO3|CaCl2|MgCl2)(?![A-Za-z0-9])/g;
export function chem(v: string | null | undefined): string {
  return (v ?? '').replace(FORMULA, (f) => f.replace(/\d/g, (d) => SUB[Number(d)]));
}
