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
        {/*
          * 하위 차림표가 제목 위에 온다.
          *
          * 아래에 두면 그 자리가 제목과 설명의 높이에 딸려 다닌다. 설명이 한
          * 줄인 화면과 두 줄인 화면을 오갈 때 차림표가 위아래로 뛰었다 - 같은
          * 구역 안을 오가는데 방금 누른 것이 움직인다 (사용자 지적 2026-09-01).
          *
          * 위로 올리면 그 자리는 머리줄 바로 아래로 고정된다. 무엇을 누르든
          * 차림표는 같은 곳에 있고, 화면마다 달라지는 것은 그 아래뿐이다.
          */}
        {nav}

        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          {/*
            * 제목 칸에 max-w 를 주면 설명이 길 때 칸이 그 너비까지 벌어져 주
            * 동작이 아래 줄로 밀린다. 밀린 단추는 왼쪽에 붙어서 설명문에 딸린
            * 것처럼 보였다. 칸은 남는 만큼 줄어들게 두고, 글줄 길이는 설명문
            * 자체에서 잡는다.
            */}
          <div className="min-w-0 flex-1">
            {/*
              * 제목 위에 구역 이름을 적지 않는다.
              *
              * 머리줄이 이미 어느 구역인지 밝히고, 하위 차림표가 있으면 그것이
              * 어느 화면인지 밝힌다. 그 아래 다시 "설정" 을 적으면 같은 말이 세
              * 번이고, 제목 앞에 줄이 하나 더 생겨 화면이 무거워진다.
              *
              * section 은 남겨 둔다 - 화면이 어느 구역에 속하는지는 여전히
              * 사실이고, 나중에 다른 자리에서 쓸 수 있다.
              */}
            {/*
              * 제목을 키운다 (사용자 지시 2026-09-11 "디자인이 너무 심심하다").
              *
              * 22px 는 본문 15px 과 차이가 크지 않아, 화면을 열었을 때 눈이
              * 먼저 붙는 자리가 없었다. 카드도 표도 다 같은 무게로 보이는
              * 까닭의 절반이 여기였다.
              *
              * 색이나 장식이 아니라 크기와 자간으로 올린다 - 이 화면은 기록을
              * 읽는 자리이고, 무게를 색으로 주면 색이 뜻을 잃는다 (경고가
              * 주황인 것과 같은 까닭). 자간을 조금 좁히면 큰 글자가 흩어지지
              * 않는다.
              */}
            <h1 className="text-[1.75rem] font-bold leading-[1.15] tracking-[-0.015em] text-ink">
              {title}
            </h1>
            {/*
              * 설명은 늘 두 줄 자리를 차지한다. 한 줄짜리 화면과 두 줄짜리
              * 화면을 오갈 때 아래가 통째로 뛰던 것을 막는다.
              *
              * 높이는 글자 크기와 줄 간격에서 그대로 셈한다 - 어림수를 박아
              * 두면 글자 크기를 고칠 때 어긋난다.
              */}
            {lede && (
              <p className="mt-2 max-w-2xl min-h-[calc(2*1.625*0.9375rem)] text-[0.9375rem]
                            leading-relaxed text-muted">{lede}</p>
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
      </header>

      {/*
        * 머리와 본문을 가르는 얇은 선 (사용자 지적 2026-09-11 "덩그러니").
        *
        * 화면마다 제목과 설명이 캔버스 위에 그냥 떠 있고 그 아래로 카드가
        * 바로 이어졌다. 틀이 없으니 머리가 첫 카드에 딸린 글처럼 보이고,
        * 화면 전체가 "놓여 있다" 가 아니라 "흩어져 있다" 로 읽힌다.
        *
        * 선 하나면 머리가 머리로 선다. 숫자 띠가 있는 화면은 그 띠가 이미
        * 가르므로 긋지 않는다 - 가로줄이 둘이면 어느 쪽이 시작인지 흐려진다
        * (표 머리에 띠를 깔지 않는 것과 같은 까닭).
        */}
      {!stats && <div className="border-t border-line-soft" />}

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
              {/*
                * 숫자를 키우고 자간을 좁힌다. 단위는 한 칸 더 물린다 -
                * 읽는 것은 숫자이고 단위는 그 숫자가 무엇인지 알려 줄 뿐이다.
                * 둘이 같은 무게면 눈이 어디를 먼저 볼지 정하지 못한다.
                */}
              <span className={`text-[1.75rem] font-bold leading-none tracking-[-0.02em] tnum ${
                zero ? 'text-faint' : s.tone ? TEXT[s.tone] : 'text-ink'
              }`}>
                {s.value}
              </span>
              {s.unit && <span className="text-[0.6875rem] text-faint">{s.unit}</span>}
            </dd>
          </>
        );

        const cls = 'relative border-l border-t border-line bg-surface px-4 py-4 transition-colors';
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
      {/* 모양은 globals.css 의 .segment 하나에서 나온다 - 하위 차림표와 같은 것이다 */}
      <nav className="segment">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            aria-current={it.on ? 'page' : undefined}
            data-on={it.on}
            className="segment-item"
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
