'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem { href: string; label: string }

/* ---------------------------------------------------------------------------
   상단 메뉴

   현재 위치를 밑줄 하나로만 말한다. 배경까지 칠하면 상단이 얼룩덜룩해지고
   글자 무게가 흔들려 어디가 지금인지 오히려 흐려진다.
--------------------------------------------------------------------------- */
export default function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto px-1">
      {items.map((it) => {
        const active = it.href === '/' ? path === '/' : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`relative shrink-0 rounded-md px-3 py-2 text-[0.8125rem] font-bold transition-colors ${
              active ? 'text-brand' : 'text-muted hover:bg-canvas hover:text-ink'
            }`}
          >
            {it.label}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-[11px] h-[2px] rounded-full bg-brand"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** 설정 · 자재처럼 하위 화면이 여럿인 구역의 두 번째 줄. */
export function SubNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface-sub p-1">
      {items.map((it) => {
        const active = path === it.href || path.startsWith(it.href + '/');
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-[0.3125rem] px-3 py-1.5 text-xs font-bold transition-all ${
              active
                ? 'bg-surface text-brand shadow-[0_1px_2px_rgb(31_29_36/.06)]'
                : 'text-muted hover:text-ink'
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
