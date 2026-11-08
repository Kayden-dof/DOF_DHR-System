'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { NavItem } from './nav';
import { RAIL_COOKIE_PREFIX } from '@/lib/rail';
import { LayoutDashboard } from '@/components/icons/LayoutDashboard';
import { BarChart3 } from '@/components/icons/BarChart3';
import { Factory } from '@/components/icons/Factory';
import { BookText } from '@/components/icons/BookText';
import { Wrench } from '@/components/icons/Wrench';
import { Boxes } from '@/components/icons/Boxes';
import { Truck } from '@/components/icons/Truck';
import { ScanSearch } from '@/components/icons/ScanSearch';
import { Settings } from '@/components/icons/Settings';
import { ScrollText } from '@/components/icons/ScrollText';
import { FileText } from '@/components/icons/FileText';
import { ChevronLeft } from '@/components/icons/ChevronLeft';
import { ChevronRight } from '@/components/icons/ChevronRight';

/* ---------------------------------------------------------------------------
   차림표 레일 (DOF Design 시스템 · 오너 결정 2026-11-07 «A · 레일»)

   클래스 이름이 곧 계약이다 (app/dof-design.nav.css). 치수 · 활성 표시(굵은 글자 +
   면 + 글자 밑 짧은 강조선) · 접히는 폭(1024px)은 그 파일이 정한다. 여기서는
   순서만 짠다.

     로고 블록 · 차림표 · 판 번호 · 접기 단추 · 계정 · 로그아웃

   아이콘은 components/icons 의 Phosphor Regular 모듈이다. 뜻으로 고른다.

   접힌 레일: 폭 60 · 아이콘만 · 이름은 올리면 뜬다 · 계정별로 기억한다
   (사용자 지시 2026-11-09). 치수는 app/dof-design.nav.css 끝의 «접힌 레일».
   기억은 쿠키라 서버가 첫 그림부터 접힌 채로 그린다 (펼쳤다 접히는 깜빡임이 없다).

   1024px 미만은 레일을 감추고 머리 줄의 «차림표» 단추가 같은 내용을
   서랍으로 연다. 서랍은 늘 펼친 모양이다. 떠 있는 단추는 두지 않는다.

   로고 · 이름 · 계정 줄은 서버에서 그린 조각을 받는다 (설정에서 오는 값이라
   서버가 읽는다).
--------------------------------------------------------------------------- */

type IconType = typeof Factory;

/* 경로마다 뜻으로 고른 아이콘. 목록에 없는 경로는 문서 아이콘으로 둔다 */
const ICON: Record<string, IconType> = {
  '/': LayoutDashboard,
  '/board': BarChart3,
  '/production': Factory,
  '/settings/dmr': BookText,
  '/equipment': Wrench,
  '/material': Boxes,
  '/shipping': Truck,
  '/trace': ScanSearch,
  '/settings': Settings,
  '/settings/audit': ScrollText,
};


function active(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
}

/*
 * 켜지는 항목은 하나다. /settings/dmr 에서 «설정» 과 «제품표준서» 가 같이 켜지지
 * 않게 가장 깊게 맞는 경로 하나만 고른다 (하위 차림표 SubNav 와 같은 규칙).
 */
function currentHref(path: string, items: NavItem[]) {
  return items.reduce<string | null>(
    (best, it) => (active(path, it.href) && it.href.length > (best?.length ?? 0) ? it.href : best),
    null,
  );
}

function RailBody({ items, brand, brandMini, version, foot, mini = false, onToggle, onNavigate }: {
  items: NavItem[];
  brand: React.ReactNode;
  brandMini: React.ReactNode;
  version: string;
  foot: React.ReactNode;
  mini?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const current = currentHref(path, items);
  return (
    <>
      <Link href="/" className="qd-rail-brand" aria-label="현황으로" onClick={onNavigate}>
        {mini ? brandMini : brand}
      </Link>

      <nav className="qd-rail-nav" aria-label="차림표">
        {items.map((it) => {
          const on = it.href === current;
          const Icon = ICON[it.href] ?? FileText;
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={on ? 'page' : undefined}
              aria-label={mini ? it.label : undefined}
              title={mini ? it.label : undefined}
              className={`qd-nav-item${on ? ' is-active' : ''}`}
              onClick={onNavigate}
            >
              <span className="qd-nav-icon" aria-hidden><Icon /></span>
              {!mini && <span className="qd-nav-label" data-hangul="">{it.label}</span>}
            </Link>
          );
        })}
      </nav>

      {!mini && <div className="qd-rail-version"><span>DHR</span><b>v{version}</b></div>}

      {onToggle && (
        <div className={`qd-rail-row ${mini ? 'justify-center' : 'justify-end'}`}>
          <button
            type="button"
            className="qd-rail-iconbtn"
            onClick={onToggle}
            aria-expanded={!mini}
            aria-label={mini ? '차림표 펼치기' : '차림표 접기'}
            title={mini ? '차림표 펼치기' : '차림표 접기'}
          >
            {mini ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      )}

      <div className="qd-rail-foot">{foot}</div>
    </>
  );
}

export default function Rail(props: {
  items: NavItem[];
  brand: React.ReactNode;
  /** 접힌 레일의 로고 자리 (60px 안에 드는 표식) */
  brandMini: React.ReactNode;
  version: string;
  foot: React.ReactNode;
  /** 서버가 쿠키에서 읽은 접힘 상태. 첫 그림을 이것으로 그린다 */
  collapsed: boolean;
  /** 접힘을 계정별로 기억하는 열쇠 (계정 식별자) */
  who: string;
  /** 좁은 화면 머리 줄의 오른쪽 (개체 번호 찾기 등) */
  bar?: React.ReactNode;
}) {
  const { collapsed: initialCollapsed, who, ...body } = props;
  const [open, setOpen] = useState(false);
  const [mini, setMini] = useState(initialCollapsed);
  const path = usePathname();

  /* 화면을 옮기면 서랍을 닫는다. Esc 로도 닫힌다 */
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function toggle() {
    setMini((prev) => {
      const next = !prev;
      /* 계정별로 한 해 기억한다. 같은 PC 를 여러 사람이 써도 서로의 접힘을 덮지 않는다 */
      document.cookie = `${RAIL_COOKIE_PREFIX}${who}=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }

  const label = props.items.find((it) => it.href === currentHref(path, props.items))?.label ?? '현황';

  return (
    <>
      <aside className={`qd-rail${mini ? ' qd-rail--collapsed' : ''}`} aria-label="차림표 레일">
        <RailBody {...body} mini={mini} onToggle={toggle} />
      </aside>

      {/* 좁은 화면: 머리 줄 하나. 레일은 정본이 감춘다 (1023px 이하) */}
      <div className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
        <button type="button" className="qd-text-action -ml-1" aria-expanded={open}
                aria-controls="qd-drawer" onClick={() => setOpen(true)}>
          차림표
        </button>
        <span className="h-4 w-px bg-line-strong" aria-hidden />
        <Link href="/" className="min-w-0 truncate text-sm font-semibold text-ink">
          {label}
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2">{props.bar}</div>
      </div>

      {open && (
        <div className="qd-rail-backdrop" onClick={() => setOpen(false)}>
          <aside id="qd-drawer" className="qd-rail qd-rail--drawer" aria-label="차림표"
                 onClick={(e) => e.stopPropagation()}>
            <RailBody {...body} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
