'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { stamp } from '@/lib/watermark';

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

   ── 시각은 30분을 넘기지 않는다 (사용자 2026-11-26) ───────────────────────
   «메뉴 넘어갈 때마다 갱신되는 건 놔두고, 최종 갱신 이후 30분 동안 메뉴 이동이 없을 때 강제 갱신».
   한 화면을 오래 띄워 두면 찍힌 그림의 시각이 몇 시간 전으로 남았다. 화면을 옮기면 그때 시각으로,
   옮기지 않으면 마지막 갱신에서 30분 뒤에 화면이 스스로 다시 적는다. 잠자기에서 깨면 늦게 오는
   타이머 대신 1분마다 지난 시간을 재서 바로 맞춘다.
--------------------------------------------------------------------------- */

/* 마지막 갱신 뒤 이만큼 이동이 없으면 다시 적는다 */
const REFRESH_MS = 30 * 60 * 1000;
/* 지난 시간을 재는 간격. 잠자기 · 숨은 탭에서 늦게 오는 타이머를 기다리지 않는다 */
const CHECK_MS = 60 * 1000;

/* 타일이 촘촘하면 빈 면에서 무늬가 눈에 걸린다. 넓게 벌려 드문드문 지나가게 둔다 */
const W = 420;
const H = 230;

/*
 * 보이되 거슬리지 않는 선. 너무 옅으면 찍는 사람이 알아채지 못해 억제가 되지
 * 않고, 너무 짙으면 로트번호를 읽는 데 걸린다.
 *
 * 0.055 에서 0.037 로 내렸다 (디자인 점검 2026-11-06 · 사용자 확인). 그 값에서는
 * 표의 숫자 칸 위를 지나가는 글자가 숫자와 함께 읽혔다. 찍힌 그림을 확대하면
 * 여전히 누구 · 언제가 읽힌다.
 */
const ALPHA = 0.037;

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
 * @param text 서버가 그린 첫 문구 (계정과 시각). 화면을 옮기거나 30분이 지나면 화면이 다시 적는다
 */
export default function Watermark({ text: first, name, loginCode }: {
  text: string; name: string; loginCode: string;
}) {
  const [text, setText] = useState(first);
  const last = useRef(0);
  const path = usePathname();
  const seen = useRef(path);

  /* 서버가 새 문구를 주면(화면 이동 등) 그것이 마지막 갱신이다 */
  useEffect(() => {
    setText(first);
    last.current = Date.now();
  }, [first]);

  /* 화면을 옮기면 그때 시각으로 (레이아웃을 다시 그리지 않는 이동도 있다). 첫 그림은 서버 문구 그대로 */
  useEffect(() => {
    if (seen.current === path) return;
    seen.current = path;
    setText(stamp(name, loginCode));
    last.current = Date.now();
  }, [path, name, loginCode]);

  /* 이동 없이 30분이면 다시 적는다 */
  useEffect(() => {
    const check = () => {
      if (Date.now() - last.current < REFRESH_MS) return;
      setText(stamp(name, loginCode));
      last.current = Date.now();
    };
    const id = window.setInterval(check, CHECK_MS);
    const onShow = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onShow); };
  }, [name, loginCode]);

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
