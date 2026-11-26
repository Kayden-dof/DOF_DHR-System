'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from './icons/ChevronDown';

/* ---------------------------------------------------------------------------
   줄 끝 동작 묶음 (사용자 2026-11-26 «인쇄 · 고치기 수정을 한 번에 묶고 버튼 클릭하면
   팝업 나오고 그중에 하나 고르는 형태로 하면 스크롤 없이 들어오지 않을까»)

   줄마다 인쇄 · 고치기 · 지우기를 따로 세우면 열이 두세 개 늘고, 없는 쪽 자리까지
   비워 두느라(«같은 자리에 서기») 표가 오른쪽으로 넘쳤다. 단추 하나를 두고 누르면
   고를 것이 세로로 뜬다.

   ── 고른 뒤에도 붙여 둔다 ─────────────────────────────────────────────────
   고치기 · 지우기는 저마다 대화상자를 가진 부품이다. 목록을 닫을 때 그 부품을 걷으면
   방금 연 대화상자도 같이 사라진다. 그래서 목록은 숨기기만 하고(hidden) 부품은 붙여
   둔다 - 대화상자는 body 에 그려지므로(components/dialog.tsx) 목록이 숨어도 보인다.

   ── body 에 띄운다 ─────────────────────────────────────────────────────────
   표는 옆으로 구르는 상자(.qd-table-scroll) 안에 있어, 그 안에 띄우면 목록이 잘린다.
   단추 자리를 재서 화면에 고정으로 띄우고, 화면이 구르거나 크기가 바뀌면 닫는다.
--------------------------------------------------------------------------- */

const GAP = 4;
/* 아래로 펼칠 자리가 이보다 좁으면 위로 펼친다 (세 줄 남짓) */
const ROOM = 180;

export function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [at, setAt] = useState<React.CSSProperties>({});

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const right = window.innerWidth - r.right;
      setAt(window.innerHeight - r.bottom < ROOM
        ? { bottom: window.innerHeight - r.top + GAP, right }
        : { top: r.bottom + GAP, right });
    }
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    const shut = () => setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); }
    };
    document.addEventListener('mousedown', outside);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('resize', shut);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('resize', shut);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className="qd-text-action gap-1" aria-haspopup="menu" aria-expanded={open}
              onClick={() => setOpen((v) => !v)}>
        {label}<ChevronDown size={14} />
      </button>
      {mounted && createPortal(
        <div ref={panel} role="menu" hidden={!open} aria-label={label}
             className="qd-popover row-menu fixed z-[60]" style={at}
             onClick={(e) => { if ((e.target as HTMLElement).closest('a, button')) setOpen(false); }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
