'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

   이름 풍선은 브라우저 title 이 아니라 직접 띄운다 (사용자 2026-11-26 «메뉴명 팝업이 너무 느리다»).
   title 은 1초 가까이 기다렸다 뜨고 늦춤을 고칠 수 없다. 레일은 넘친 것을 자르므로(overflow) 풍선을
   레일 안에 그리면 잘린다 - body 에 붙여 화면 기준 자리에 띄운다. 접힌 레일에는 판 번호를 주.부
   번호만 짧게 둔다 (사용자 같은 날 «접을 때 간단한 버전 정도는»).
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

/* 풍선: 무엇을 · 어디에 (화면 기준, 가리킨 것의 오른쪽 가운데) */
type Tip = { label: string; top: number; left: number } | null;

/* 가리킨 것의 오른쪽에 바로 띄운다. 기다리지 않는다 */
function tipAt(el: HTMLElement, label: string): Tip {
  const r = el.getBoundingClientRect();
  return { label, top: r.top + r.height / 2, left: r.right + 8 };
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
  const [tip, setTip] = useState<Tip>(null);
  useEffect(() => { setTip(null); }, [path, mini]);

  /* 풍선을 다는 손잡이. 접힌 레일에서만 (펼치면 이름이 보인다) - 접기 단추는 늘 */
  const tipProps = (label: string, always = false) => (mini || always ? {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => setTip(tipAt(e.currentTarget, label)),
    onFocus: (e: React.FocusEvent<HTMLElement>) => setTip(tipAt(e.currentTarget, label)),
    onMouseLeave: () => setTip(null),
    onBlur: () => setTip(null),
  } : {});

  const short = version.split('.').slice(0, 2).join('.');

  return (
    <>
      <Link href="/" className="qd-rail-brand" aria-label="현황으로" onClick={onNavigate}>
        {mini ? brandMini : brand}
      </Link>

      <nav className="qd-rail-nav" aria-label="차림표" onScroll={() => setTip(null)}>
        {items.map((it) => {
          const on = it.href === current;
          const Icon = ICON[it.href] ?? FileText;
          return (
            <Link
              key={it.href}
              href={it.go ?? it.href}
              aria-current={on ? 'page' : undefined}
              aria-label={mini ? it.label : undefined}
              className={`qd-nav-item${on ? ' is-active' : ''}`}
              onClick={onNavigate}
              {...tipProps(it.label)}
            >
              <span className="qd-nav-icon" aria-hidden><Icon /></span>
              {!mini && <span className="qd-nav-label" data-hangul="">{it.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* 접기 단추가 위, 판 번호가 아래 (사용자 2026-11-26 «이거 위아래 위치 바꿔줘») */}
      {onToggle && (
        <div className={`qd-rail-row ${mini ? 'justify-center' : 'justify-end'}`}>
          <button
            type="button"
            className="qd-rail-iconbtn"
            onClick={onToggle}
            aria-expanded={!mini}
            aria-label={mini ? '차림표 펼치기' : '차림표 접기'}
            {...tipProps(mini ? '차림표 펼치기' : '차림표 접기', true)}
          >
            {mini ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      )}

      {mini
        ? <div className="qd-rail-version-mini" aria-label={`DHR 판 ${version}`} tabIndex={-1}
               {...tipProps(`DHR v${version}`)}>v{short}</div>
        : <div className="qd-rail-version"><span>DHR</span><b>v{version}</b></div>}

      <div className="qd-rail-foot">{foot}</div>

      {tip && createPortal(
        <div className="qd-rail-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>{tip.label}</div>,
        document.body)}
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
