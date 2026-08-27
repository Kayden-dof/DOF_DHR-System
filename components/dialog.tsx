'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  /*
   * 팝업이 떠 있는 동안 뒤 화면이 따라 구르지 않게 한다. 현장에서 손가락으로
   * 밀면 팝업 대신 뒤가 움직여 어디를 보고 있는지 잃는다.
   */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  /* Esc 로도 닫힌다. 팝업에 갇히는 화면을 만들지 않는다 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /*
   * 본문 밖(body)에 그린다.
   *
   * 처음에는 부른 자리에 그대로 그렸는데, 인쇄 이력의 회수 단추가 표의 sticky
   * 칸 안에 있어서 팝업이 머리글 아래로 깔렸다 (사용자 확인). 표 · sticky ·
   * overflow 안에서 부르면 어디서 어떻게 가려질지 부르는 쪽이 알 수 없다.
   * body 로 옮기면 부르는 자리와 무관하게 늘 맨 위에 뜬다.
   *
   * 서버에서는 document 가 없으므로 붙은 뒤에만 그린다.
   */
  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[60] overflow-y-auto bg-ink/55 backdrop-blur-sm"
    >
      {/*
        * 짧으면 화면 가운데, 길면 위에서부터 흐른다. items-center 만 주면 긴
        * 팝업의 위쪽이 화면 밖으로 잘려 닫기 단추에 닿지 못한다.
        */}
      <div className="flex min-h-full items-center justify-center p-4"
           onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className={`card-raised w-full ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
          <header className="section-head">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-ink">{title}</h3>
              {note && <p className="mt-0.5 text-sm leading-relaxed text-muted">{note}</p>}
            </div>
            <button type="button" onClick={onClose} className="btn-ghost ml-auto shrink-0">
              닫기
            </button>
          </header>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
