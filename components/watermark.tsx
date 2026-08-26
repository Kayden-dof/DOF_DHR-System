/* ---------------------------------------------------------------------------
   계정 워터마크

   화면에 로그인 계정과 시각을 아주 옅게 깔아 둔다.

   캡처를 막지는 못한다. Win+Shift+S 도, PrintScreen 도, 휴대폰 카메라도 웹이
   관여할 수 있는 경로가 아니다. 막았다고 믿게 만드는 쪽이 못 막는 것보다
   위험하므로, 막는 척하지 않고 대신 찍힌 그림에 누가 언제 봤는지를 남긴다.

   유출이 생겼을 때 출처를 좁힐 수 있고, 무엇보다 찍는 사람이 그 사실을 안다.
   억제 효과는 여기서 나온다.

   읽기를 방해하면 안 된다. 4~7% 로 깔아 두면 눈으로는 종이 결처럼 지나가고
   8비트 그림에는 남는다. 조작을 가로채지 않도록 pointer-events 를 끄고,
   인쇄물에는 나오지 않게 감춘다 - 정본은 종이고 거기엔 서명이 들어간다.

   DOM 노드를 만들지 않고 배경 그림 한 장을 깐다. 표가 큰 화면에서 반복
   요소를 수백 개 만들면 스크롤이 무거워진다.
--------------------------------------------------------------------------- */

/* 타일이 촘촘하면 빈 면에서 무늬가 눈에 걸린다. 넓게 벌려 드문드문 지나가게 둔다 */
const W = 420;
const H = 230;

/**
 * @param text  깔아 둘 문구. 계정과 시각
 * @param tone  바탕이 밝으면 dark, 어두우면 light
 */
export default function Watermark({
  text, tone = 'dark',
}: { text: string; tone?: 'dark' | 'light' }) {
  const fill = tone === 'dark' ? '#1F1F23' : '#FFFFFF';
  /*
   * 어두운 면에서는 흰 글자가 훨씬 크게 뜬다. 같은 값을 주면 현장 화면에서만
   * 무늬가 읽혀 버린다. 밝은 면보다 낮게 잡는다.
   */
  const alpha = tone === 'dark' ? 0.038 : 0.042;

  const tile =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="0 0 ${W} ${H}">` +
    `<text x="${W / 2}" y="${H / 2}" fill="${fill}" fill-opacity="${alpha}" ` +
    `font-family="Pretendard Variable, Malgun Gothic, sans-serif" font-size="13" ` +
    `font-weight="600" letter-spacing="0.06em" text-anchor="middle" ` +
    `transform="rotate(-24 ${W / 2} ${H / 2})">${esc(text)}</text>` +
    `</svg>`;

  return (
    <div
      aria-hidden
      className="watermark"
      style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(tile)}")` }}
    />
  );
}

/** 이름에 &나 <가 들어가도 SVG가 깨지지 않게 한다. */
function esc(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 워터마크 문구. 계정 · 사번 · 본 시각. */
export function stamp(name: string, loginCode: string) {
  const t = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  return `${name} ${loginCode} · ${t}`;
}
