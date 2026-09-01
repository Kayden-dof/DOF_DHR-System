/* ---------------------------------------------------------------------------
   계정 워터마크

   화면에 로그인 계정과 시각을 아주 옅게 깔아 둔다.

   캡처를 막지는 못한다. Win+Shift+S 도, PrintScreen 도, 휴대폰 카메라도 웹이
   관여할 수 있는 경로가 아니다. 막았다고 믿게 만드는 쪽이 못 막는 것보다
   위험하므로, 막는 척하지 않고 대신 찍힌 그림에 누가 언제 봤는지를 남긴다.

   유출이 생겼을 때 출처를 좁힐 수 있고, 무엇보다 찍는 사람이 그 사실을 안다.
   억제 효과는 여기서 나온다.

   읽기를 방해하면 안 된다. 눈으로는 종이 결처럼 지나가되, 찍힌 그림에서는
   읽을 수 있어야 한다. 조작을 가로채지 않도록 pointer-events 를 끄고,
   인쇄물에는 나오지 않게 감춘다 - 정본은 종이고 거기엔 서명이 들어간다.

   DOM 노드를 만들지 않고 배경 그림을 깐다. 표가 큰 화면에서 반복 요소를
   수백 개 만들면 스크롤이 무거워진다.

   ── 한 가지 색으로는 안 된다 ──────────────────────────────────────────────
   처음에는 바탕 밝기에 따라 검정 또는 흰색 하나를 골라 깔았다. 그런데 현장
   화면은 어두운 남보라 바탕 위에 흰 카드가 얹힌 구조다. 흰 글자를 고르면
   바탕에서는 보이고 카드 위에서는 사라진다. 화면의 대부분이 카드이므로
   결국 찍힌 그림에 아무것도 안 남았다 (사용자 확인).

   그래서 검정과 흰색을 겹쳐 깐다. 흰 면에서는 검정 쪽이, 어두운 면에서는
   흰 쪽이 드러난다. 서로 지우지 않는다 - 각자 반대 바탕에서만 보이기
   때문이다. 블렌드 모드를 쓰지 않으므로 어느 브라우저에서나 같게 나온다.
--------------------------------------------------------------------------- */

/* 타일이 촘촘하면 빈 면에서 무늬가 눈에 걸린다. 넓게 벌려 드문드문 지나가게 둔다 */
const W = 420;
const H = 230;

/*
 * 보이되 거슬리지 않는 선. 너무 옅으면 찍는 사람이 알아채지 못해 억제가 되지
 * 않고, 너무 짙으면 로트번호를 읽는 데 걸린다.
 */
const ALPHA = 0.055;

function tile(fill: string, text: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="0 0 ${W} ${H}">` +
    `<text x="${W / 2}" y="${H / 2}" fill="${fill}" fill-opacity="${ALPHA}" ` +
    `font-family="Pretendard Variable, Malgun Gothic, sans-serif" font-size="13" ` +
    `font-weight="600" letter-spacing="0.06em" text-anchor="middle" ` +
    `transform="rotate(-24 ${W / 2} ${H / 2})">${esc(text)}</text>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * @param text 깔아 둘 문구. 계정과 시각
 */
export default function Watermark({ text }: { text: string }) {
  return (
    <div
      aria-hidden
      className="watermark"
      /*
       * 어두운 글씨 한 벌과 밝은 글씨 한 벌을 겹쳐 어느 바탕에서나 읽히게 한다.
       * 값은 팔레트에서 온다 - 여기에 박아 두면 회사 색을 바꿔도 따라오지 않는다.
       */
      style={{ backgroundImage:
        `${tile('var(--color-ink)', text)}, ${tile('var(--color-surface)', text)}` }}
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
