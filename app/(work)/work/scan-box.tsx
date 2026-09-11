'use client';

import { useEffect, useRef } from 'react';

/* ---------------------------------------------------------------------------
   배치 찍어 열기 (사용자 요청 2026-09-11)

   ── 왜 스캔인가 ────────────────────────────────────────────────────────
   목록에서 눈으로 고르면 **옆 배치를 누른다.** 배치번호가 `B260811-01` 과
   `B260811-02` 처럼 한 글자만 다르면 더 그렇다. 손에 든 종이를 찍으면 그
   종이의 배치가 열린다 - 고를 것이 없으면 틀릴 것도 없다.

   ── 새 바코드를 만들지 않는다 ──────────────────────────────────────────
   모든 인쇄물 아래에 자료 식별자 바코드가 하나씩 있다 (print-frame). 한 장에
   둘을 찍으면 "어느 걸 찍지" 가 생기고 그것이 새 실수가 된다 (사용자 지적).
   덤으로 너그럽다 - 그 배치의 **아무 종이나** 찍어도 같은 배치가 열린다.

   ── 스캐너는 키보드다 ──────────────────────────────────────────────────
   준비실 기기는 스캐너가 꽂힌 패드형 PC 다 (사용자). 스캐너는 글자를 치고
   Enter 를 친다. 그러니 이 칸이 늘 초점을 쥐고 있어야 한다 - 한 번이라도
   놓치면 찍은 값이 허공으로 간다.
--------------------------------------------------------------------------- */
export default function ScanBox() {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();

    /*
     * 초점을 놓치면 되찾는다. 0ms 로 미루는 것은 브라우저가 초점을 옮기는
     * 것을 마친 뒤에 되돌리기 위해서다 - 같은 순번에 부르면 밀려난다.
     *
     * 다른 칸을 누르는 동안에는 뺏지 않는다. 사람이 검색칸에 손대는데 초점이
     * 튀면 그것이 더 나쁜 실수가 된다.
     */
    const back = (e: FocusEvent) => {
      const next = e.relatedTarget as HTMLElement | null;
      if (next && (next.tagName === 'INPUT' || next.tagName === 'SELECT'
                   || next.tagName === 'TEXTAREA' || next.tagName === 'BUTTON')) return;
      setTimeout(() => ref.current?.focus(), 0);
    };
    el.addEventListener('blur', back);
    return () => el.removeEventListener('blur', back);
  }, []);

  return (
    <form action="/work" method="get" className="card p-4">
      <label htmlFor="scan" className="label mb-1 text-base">
        작업 서류의 바코드를 찍으십시오
      </label>
      <input
        ref={ref}
        id="scan"
        name="scan"
        autoComplete="off"
        spellCheck={false}
        placeholder="A1B2C3D4E5F6"
        className="input h-14 w-full text-center font-mono text-xl tracking-widest"
      />
      {/*
        * 단추를 둔다. 스캐너의 Enter 만 믿지 않는다 - 스캐너 설정에 따라
        * Enter 대신 Tab 을 보내는 것이 있고, 손으로 칠 때도 누를 자리가
        * 있어야 한다. 폼에 단추가 하나면 Enter 도 이 단추를 누른다.
        */}
      <button type="submit" className="btn-primary mt-2 h-12 w-full text-base">
        열기
      </button>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        작업지시서 · 제조기록서 · 편철 표지 <b className="text-ink">아무 것이나</b> 됩니다.
        종이 아래쪽 바코드 하나입니다. 스캐너가 없으면 그 밑의 열두 자리를 쳐도 됩니다.
      </p>
    </form>
  );
}
