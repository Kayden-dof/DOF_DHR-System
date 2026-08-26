'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem { href: string; label: string }

export default function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-0.5">
      {items.map((it) => {
        const active = it.href === '/' ? path === '/' : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`relative rounded-md px-3.5 py-2 text-sm font-semibold transition-colors ${
              active
                ? 'text-brand-deep'
                : 'text-muted hover:bg-canvas hover:text-ink'
            }`}
          >
            {it.label}
            {active && (
              <span className="absolute inset-x-2.5 -bottom-[9px] h-0.5 rounded-full bg-brand" />
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
    <nav className="flex flex-wrap items-center gap-1.5">
      {items.map((it) => {
        const active = path === it.href || path.startsWith(it.href + '/');
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? 'border-brand bg-brand-soft text-brand-deep'
                : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
