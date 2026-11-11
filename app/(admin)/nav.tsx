'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string; label: string;
  /*
   * 묶음 이름 (UI/UX 검수 2026-11-11). 설정 탭이 열셋이라 한 줄로 늘어놓으면 어디가
   * 무엇인지 읽히지 않았다. 묶음이 있는 차림표만 묶음마다 작은 이름을 위에 얹는다.
   * 없으면 지금까지와 같은 한 줄이다.
   */
  group?: string;
}

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

  const tab = (it: NavItem) => {
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
  };

  /* 모양은 거르개 줄(components/shell.tsx FilterBar)과 같은 정본 2차 탭이다 */
  if (!items.some((it) => it.group)) {
    return (
      <nav className="qd-tabs !mb-0" aria-label="하위 차림표">
        {items.map(tab)}
      </nav>
    );
  }

  /*
   * 묶어 낸다 (UI/UX 검수 2026-11-11 «설정 탭 13개 한 줄»). 탭 모양 · 밑줄은 그대로
   * 두고 묶음 이름만 위에 작게 얹는다 - 한 번에 가는 길은 그대로 하나다. 묶음 칸은
   * 아래로 붙여(justify-end) 이름이 없는 «개요» 도 밑줄 높이가 같다.
   */
  const groups: { name: string; items: NavItem[] }[] = [];
  for (const it of items) {
    const name = it.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(it);
    else groups.push({ name, items: [it] });
  }
  return (
    <nav className="qd-tabs !mb-0 gap-x-3" aria-label="하위 차림표">
      {groups.map((g, i) => (
        <div key={`${g.name}-${i}`} role="group" aria-label={g.name || undefined}
             className="flex flex-col justify-end">
          {g.name && <span className="px-4 pt-1 text-xs text-faint">{g.name}</span>}
          <div className="flex">{g.items.map(tab)}</div>
        </div>
      ))}
    </nav>
  );
}
