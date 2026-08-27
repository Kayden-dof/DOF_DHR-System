'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ---------------------------------------------------------------------------
   숫자 뒤의 내역

   요약 띠에 숫자만 세워 두면 "204개"가 무엇의 204개인지 알 수 없다. 어떤
   제품이 몇 개씩인지, 불량률 0.49% 가 몇 개 가운데 몇 개인지가 잘려 나간다.
   숫자만 보여 주고 근거를 감추면 보는 사람은 그 숫자를 확인할 방법이 없다
   (사용자 지적).

   그렇다고 띠에 다 적으면 띠가 표가 된다. 그래서 평소에는 숫자만 두고,
   가리키면 내역이 뜬다.

   ── 왜 body 로 그리는가 ───────────────────────────────────────────────────
   요약 띠는 overflow-hidden 안에 있다. 그 안에서 띄우면 칸 밖으로 나가는
   순간 잘린다. body 로 옮겨 그리면 어디서 불러도 잘리지 않는다.

   ── 키보드로도 열린다 ─────────────────────────────────────────────────────
   마우스를 올려야만 보이는 정보는 마우스가 없는 사람에게는 없는 정보다.
   초점을 받아도 열린다.
--------------------------------------------------------------------------- */

export default function StatDetail({ title, children }: {
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  function open() {
    const el = ref.current?.parentElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAt({ x: r.left, y: r.bottom });
  }

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={open}
        onMouseLeave={() => setAt(null)}
        onFocus={open}
        onBlur={() => setAt(null)}
        tabIndex={0}
        aria-label={`${title} 내역`}
        className="absolute inset-0 cursor-help rounded-[inherit] focus-visible:outline-2 focus-visible:outline-brand"
      />

      {at && createPortal(
        <div
          role="tooltip"
          style={{
            /* 오른쪽 끝 칸이 화면 밖으로 나가지 않게 안쪽으로 당긴다 */
            left: Math.min(at.x, window.innerWidth - 340),
            top: at.y + 6,
          }}
          className="pointer-events-none fixed z-[70] w-80 rounded-lg border border-line bg-surface p-3 shadow-[var(--sh-3)]"
        >
          <p className="text-[0.6875rem] font-bold tracking-wide text-muted">{title}</p>
          <div className="mt-1.5 text-sm leading-relaxed text-ink">{children}</div>
        </div>,
        document.body,
      )}
    </>
  );
}
