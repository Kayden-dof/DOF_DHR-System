'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem { href: string; label: string }

/*
 * 맨 위 차림표는 레일이다 (./rail.tsx · Q-Design 차림표 정본 · 오너 결정 2026-11-07 «A»).
 * 여기는 구역 안의 하위 차림표만 둔다.
 */

/** 설정 · 자재처럼 하위 화면이 여럿인 구역의 두 번째 줄. */
export function SubNav({ items }: { items: NavItem[] }) {
  const path = usePathname();

  /*
   * 켜지는 항목은 하나다.
   *
   * 접두사 일치로 각자 판정하면 구역 첫 화면(/shipping)이 모든 하위 경로의
   * 접두사라 /shipping/ship 에서 "출하 승인"과 "출고"가 같이 켜졌다. 지금
   * 어디인지 말해야 할 표시가 두 군데를 가리키면 아무것도 말하지 않는 것이다.
   * 가장 깊게 일치하는 항목 하나만 켠다.
   */
  const current = items.reduce<string | null>((best, it) => {
    const hit = path === it.href || path.startsWith(it.href + '/');
    return hit && it.href.length > (best?.length ?? 0) ? it.href : best;
  }, null);

  /* 모양은 거르개 줄(components/shell.tsx FilterBar)과 같은 정본 2차 탭이다 */
  return (
    <nav className="qd-tabs !mb-0" aria-label="하위 차림표">
      {items.map((it) => {
        const active = it.href === current;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`qd-tab${active ? ' qd-tab--active' : ''}`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
