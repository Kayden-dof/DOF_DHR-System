// =============================================================================
// Q-Design 에서 온 사본입니다. **이 파일을 손으로 고치지 마세요.**
//
// 출처   D:/Claude/Q-Design/source/components/TopProgressBar.tsx
// 갱신   cd D:/Claude/Q-Design
//        node tools/extract-all.mjs && node tools/sync.mjs --write
//
// 고칠 일이 생기면 Q-Design 의 원본을 고치고 추출기를 다시 돌립니다.
// 여기서 고치면 제품들의 화면·문서가 갈립니다.
// 아래 지문은 본문의 sha256 이고, 이 저장소의 검사가 대조합니다.
//
// q-design-nav-sha256: 6c2627e5048bf4e6c3679b3133466ebe9be1009eead33b0c77f9caa05d0fd964
// =============================================================================
// q-design-header-end
'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/* ---------------------------------------------------------------------------
   상단 진행선 · 정본

   서버에서 화면을 그리는 시스템은, 무엇을 누르고 나서 다음 화면이 올 때까지
   옛 화면을 그대로 둔 채 아무 표시도 하지 않는다. 망이 느린 곳에서 그 구간이
   길어지면 사람은 «안 눌렸다» 고 읽고 한 번 더 누른다. 두 번 눌러 곤란해지는
   자리가 이 제품들에는 여럿 있다.

   글자로 말하지 않는다. 화면 위쪽에 글이 뜨면 그것부터 읽게 되고, 그 글은
   하던 일과 아무 상관이 없다. 실선 하나가 찬다.

   ── 🔴 언제 시작하는가 (2026-09-09 감사 · 주제 #8) ─────────────────────────
   종전 정본은 `usePathname` 이 바뀔 때 시작했다. 그런데 App Router 에서
   **pathname 은 새 트리가 커밋된 «뒤» 에 바뀐다.** 위쪽에 loading.tsx 경계가
   없는 화면에서는 막대가 «도착한 다음에» 처음 움직였다. 기다리는 동안이 아니라
   기다림이 끝난 뒤에 움직이는 진행 표시는 아무것도 알려 주지 않는다.
   Q-Atelier 실측: app/(app) 의 page.tsx 158개 중 139개가 맨몸이었다.

   그래서 시작을 pathname 에서 뗀다. 누르는 순간 시작한다.
     · 링크는 캡처 단계의 click 감시가 잡는다.
     · router.push 처럼 프로그램이 옮기는 자리는 `startRouteProgress()` 를 부른다.
       click 감시는 a 태그만 보므로 그것을 못 본다.

   ── 다 차지 않는다 ────────────────────────────────────────────────────────
   HOLD(90%)에서 멈춰 기다린다. 얼마나 남았는지 모르면서 100% 를 그리면 다 됐다고
   말하는 것이 되고, 그 뒤로도 화면이 안 바뀌면 그 표시를 다시는 안 믿는다.
   실제로 pathname 이 바뀔 때만 끝까지 채우고 사라진다.

   ── 안 오면 걷는다 ────────────────────────────────────────────────────────
   STALL_MS 안에 도착하지 않으면 스스로 걷는다. 취소된 이동 · 서버 오류 ·
   같은 화면으로의 이동에서 90% 선이 화면에 영영 남는 것을 막는다.

   ── 겉모습은 제품 것이다 ──────────────────────────────────────────────────
   `className` 만 받는다. 색·두께·층은 각 제품의 CSS 가 정한다. 움직임만 한 벌이다.
--------------------------------------------------------------------------- */

/** 기다리는 동안 채우는 한계. 100 은 «도착했다» 는 뜻이라 함부로 쓰지 않는다. */
const HOLD = 90;

/** 이 시간 안에 도착하지 않으면 스스로 걷는다. */
const STALL_MS = 15000;

/** 프로그램이 옮길 때(router.push 등) 이 이름을 던진다. */
const START_EVENT = 'qd:route-start';

/**
 * 움직임을 줄여 달라고 한 사람인가.
 *
 * 🔴 이 검사를 «시작하는 쪽» 에만 두었더니, 끝맺음 effect 가 그대로 남아
 *    화면이 바뀌는 순간 100% 짜리 선이 한 번 번쩍였다(실측: reduce 로 재니
 *    누른 뒤 200ms 까지는 없다가 갑자기 폭 1440 이 여섯 표본). 시작을 막았는데
 *    끝맺음이 그리면 «가장 눈에 띄는 한 프레임» 만 남는 셈이다. 둘 다 막는다.
 */
function 움직임을줄이나(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * 링크가 아닌 이동에서 진행선을 시작한다.
 *
 *   startRouteProgress();
 *   router.push('/어디로');
 *
 * 컴포넌트가 안 떠 있으면 아무 일도 일어나지 않는다(듣는 사람이 없는 외침).
 */
export function startRouteProgress() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(START_EVENT));
}

export function TopProgressBar({ className = 'qa-top-progress' }: { className?: string }) {
  const path = usePathname();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const first = useRef(true);

  /* 화면이 실제로 바뀌면 끝까지 채우고 걷는다 */
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (움직임을줄이나()) return;
    setWidth(100);
    const t1 = setTimeout(() => setVisible(false), 240);
    const t2 = setTimeout(() => setWidth(0), 620);
    timers.current.push(t1, t2);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [path]);

  useEffect(() => {
    /*
     * 움직임을 줄여 달라고 한 사람에게는 아무것도 그리지 않는다.
     * 종전 파일은 머리 주석에 「prefers-reduced-motion 시 표시 안 함」이라 적어 두고
     * **코드에는 검사가 없었다.** 적어 둔 것은 지켜지지 않는다.
     */
    if (움직임을줄이나()) return;

    const 지우기 = () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };

    function 시작() {
      지우기();
      setVisible(true);
      setWidth(18);
      /* 서서히 HOLD 까지만. 남은 시간을 모르므로 다 채우지 않는다 */
      const steps: Array<[number, number]> = [
        [120, 46],
        [320, 68],
        [700, 82],
        [1400, HOLD],
      ];
      for (const [ms, w] of steps) {
        timers.current.push(setTimeout(() => setWidth((cur) => (cur > 0 && cur < w ? w : cur)), ms));
      }
      /* 안 오면 걷는다 */
      timers.current.push(
        setTimeout(() => {
          setVisible(false);
          timers.current.push(setTimeout(() => setWidth(0), 380));
        }, STALL_MS),
      );
    }

    /*
     * 같은 문서 안의 이동만 잡는다. 새 창 · 내려받기 · 바깥 주소는 이 화면이
     * 바뀌지 않으므로 선을 그리면 영영 안 걷힌다.
     */
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      시작();
    }

    document.addEventListener('click', onClick, true);
    window.addEventListener(START_EVENT, 시작);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener(START_EVENT, 시작);
      지우기();
    };
  }, []);

  if (width === 0) return null;
  return <div className={className} style={{ width: `${width}%`, opacity: visible ? 1 : 0 }} aria-hidden />;
}

export default TopProgressBar;
