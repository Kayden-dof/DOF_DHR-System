/* ---------------------------------------------------------------------------
   강조색 한 개에서 나오는 단계들

   ── 왜 lib/brand.ts 에서 떼어 냈는가 (2026-09-11) ─────────────────────────
   파생은 원래 lib/brand.ts 안에 있었다. 그런데 그 파일은 DB 를 부르므로
   (`withActor`) 브라우저에서 부를 수 없다. 회사 표시 화면이 **고른 색에서
   무엇이 나오는지 그 자리에서 보여 주려면** 같은 계산이 화면에도 있어야 한다.

   그렇다고 화면이 자기 계산을 따로 두면 두 벌이 되고, 두 벌은 갈라진다 (§10).
   규격 표기가 두 곳으로 갈려 종이에 10배 틀린 치수가 나간 적이 있다.

   그래서 계산만 여기로 옮긴다. DB 도 node 도 부르지 않으므로 서버와 브라우저가
   같은 함수를 쓴다. 파생이 일어나는 자리는 여전히 하나다.

   ── 대비를 지킨다 ────────────────────────────────────────────────────────
   현장은 밝은 조명에서 장갑 낀 손으로 본다. 바탕색은 아주 밝게, 글자색은 아주
   어둡게 고정해 어떤 강조색을 넣어도 읽히게 한다.
--------------------------------------------------------------------------- */

export function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const hx = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, '0')).join('');

/** 흰색 쪽으로 t 만큼 (0=그대로 1=흰색) */
export const lighten = ([r, g, b]: [number, number, number], t: number) =>
  hx(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);

/** 검정 쪽으로 t 만큼 */
export const darken = ([r, g, b]: [number, number, number], t: number) =>
  hx(r * (1 - t), g * (1 - t), b * (1 - t));

/**
 * 어두운 면의 색. 현장 머리띠 · 주소창 · 설치 화면 바탕이 같은 값을 쓴다.
 * brandVars 의 --color-indigo 와 같은 계산이다 - 두 곳에서 만들면 갈라진다.
 */
export function darkTone(color: string): string {
  return darken(toRgb(color), 0.38);
}

/** 파생 단계 하나. 화면이 미리보기를 그릴 때 이 목록을 그대로 쓴다 */
export interface Step { name: string; label: string; value: string; dark: boolean }

/**
 * 강조색에서 나오는 단계 전부.
 *
 * `brandVars` 가 CSS 로 내보내는 것과 **같은 목록**이다. 화면 미리보기가 따로
 * 세지 않도록 여기 한 번만 적는다.
 *
 * `dark` 는 그 색 위에 흰 글자를 얹어야 하는가다. 미리보기가 견본 안에 값을
 * 적을 때 쓴다.
 */
export function brandSteps(color: string): Step[] {
  const rgb = toRgb(color);
  /*
   * **밝은 것부터 어두운 것으로 늘어놓는다.** 미리보기가 이 차례를 그대로
   * 그리므로, 목록이 뒤섞이면 띠가 밝았다 어두웠다 하며 무엇이 무엇인지
   * 말해 주지 못한다. 쓰임새 순이 아니라 밝기 순이다.
   */
  return [
    { name: 'brand-soft',  label: '바탕',        value: lighten(rgb, 0.94), dark: false },
    { name: 'brand-tint',  label: '옅은 바탕',   value: lighten(rgb, 0.91), dark: false },
    { name: 'brand-line',  label: '테두리',      value: lighten(rgb, 0.7),  dark: false },
    { name: 'brand-mid',   label: '보조',        value: lighten(rgb, 0.22), dark: true },
    { name: 'brand-lift',  label: '들린 면',     value: lighten(rgb, 0.12), dark: true },
    { name: 'brand',       label: '강조색',      value: color,              dark: true },
    { name: 'indigo-soft', label: '어두운 면 위', value: darken(rgb, 0.18),  dark: true },
    { name: 'brand-deep',  label: '눌린 면',     value: darken(rgb, 0.28),  dark: true },
    { name: 'indigo',      label: '어두운 면',    value: darken(rgb, 0.38),  dark: true },
    { name: 'indigo-deep', label: '어두운 면 아래', value: darken(rgb, 0.58), dark: true },
  ];
}

/**
 * :root 에 내려보낼 한 줄.
 *
 * `brand-pale` 은 미리보기에 내지 않는다 - 비활성 상태에만 쓰여 눈으로 고를
 * 값이 아니다. 그래도 CSS 에는 있어야 하므로 여기서 함께 만든다.
 */
export function brandVars(color: string): string {
  const rgb = toRgb(color);
  const from = brandSteps(color).map((s) => `--color-${s.name}:${s.value}`);
  return [...from, `--color-brand-pale:${lighten(rgb, 0.45)}`].join(';');
}
