import Link from 'next/link';
import StatDetail from './stat-detail';
import { responsiveColumns } from '@/lib/design/q-design-responsive';

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
  title, lede, action, nav, stats, children,
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
      {/*
        * 하위 차림표가 제목 위에 온다.
        *
        * 아래에 두면 그 자리가 제목과 설명의 높이에 딸려 다닌다. 설명이 한
        * 줄인 화면과 두 줄인 화면을 오갈 때 차림표가 위아래로 뛰었다 - 같은
        * 구역 안을 오가는데 방금 누른 것이 움직인다 (사용자 지적 2026-09-01).
        */}
      {nav}

      {/*
        * 화면 머리는 정본 `.qd-page-head` 다 (Q-Design 7장 «화면 뼈대»).
        * 금색 막대 · 제목 · 아래 괘선이 모든 화면 맨 위에 같은 모양으로 선다.
        * 제목 크기 · 굵기 · 막대 · 괘선은 정본이 준다 - 여기서 다시 적지 않는다.
        *
        * 제목 위에 구역 이름(눈썹)을 적지 않는다. 차림표가 이미 어느 구역인지
        * 밝히고, 하위 차림표가 어느 화면인지 밝힌다. 같은 말이 세 번이 된다.
        */}
      <header className="qd-page-head">
        <div className="qd-page-head-row">
          <div className="qd-page-head-text">
            <h1 className="qd-page-head-title">{title}</h1>
            {/*
              * 설명은 늘 두 줄 자리를 차지한다. 한 줄짜리 화면과 두 줄짜리
              * 화면을 오갈 때 아래가 통째로 뛰던 것을 막는다. 높이는 글자 크기와
              * 줄 간격에서 그대로 셈한다.
              */}
            {lede && (
              <p className="mt-2 max-w-2xl min-h-[calc(2*1.6*0.875rem)] text-sm leading-relaxed text-muted">
                {lede}
              </p>
            )}
          </div>
          {/*
            * 주 동작 자리에 펼쳐지는 입력 폼이 오면 그 줄을 통째로 내준다. 단추일
            * 때는 제목 오른쪽에 붙는다.
            */}
          {action && (
            <div className="qd-page-head-actions has-[form]:block has-[form]:w-full">
              {action}
            </div>
          )}
        </div>
      </header>

      {stats}

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

/*
 * 칸은 정본 `.qd-kpi` 다. 라벨이 위, 숫자가 아래. 숫자 크기는 칸 폭을 따라 정본
 * 사다리(40 · 32 · 28 · 24)에서 고른다 - 긴 금액(3,890,000원)도 잘리지 않고
 * 한 단계씩 줄어든다. 여기서 크기를 셈하지 않는다.
 *
 * 0 은 눌러 둔다 (`.qd-kpi--zero`). 0 을 강조하면 아무 일도 없는 것이 일처럼
 * 보인다. 눈에 띄어야 하는 값은 숫자의 색이 말한다 (data-tone).
 */
export function StatStrip({ items }: { items: StatItem[] }) {
  if (items.length === 0) return null;
  /*
   * 줄을 고르게 나눈다 (디자인 점검 2026-11-06). auto-fit 만 두면 일곱 개짜리 띠가
   * 6 + 1 로 끊겨 마지막 하나가 혼자 남는다. 한 줄에 여섯을 넘기지 않는 범위에서
   * 줄 수를 먼저 정하고 고르게 나눈다 (7 → 4 + 3 · 8 → 4 + 4). 칸 수는 상한일 뿐이라
   * 좁은 화면에서는 정본 최소 폭이 이겨 접힌다 (정본 responsiveColumns).
   */
  const cols = Math.ceil(items.length / Math.ceil(items.length / 6));
  return (
    <dl className="qd-grid-kpi"
        style={{ gridTemplateColumns: responsiveColumns(cols, 'var(--qd-kpi-min-width)', 14) }}>
      {items.map((s) => {
        const zero = s.value === 0 || s.value === '0';
        const body = (
          <>
            <dt className="qd-kpi-label" data-hangul="">{s.label}</dt>
            <dd className="qd-kpi-value">
              {s.value}
              {s.unit && <span className="qd-kpi-unit">{s.unit}</span>}
            </dd>
          </>
        );
        const cls = `qd-kpi${zero ? ' qd-kpi--zero' : ''}`;
        const tone = zero ? undefined : s.tone;
        const tip = s.detail
          ? <StatDetail title={s.label}>{s.detail}</StatDetail>
          : null;

        return s.href ? (
          <Link key={s.label} href={s.href} className={`${cls} qd-kpi--link`} data-tone={tone}>
            {body}{tip}
          </Link>
        ) : (
          <div key={s.label} className={`${cls}${s.detail ? ' qd-kpi--link' : ''}`} data-tone={tone}>
            {body}{tip}
          </div>
        );
      })}
    </dl>
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
    <div className="flex flex-wrap items-end justify-between gap-3">
      {/* 갈래는 정본 2차 탭(.qd-tabs · 금색 밑줄)이다 - 하위 차림표와 같은 모양 */}
      <nav className="qd-tabs !mb-0" aria-label="갈래">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            aria-current={it.on ? 'page' : undefined}
            className={`qd-tab${it.on ? ' qd-tab--active' : ''}`}
          >
            {it.label}
            {/*
              * 0 건인 갈래는 세어 봐야 갈 곳이 없다. 숫자를 한 단계 눌러 눈이
              * 값이 있는 갈래에 먼저 닿게 한다. StatStrip 이 0 을 눌러 두는 것과
              * 같은 규칙이다.
              */}
            {it.count !== undefined && (
              <span className={`ml-1.5 tnum ${
                it.on ? 'text-brand'
                  : it.count === 0 ? 'font-normal text-muted' : 'text-ink'
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
