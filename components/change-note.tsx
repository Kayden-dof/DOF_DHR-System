'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ---------------------------------------------------------------------------
   수정 사항 안내 (사용자 2026-11-20)

   "이런 기록 이렇게까지 대놓고 표기 하라건가? 차라리 수정 사항 존재 라는 안내를
    만들고 거기에 마우스를 올리면 전체 내용이 뜨게"

   고친 내역(정정 · 서명 고침)을 한 줄씩 늘어놓지 않고 «수정 사항 N건» 하나로 접는다.
   마우스를 올리면 뜨고, 패드에서는 누르면 뜬다 (다시 누르거나 밖을 누르면 닫힌다).

   판은 body 에 띄운다. 표 · 가로 스크롤 안에서 부르면 그 상자에 잘린다
   (components/dialog.tsx 와 같은 까닭).
--------------------------------------------------------------------------- */

export interface ChangeLine {
  /** 무엇을 (일차 · 작업일 · 2일차 투입 · 작업(검사)자 …) */
  what: string;
  /** 이전 → 이후. 이전을 모르면 이후만 */
  from?: string | null;
  to: string;
  /** 고친 사람 · 때 */
  by: string;
  at: string;
  why?: string | null;
  /** 앞머리 (고침 · 강제 정정 · 서명 고침) */
  tag?: string;
}

export function ChangeNote({ lines, className = '' }: { lines: ChangeLine[]; className?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(420, window.innerWidth - 24);
    setAt({ top: r.bottom + 6, left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) });
  }, []);

  const show = () => { if (timer.current) clearTimeout(timer.current); place(); setOpen(true); };
  const hideSoon = () => {
    if (pinned) return;
    timer.current = setTimeout(() => setOpen(false), 150);
  };

  /* 눌러서 연 판은 밖을 누르거나 Esc 로 닫는다. 구르면 자리를 다시 잡는다 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || document.getElementById('change-note-panel')?.contains(t)) return;
      setOpen(false); setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setPinned(false); } };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  if (lines.length === 0) return null;

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={hideSoon}
        onClick={() => { if (pinned) { setPinned(false); setOpen(false); } else { setPinned(true); show(); } }}
        className={`qd-tag qd-tag--sm qd-tag--gold cursor-pointer${className ? ` ${className}` : ''}`}
        data-hangul=""
      >
        <span aria-hidden className="qd-tag-dot" />
        수정 사항 <span className="tnum">{lines.length}</span>건
      </button>
      {open && at && createPortal(
        <div
          id="change-note-panel"
          role="dialog"
          aria-label="수정 사항"
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          className="qd-popover fixed z-[70] max-h-[60vh] overflow-auto"
          style={{ top: at.top, left: at.left, width: Math.min(420, window.innerWidth - 24) }}
        >
          <ul className="space-y-2.5">
            {lines.map((x, i) => (
              <li key={i} className="text-xs leading-relaxed text-muted">
                <p className="text-ink">
                  {x.tag && <span className="font-semibold">{x.tag} · </span>}
                  {x.what}:{' '}
                  {x.from != null && <><span className="tnum">«{x.from}»</span> → </>}
                  <span className="tnum font-semibold">«{x.to}»</span>
                </p>
                <p><span className="tnum">{x.at}</span> · {x.by}{x.why ? <> · {x.why}</> : null}</p>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
