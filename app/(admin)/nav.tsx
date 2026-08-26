'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem { href: string; label: string }

/* ---------------------------------------------------------------------------
   상단 메뉴

   현재 위치를 밑줄 하나로만 말한다. 배경까지 칠하면 상단이 얼룩덜룩해지고
   글자 무게가 흔들려 어디가 지금인지 오히려 흐려진다.

   지금 자리는 가장 짙은 글자색으로 둔다. 자주로 칠했더니 회색 글자들보다
   오히려 옅어서, 색은 붙었는데 눈은 다른 데를 봤다. 강조는 밑줄이 맡고
   글자는 대비만 맡는다.
--------------------------------------------------------------------------- */
export default function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    /*
     * 메뉴 칸이 상단 머리 높이를 그대로 받는다. 밑줄을 글자 아래 몇 px 로
     * 잡아 두었더니 머리 높이가 바뀔 때마다 어긋났고, 지금은 아예 머리
     * 바깥으로 나가 보이지 않았다. 칸이 머리만큼 높으면 bottom-0 이 곧
     * 머리의 아랫선이다.
     */
    <nav className="-mx-1 flex h-full min-w-0 items-stretch gap-1 overflow-x-auto px-1">
      {items.map((it) => {
        const active = it.href === '/' ? path === '/' : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`relative flex shrink-0 items-center px-2.5 text-[0.8125rem] font-bold transition-colors ${
              active ? 'text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {it.label}
            {active && (
              <span aria-hidden className="absolute inset-x-2.5 bottom-0 h-[2px] bg-brand" />
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
