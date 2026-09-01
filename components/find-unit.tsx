'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

/* ---------------------------------------------------------------------------
   개체 번호 찾기

   라벨에 적힌 번호 하나로 그 제품이 어디서 나와 어디로 갔는지 되짚는 자리다.
   전화가 와서 "이 번호가 뭡니까" 를 묻는 순간에 쓴다.

   ── 왜 판에서 단추로 옮겼는가 ─────────────────────────────────────────────
   경영 화면에 큰 판으로 놓여 있었는데, 평소에는 빈 칸 하나만 덩그러니 떠
   있었다 (사용자 지적 2026-09-01). 자리를 많이 먹으면서 하는 일이 없었다.

   그리고 이건 경영 화면의 기능이 아니다. 어느 화면에서 전화를 받든 바로
   부를 수 있어야 한다. 머리줄로 올리고 단축키를 준다.

   ── 단축키만 두지 않는다 ──────────────────────────────────────────────────
   단축키만 있는 기능은 아는 사람에게만 있는 기능이다. 머리줄에 단추를 두고
   그 옆에 단축키를 적어 둔다. 눌러서 쓰다가 단축키를 익히게 된다.

   ── 결과는 경영 화면이 그린다 ─────────────────────────────────────────────
   찾은 결과를 여기서 다시 그리지 않는다. /board?sn=… 로 넘긴다. 두 곳이 같은
   것을 그리면 갈라진다 (§10).

   ── 왜 body 로 옮겨 그리는가 ──────────────────────────────────────────────
   이 단추는 머리줄 안에 있고, 머리줄에는 backdrop-blur 가 걸려 있다.
   backdrop-filter 는 fixed 자손의 기준 상자를 자기 자신으로 만든다. 그래서
   inset-0 이 화면 전체가 아니라 머리줄 언저리가 되어, 어두운 베일이 위쪽만
   덮고 가로로 잘렸다 (사용자 지적 2026-09-01).

   components/stat-detail.tsx 가 같은 함정을 이미 겪고 주석까지 남겨 두었는데
   여기서 되풀이했다. body 로 옮겨 그리면 어디서 불러도 잘리지 않는다.
--------------------------------------------------------------------------- */

export default function FindUnit() {
  const [open, setOpen] = useState(false);
  const [sn, setSn] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* 열리면 바로 칠 수 있어야 한다. 열어 놓고 또 눌러야 하면 단축키가 아니다 */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = sn.trim();
    if (!v) return;
    setOpen(false);
    router.push(`/board?sn=${encodeURIComponent(v)}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="개체 번호 찾기"
        className="btn-ghost hidden h-9 items-center gap-2 px-3 text-xs sm:flex"
      >
        개체 번호 찾기
        <kbd className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono
                        text-[0.625rem] leading-none text-muted">Ctrl K</kbd>
      </button>

      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="개체 번호 찾기"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/25 px-5 pt-[18vh]"
        >
          <form onSubmit={submit}
                className="w-full max-w-lg rounded-xl border border-line bg-surface p-4 shadow-[var(--sh-3)]">
            <h2 className="text-sm font-bold text-ink">개체 번호 찾기</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              라벨의 번호를 그대로 적으십시오. 제조번호만 적어도 됩니다.
            </p>

            <div className="mt-3 flex gap-2">
              <input
                ref={inputRef}
                value={sn}
                onChange={(e) => setSn(e.target.value)}
                autoComplete="off"
                placeholder="P2608-0004-007 또는 P2608-0004"
                className="input flex-1 font-mono"
              />
              <button type="submit" className="btn-primary shrink-0">찾기</button>
            </div>

            <p className="mt-2.5 text-xs text-faint">
              Enter 로 찾고 Esc 로 닫습니다.
            </p>
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}
