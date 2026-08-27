'use client';

import { useEffect, useState } from 'react';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   정정 팝업

   기록을 고치는 칸은 팝업으로 띄우고, 고쳐지면 스스로 닫는다 (사용자 지시).

   ── 왜 인라인이 아닌가 ────────────────────────────────────────────────────
   줄 아래로 펼치면 뒤의 목록이 통째로 밀려 내려가 방금 보던 자리를 잃는다.
   현장 화면은 숫자판과 사유 타일이 붙어 있어 펼친 높이가 화면을 넘기도 한다.
   고치는 동안은 고칠 것 하나만 보이는 편이 낫다.

   ── 왜 스스로 닫는가 ──────────────────────────────────────────────────────
   열린 채로 두면 방금 고친 값이 그대로 남아 한 번 더 누르기 쉽다. 정정을 두 번
   하면 재고가 두 번 움직인다. 닫아 두면 다시 열어야 하고, 그때는 줄에 새 값이
   이미 적혀 있어 무슨 일이 있었는지 보인다.

   실패했을 때는 닫지 않는다. 무엇이 잘못됐는지 읽고 고쳐 다시 낼 자리가
   있어야 한다.
--------------------------------------------------------------------------- */

export function useDialog(...states: FormState[]) {
  const [open, setOpen] = useState(false);
  const ok = states.some((s) => s.ok);

  useEffect(() => { if (ok) setOpen(false); }, [ok]);

  return { open, setOpen };
}

export function Dialog({
  open, onClose, title, note, children, wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  /** 숫자판처럼 넓은 것이 들어갈 때 */
  wide?: boolean;
}) {
  /* 뒤로 가기나 Esc 로도 닫힌다. 팝업에 갇히는 화면을 만들지 않는다 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/55 p-4 backdrop-blur-sm"
    >
      <div className={`card-raised my-4 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
        <header className="section-head">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-ink">{title}</h3>
            {note && <p className="mt-0.5 text-sm leading-relaxed text-muted">{note}</p>}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost ml-auto shrink-0">
            닫기
          </button>
        </header>
        <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
