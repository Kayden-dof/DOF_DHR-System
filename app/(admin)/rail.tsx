'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { NavItem } from './nav';

/* ---------------------------------------------------------------------------
   차림표 레일 (Q-Design 7장 «셸: 사이드바가 척추» · «차림표 정본»)

   클래스 이름이 곧 계약이다 (app/q-design.nav.css). 치수 · 활성 표시(굵은 글자 +
   면 + 글자 밑 짧은 강조선) · 접히는 폭(1024px)은 정본이 정한다. 여기서는 순서만
   짠다.

     로고 블록 · 차림표 · 판 번호 · 계정 · 로그아웃

   1024px 미만은 레일을 감추고(정본) 머리 줄의 «차림표» 단추가 같은 내용을
   서랍으로 연다. 떠 있는 단추는 두지 않는다 (Q-Design 최종안 «폰»).

   로고 · 이름 · 계정 줄은 서버에서 그린 조각을 받는다 (설정에서 오는 값이라
   서버가 읽는다).
--------------------------------------------------------------------------- */

function active(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
}

function RailBody({ items, brand, version, foot, onNavigate }: {
  items: NavItem[];
  brand: React.ReactNode;
  version: string;
  foot: React.ReactNode;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  return (
    <>
      <Link href="/" className="qd-rail-brand" aria-label="현황으로" onClick={onNavigate}>
        {brand}
      </Link>

      <nav className="qd-rail-nav" aria-label="차림표">
        {items.map((it) => {
          const on = active(path, it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={on ? 'page' : undefined}
              className={`qd-nav-item${on ? ' is-active' : ''}`}
              onClick={onNavigate}
            >
              <span className="qd-nav-label" data-hangul="">{it.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="qd-rail-version"><span>DHR</span><b>v{version}</b></div>

      <div className="qd-rail-foot">{foot}</div>
    </>
  );
}

export default function Rail(props: {
  items: NavItem[];
  brand: React.ReactNode;
  version: string;
  foot: React.ReactNode;
  /** 좁은 화면 머리 줄의 오른쪽 (개체 번호 찾기 등) */
  bar?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  /* 화면을 옮기면 서랍을 닫는다. Esc 로도 닫힌다 */
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <aside className="qd-rail" aria-label="차림표 레일">
        <RailBody {...props} />
      </aside>

      {/* 좁은 화면: 머리 줄 하나. 레일은 정본이 감춘다 (1023px 이하) */}
      <div className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
        <button type="button" className="qd-text-action -ml-1" aria-expanded={open}
                aria-controls="qd-drawer" onClick={() => setOpen(true)}>
          차림표
        </button>
        <span className="h-4 w-px bg-line-strong" aria-hidden />
        <Link href="/" className="min-w-0 truncate text-sm font-semibold text-ink">
          {props.items.find((it) => active(path, it.href))?.label ?? '현황'}
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2">{props.bar}</div>
      </div>

      {open && (
        <div className="qd-rail-backdrop" onClick={() => setOpen(false)}>
          <aside id="qd-drawer" className="qd-rail qd-rail--drawer" aria-label="차림표"
                 onClick={(e) => e.stopPropagation()}>
            <RailBody {...props} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
