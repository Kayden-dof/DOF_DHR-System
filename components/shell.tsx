import Link from 'next/link';
import StatDetail from './stat-detail';

/* ---------------------------------------------------------------------------
   화면 골격

   화면마다 제목 블록을 손으로 짜면 여백과 글자 크기가 조금씩 어긋나고, 무엇보다
   "이 화면에서 할 일이 무엇인가"가 화면마다 다른 자리에 놓인다.

   틀을 하나로 고정한다.

     구역 이름 · 제목 · 한 줄 설명 · 주 동작        머리
     숫자 몇 개                                     띠   (있을 때만)
     하위 메뉴                                      줄   (있을 때만)
     내용                                           본문

   주 동작은 화면당 하나다. 두 개가 나란히 있으면 둘 다 주 동작이 아니게 된다.
--------------------------------------------------------------------------- */

export function PageShell({
  section, title, lede, action, nav, stats, children,
}: {
  /** 구역 이름. 상단 메뉴와 같은 말을 쓴다 */
  section?: string;
  title: string;
  lede?: React.ReactNode;
  /** 이 화면에서 할 일. 하나만 둔다 */
  action?: React.ReactNode;
  /** 하위 메뉴 */
  nav?: React.ReactNode;
  /** 숫자 띠 */
  stats?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <header className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          {/*
            * 제목 칸에 max-w 를 주면 설명이 길 때 칸이 그 너비까지 벌어져 주
            * 동작이 아래 줄로 밀린다. 밀린 단추는 왼쪽에 붙어서 설명문에 딸린
            * 것처럼 보였다. 칸은 남는 만큼 줄어들게 두고, 글줄 길이는 설명문
            * 자체에서 잡는다.
            */}
          <div className="min-w-0 flex-1">
            {section && <p className="crumb">{section}</p>}
            <h1 className={`text-[1.625rem] font-bold leading-tight text-ink ${section ? 'mt-2' : ''}`}>
              {title}
            </h1>
            {lede && (
              <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">{lede}</p>
            )}
          </div>
          {/*
            * 주 동작 자리에 놓이는 것이 단추 하나일 때도 있고, 눌러서 그 자리에
            * 펼쳐지는 입력 폼일 때도 있다. 폼이 펼쳐지면 칸 하나에 눌려 절반
            * 폭으로 접혔다 - 입고 등록처럼 열 개 넘는 칸이 들어가는 폼이 화면
            * 왼쪽 절반에 끼어 있었다.
            *
            * 폼이 들어오면 그 줄을 통째로 내준다. 단추일 때는 지금처럼 제목
            * 오른쪽에 붙는다.
            */}
          {action && (
            <div className="flex shrink-0 items-center gap-2 pt-1 has-[form]:block has-[form]:w-full">
              {action}
            </div>
          )}
        </div>

        {stats}
        {nav}
      </header>

      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   숫자 띠

   화면 맨 위에서 "지금 상태"를 한 줄로 말한다. 눌러서 갈 곳이 있으면 링크가 된다.
   0은 흐리게 둔다. 0을 강조하면 아무 일도 없는 것이 일처럼 보인다.
--------------------------------------------------------------------------- */

export interface StatItem {
  label: string;
  value: number | string;
  unit?: string;
  href?: string;
  /** 눈에 띄어야 하는 값 */
  tone?: 'warn' | 'danger' | 'info' | 'brand';
  /*
   * 숫자 뒤의 내역. 가리키면 뜬다.
   *
   * 숫자만 세워 두면 "204개"가 무엇의 204개인지 알 수 없다. 그렇다고 띠에 다
   * 적으면 띠가 표가 된다. 평소에는 숫자만, 가리키면 내역 (사용자 지적).
   */
  detail?: React.ReactNode;
}

const EDGE: Record<string, string> = {
  warn: 'bg-warn', danger: 'bg-danger', info: 'bg-info', brand: 'bg-brand',
};
const TEXT: Record<string, string> = {
  warn: 'text-warn', danger: 'text-danger', info: 'text-info', brand: 'text-brand',
};

export function StatStrip({ items }: { items: StatItem[] }) {
  if (items.length === 0) return null;

  /*
   * 칸 사이를 gap-px 로 벌리고 바탕을 선 색으로 깔면, 항목이 줄바꿈될 때 남는
   * 자리가 회색 덩어리로 남는다. 여섯 개가 네 개씩 끊기면 오른쪽 두 칸이
   * 통째로 회색이 되어 무언가 깨진 것처럼 보였다.
   *
   * 바탕은 흰 면으로 두고 칸마다 왼쪽 · 위쪽 선을 그린다. 격자를 1px 씩 밖으로
   * 밀어 첫 줄과 첫 칸의 선이 바깥 테두리 위에 정확히 겹치게 한다. 남는 자리는
   * 그냥 흰 면이다.
   */
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
    <dl className="-m-px grid"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(9.5rem, 1fr))` }}>
      {items.map((s) => {
        const zero = s.value === 0 || s.value === '0';
        const body = (
          <>
            <dt className="text-[0.6875rem] font-bold tracking-wide text-muted">{s.label}</dt>
            <dd className="mt-1.5 flex items-baseline gap-1">
              <span className={`text-[1.5rem] font-bold leading-none tnum ${
                zero ? 'text-faint' : s.tone ? TEXT[s.tone] : 'text-ink'
              }`}>
                {s.value}
              </span>
              {s.unit && <span className="text-xs text-muted">{s.unit}</span>}
            </dd>
          </>
        );

        const cls = 'relative border-l border-t border-line bg-surface px-4 py-3.5 transition-colors';
        const edge = s.tone && !zero
          ? <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${EDGE[s.tone]}`} />
          : null;

        const tip = s.detail
          ? <StatDetail title={s.label}>{s.detail}</StatDetail>
          : null;

        return s.href ? (
          <Link key={s.label} href={s.href} className={`${cls} hover:bg-surface-sub`}>
            {edge}{body}{tip}
          </Link>
        ) : (
          <div key={s.label} className={`${cls} ${s.detail ? 'hover:bg-surface-sub' : ''}`}>
            {edge}{body}{tip}
          </div>
        );
      })}
    </dl>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   거르개 줄

   목록 위에 놓이는 조각들. 지금 무엇으로 걸러 보고 있는지가 한눈에 보여야 한다.
--------------------------------------------------------------------------- */

export function FilterBar({
  items, extra,
}: {
  items: { href: string; label: string; count?: number; on: boolean }[];
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface-sub p-1">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            aria-current={it.on ? 'page' : undefined}
            className={`rounded-[0.3125rem] px-3 py-1.5 text-xs font-bold transition-all ${
              it.on
                ? 'bg-surface text-brand shadow-[0_1px_2px_rgb(31_29_36/.06)]'
                : 'text-muted hover:text-ink'
            }`}
          >
            {it.label}
            {/*
              * 0 건인 갈래는 세어 봐야 갈 곳이 없다. 숫자를 한 단계 눌러 눈이
              * 값이 있는 갈래에 먼저 닿게 한다. StatStrip 이 0 을 눌러 두는 것과
              * 같은 규칙이다 - 화면마다 다르게 굴면 규칙이 아니다.
              */}
            {it.count !== undefined && (
              <span className={`ml-1.5 tnum ${
                it.on ? 'text-brand'
                  : it.count === 0 ? 'text-faint/55' : 'text-faint'
              }`}>
                {it.count}
              </span>
            )}
          </Link>
        ))}
      </nav>
      {extra}
    </div>
  );
}
