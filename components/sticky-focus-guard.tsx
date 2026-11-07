// =============================================================================
// Q-Design 에서 온 사본입니다. **이 파일을 손으로 고치지 마세요.**
//
// 출처   D:/Claude/Q-Design/source/components/sticky-focus-guard.tsx
// 갱신   cd D:/Claude/Q-Design
//        node tools/extract-all.mjs && node tools/sync.mjs --write
//
// 고칠 일이 생기면 Q-Design 의 원본을 고치고 추출기를 다시 돌립니다.
// 여기서 고치면 제품들의 화면·문서가 갈립니다.
// 아래 지문은 본문의 sha256 이고, 이 저장소의 검사가 대조합니다.
//
// q-design-nav-sha256: 665806fb8fff20d3fb936589daf99a560b82c19ccbe9eb1b36e7071720b2d70c
// =============================================================================
// q-design-header-end
'use client';

/*
 * 따라오는 거르개 띠가 키보드 초점을 가리지 않게 한다 (WCAG 2.2 · 2.4.11 초점이 가려지지 않음)
 *
 * 거르개 띠(정본 .qd-filter-bar--sticky · 원본 .qa-list-toolbar)는 스크롤을 따라와 위에 붙는다.
 * 그러면 Tab 으로 위쪽 칸에 옮겨 갈 때 브라우저가 그 칸을 스크롤 틀의 맨 위로 끌어올려, 칸이 띠
 * «밑» 에 가린다(2026-09-25 Q-Carnet 실측: 39걸음 중 6걸음). 스크롤 틀의 scroll-padding-top 을
 * «띠가 붙는 자리 + 띠 높이» 로 두면 브라우저가 초점 칸을 띠 아래까지만 끌어온다.
 *
 * 띠 높이는 화면 폭 · 칩 줄 · 탭 줄에 따라 달라(넓은 화면 124 · 폰 폭 273 등) CSS 로 못 박지 않고
 * 잰다. 띠가 없거나 따라오지 않는 화면(인쇄 · position 이 sticky 가 아님)에서는 여백을 걷는다.
 *
 * 쓰는 법: 앱 셸에 한 번 둔다.  <StickyFocusGuard />
 * 오너 결정 2026-09-25 「초점 가림 고침」 · Q-Design docs/16 「초점 · 줄 높이 · 표 안 빈 줄」.
 */
import { useEffect } from 'react';

const BARS = '.qd-filter-bar--sticky, .qa-list-toolbar';
/* 초점 칸과 띠 사이에 남기는 숨 */
const GAP = 8;

function scrollHostOf(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.documentElement;
}

export function StickyFocusGuard() {
  useEffect(() => {
    const touched = new Set<HTMLElement>();
    const resize = new ResizeObserver(() => schedule());
    let frame = 0;

    function measure() {
      frame = 0;
      const bars = [...document.querySelectorAll<HTMLElement>(BARS)];
      resize.disconnect();
      const next = new Map<HTMLElement, number>();
      for (const bar of bars) {
        resize.observe(bar);
        const cs = getComputedStyle(bar);
        if (cs.position !== 'sticky' || cs.display === 'none') continue;
        const host = scrollHostOf(bar);
        const pad = Math.ceil((parseFloat(cs.top) || 0) + bar.getBoundingClientRect().height + GAP);
        next.set(host, Math.max(next.get(host) ?? 0, pad));
      }
      for (const host of touched) if (!next.has(host)) host.style.scrollPaddingTop = '';
      touched.clear();
      for (const [host, pad] of next) {
        host.style.scrollPaddingTop = `${pad}px`;
        touched.add(host);
      }
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }

    /* 화면을 옮기거나 목록이 다시 그려지면 띠가 바뀐다. 잦은 변화는 한 프레임에 한 번만 잰다 */
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    schedule();

    return () => {
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      for (const host of touched) host.style.scrollPaddingTop = '';
    };
  }, []);

  return null;
}
