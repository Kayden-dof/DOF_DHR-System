'use client';

/* ---------------------------------------------------------------------------
   알림 띄우기

   서버 동작의 결과를 화면 오른쪽 위에 잠깐 띄운다. 자리를 차지하지 않으므로
   아래 내용이 밀리지 않는다 (사용자 지적 2026-09-08 · 재고 화면).

   ── 왜 Msg 를 고치지 않는가 ──────────────────────────────────────────────
   `Msg` 는 **입력 칸 옆에 붙는 말**이다. 어느 칸이 잘못됐는지 알려면 그 칸
   가까이에 있어야 하고, 대화상자 안에서는 떠다니면 오히려 못 찾는다. 그건
   그대로 둔다.

   여기 띄우는 것은 다른 종류다 - 화면 전체에 대고 "그 일을 했다" 고 말하는
   것이라 어느 칸에도 매이지 않는다.

   ── 성공은 사라지고 어긋남은 남는다 ──────────────────────────────────────
   성공은 몇 초 뒤 스스로 사라진다. **어긋남은 사람이 닫을 때까지 남는다.**
   기록을 쓰는 화면에서 놓친 오류는 어질러진 화면보다 나쁘다.

   ── 왜 body 로 옮겨 그리는가 ─────────────────────────────────────────────
   `position: fixed` 는 조상에 transform 이나 backdrop-filter 가 있으면 그
   조상을 기준으로 잡힌다. 머리띠가 `backdrop-blur` 를 쓰므로 그 안에서 그리면
   화면 오른쪽이 아니라 머리띠 오른쪽에 붙는다 (find-unit.tsx 에 같은 자국이
   있다). 그래서 body 로 옮겨 그린다.
--------------------------------------------------------------------------- */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FormState } from '@/lib/forms';

/** 성공 알림이 스스로 사라지기까지. 어긋남은 사라지지 않는다 */
const KEEP_MS = 6000;

interface Note { id: number; tone: 'ok' | 'danger'; text: string }

let seq = 0;

export default function Toasts({ states }: { states: (FormState | undefined)[] }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [mounted, setMounted] = useState(false);
  /* 자리마다 마지막으로 본 상태. 같은 것을 두 번 띄우지 않는다 */
  const seen = useRef<(FormState | undefined)[]>([]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const fresh: Note[] = [];
    states.forEach((st, i) => {
      if (st === seen.current[i]) return;
      seen.current[i] = st;
      if (!st) return;
      if (st.error) fresh.push({ id: ++seq, tone: 'danger', text: st.error });
      else if (st.ok && st.message) fresh.push({ id: ++seq, tone: 'ok', text: st.message });
    });
    if (fresh.length) setNotes((prev) => [...prev, ...fresh]);
  });

  /* 성공만 스스로 물러난다 */
  useEffect(() => {
    const going = notes.filter((n) => n.tone === 'ok');
    if (going.length === 0) return;
    const t = setTimeout(() => {
      setNotes((prev) => prev.filter((n) => n.tone !== 'ok' || !going.includes(n)));
    }, KEEP_MS);
    return () => clearTimeout(t);
  }, [notes]);

  if (!mounted || notes.length === 0) return null;

  const close = (id: number) => setNotes((prev) => prev.filter((n) => n.id !== id));

  return createPortal(
    <div
      /*
       * 대화상자(z-60)보다 **위**에 둔다.
       *
       * 처음에는 아래에 두었다 - 대화상자 단추를 가리지 않으려는 뜻이었다.
       * 그런데 아래에 두면 대화상자를 연 동안 알림이 덮개에 가려 아예 안
       * 보인다. 안 보이는 것이 가리는 것보다 나쁘다.
       *
       * 가리는 문제는 층이 아니라 `pointer-events-none` 이 푼다 - 띠는
       * 클릭을 통과시키고 알림 상자만 받는다. 그래서 위에 두어도 뒤쪽
       * 단추를 막지 않는다.
       */
      className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {notes.map((n) => (
        <div
          key={n.id}
          role={n.tone === 'danger' ? 'alert' : 'status'}
          className={`rise pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2.5
            text-sm leading-relaxed shadow-[var(--sh-3)] ${
            n.tone === 'danger'
              ? 'border-danger-line bg-danger-bg text-danger'
              : 'border-ok/20 bg-ok-bg text-ink'}`}
        >
          <span aria-hidden className={`mt-px shrink-0 font-bold ${n.tone === 'ok' ? 'text-ok' : ''}`}>
            {n.tone === 'danger' ? '!' : '✓'}
          </span>
          <span className="flex-1">{n.text}</span>
          <button
            type="button"
            onClick={() => close(n.id)}
            aria-label="알림 닫기"
            className="-mr-1 -mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs text-muted
                       hover:bg-canvas hover:text-ink focus-visible:outline-2"
          >
            닫기
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
