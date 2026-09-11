import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   공용 조각

   화면마다 카드와 표를 다시 만들면 여백과 글자 크기가 조금씩 어긋난다.
   여기 있는 것만 쓰고, 여기서 안 되면 여기를 고친다.

   판정성 문구를 쓰지 않는다 (§10). "적합", "이상 없음" 같은 말은 이 시스템이
   할 수 있는 말이 아니다. 상태와 수치만 보여 준다.
--------------------------------------------------------------------------- */

/* 서버 액션 결과 표시. 성공도 실패도 같은 자리에 나온다. */
export function Msg({ state, className = '' }: { state: FormState; className?: string }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className={`rise mt-2.5 flex items-start gap-2 rounded-md border border-danger-line bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger ${className}`}
      >
        <span aria-hidden className="mt-px shrink-0 font-bold">!</span>
        <span>{state.error}</span>
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p
        className={`rise mt-2.5 flex items-start gap-2 rounded-md border border-ok/20 bg-ok-bg px-3 py-2.5 text-sm leading-relaxed text-ink ${className}`}
      >
        <span aria-hidden className="mt-px shrink-0 font-bold text-ok">&#10003;</span>
        <span>{state.message}</span>
      </p>
    );
  }
  return null;
}

/*
 * 화면 머리는 PageShell 하나로 낸다 (components/shell.tsx).
 *
 * PageTitle · PageHead 를 여기 두었더니 구역 레이아웃이 하나를 내고 화면이 또
 * 하나를 내서 제목이 두 겹, 설명문이 두 개가 되었다. 화면마다 어느 쪽이 이
 * 화면의 이름인지 읽는 사람이 판단해야 했다. 낼 곳을 하나로 줄인다.
 */

export function Panel({
  title, note, action, children, className = '',
}: {
  title?: string; note?: React.ReactNode; action?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      {(title || action) && (
        <header className="section-head">
          <div className="min-w-0">
            {/* 카드 제목도 한 칸 올린다. 본문과 같은 크기면 머리인지 줄인지 갈리지 않는다 */}
            {title && <h3 className="text-[0.9375rem] font-bold tracking-[-0.01em] text-ink">{title}</h3>}
            {note && <p className="mt-0.5 text-xs leading-relaxed text-muted">{note}</p>}
          </div>
          {action && <div className="ml-auto shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** 표를 감싸 가로 넘침만 처리한다. 표가 화면 밖으로 나가 잘리는 것을 막는다. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Empty({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    /*
     * 빈 상태의 글자를 한 단계씩 올렸다 (2026-09-08).
     *
     * 전에는 본문이 faint 이고 안내가 `faint/80` 이었다. **무엇을 해야 하는지
     * 알려 주는 줄이 화면에서 제일 안 읽히는 글자**였다 - 흰 바탕에서 3.23,
     * 캔버스에서 2.95 로 AA 근처에도 못 갔다.
     *
     * 본문을 muted, 안내를 faint 로 올린다. 안내가 본문보다 조용한 차례는
     * 그대로이고 둘 다 읽힌다 (5.17 · 4.74).
     *
     * ── hint 를 비워 두지 않는다 (2026-09-08) ──────────────────────────
     * 39곳 중 6곳에만 안내가 붙어 있었다. 나머지는 "없습니다" 로 끝났고,
     * **빈 DB 로 시작하는 제조소가 첫날 보는 화면이 그것들이다.** 어디로
     * 가면 채워지는지를 화면이 말하지 않으면 §2.0 이 종이 위에만 남는다.
     *
     * 안내에 적는 것은 **그 칸이 어디서 채워지는가**다. 판정을 적지 않는다 -
     * "이상 없음" · "정상" 은 §8.5 가 금지한다. 비어 있다는 사실만 말하고
     * 다음 걸음을 가리킨다.
     *
     * 거르개가 있는 화면은 두 경우를 갈라 적는다. 거른 결과가 빈 것과 아직
     * 아무것도 없는 것에 같은 문장을 내면, 걸러 놓은 줄 모르고 등록하러 간다.
     */
    <div className="empty-well">
      {/*
        * 본문을 한 칸 키운다 (2026-09-11). 빈 화면에서 유일하게 읽을 것이
        * 이 줄인데 본문보다 작았다.
        */}
      <p className="text-[0.9375rem] font-semibold text-muted">{children}</p>
      {hint && (
        <p className="mx-auto mt-2 max-w-md text-[0.8125rem] leading-relaxed text-faint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Field({
  label, children, wide = false,
}: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    /*
      * 이름과 값의 차례를 벌린다 (2026-09-11).
      *
      * 배치 화면은 이 칸이 스무 개 넘게 늘어선다. 이름과 값이 같은 무게로
      * 붙어 있으면 스무 쌍이 한 덩어리로 보여, 찾는 값 하나를 눈으로 훑게
      * 된다. 이름은 조용히 눕히고 값을 세운다 - 읽는 것은 값이다.
      *
      * ── 차례를 색으로 내지 않는다 ────────────────────────────────────
      * 이름을 faint 로 내려 봤다가 되돌렸다. faint(#767085)는 흰 카드에서
      * 4.74 로 AA 를 넘지만 **캔버스에서 4.18 로 미달**이고, 이 칸은 두 면
      * 모두에 놓인다. 게다가 10px 짜리 글자다.
      *
      * 이름은 장식이 아니라 정보다 - "지시서번호" 를 못 읽으면 그 아래 값이
      * 무엇인지 모른다. 색은 muted 그대로 두고 크기와 자간으로만 눕힌다.
      */
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <div className="text-[0.625rem] font-bold uppercase tracking-[0.08em] text-muted">
        {label}
      </div>
      <div className="mt-1 text-[0.9375rem] font-medium leading-snug text-ink">{children}</div>
    </div>
  );
}

/** 숫자 하나를 크게 보여 주는 칸. 현황과 요약 줄에 쓴다. */
export function Stat({
  label, value, unit, tone = 'ink', href,
}: {
  label: string; value: React.ReactNode; unit?: string;
  tone?: 'ink' | 'brand' | 'warn' | 'danger' | 'info'; href?: string;
}) {
  const color = {
    ink: 'text-ink', brand: 'text-brand', warn: 'text-warn',
    danger: 'text-danger', info: 'text-info',
  }[tone];

  const body = (
    <>
      <div className="text-[0.6875rem] font-bold tracking-wide text-muted">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`text-[1.75rem] font-bold leading-none tnum ${color}`}>{value}</span>
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </div>
    </>
  );

  if (!href) return <div className="card p-4">{body}</div>;
  return (
    <a href={href} className="card-raised block p-4">
      {body}
    </a>
  );
}

const TONE: Record<string, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  /*
   * 글자는 brand 가 아니라 brand-deep 이다. 바탕이 회사 색을 91% 밝힌 값이라,
   * 회사 색 자체가 밝으면(노랑·연두) 같은 색 글자가 묻힌다. 어느 색을 넣어도
   * 읽히게 하려면 글자 쪽을 어둡게 잡아야 한다 (§2.0 - 색은 설정에서 온다).
   */
  brand: 'bg-brand-tint text-brand-deep',
  solid: 'bg-brand text-white',
  quiet: 'bg-canvas-deep text-muted',
  faint: 'bg-canvas text-faint',
};

const DOT: Record<string, string> = {
  ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger',
  info: 'bg-info', brand: 'bg-brand',
};

/**
 * 상태 조각.
 *
 * 색만으로 상태를 말하면 색을 구별하지 못하는 사람에게는 아무 표시도 없는 것과
 * 같다. 뜻이 있는 상태에는 점을 하나 붙여 모양으로도 갈리게 한다.
 * 중립(quiet · faint)에는 붙이지 않는다 - 붙이면 모든 조각이 똑같아진다.
 */
export function Tag({
  tone = 'quiet', children,
}: { tone?: keyof typeof TONE | string; children: React.ReactNode }) {
  const dot = DOT[tone];
  return (
    <span className={`chip ${TONE[tone] ?? TONE.quiet}`}>
      {dot && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />}
      {children}
    </span>
  );
}

/* 경고 묶음. 차단이 아니라 표시다 (§2 "경고만"). */
export function Warnings({ items }: { items: { kind: string; detail: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-warn/25 bg-warn-bg px-3.5 py-3">
      <p className="text-[0.6875rem] font-bold tracking-wide text-warn">확인하고 진행하십시오</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((w, i) => (
          <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-ink">
            <span className="chip mt-px shrink-0 bg-warn text-white">{w.kind}</span>
            <span>{w.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* 되돌릴 수 없는 조작 앞에 두는 안내. */
export function Caution({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-line bg-surface-sub px-3 py-2.5 text-xs leading-relaxed text-muted">
      {children}
    </p>
  );
}

/* ---------------------------------------------------------------------------
   잘린 목록 알림

   목록에 상한을 두면 화면이 빨라지지만, 자른 사실을 적지 않으면 보는 사람은
   그것이 전부인 줄 안다. 조용한 잘림은 "다 봤다"로 읽힌다.

   상한에 닿았을 때만 나온다. 닿지 않았으면 아무것도 그리지 않는다.
--------------------------------------------------------------------------- */
export function Truncated({ shown, cap, hint }: {
  shown: number; cap: number; hint?: React.ReactNode;
}) {
  if (shown < cap) return null;
  return (
    <p className="card px-4 py-2.5 text-xs leading-relaxed text-muted">
      최근 <b className="tnum text-ink">{cap}</b>건만 보이고 있습니다.
      {hint ? <> {hint}</> : ' 찾는 것이 없으면 위에서 걸러 내거나 검색하십시오.'}
    </p>
  );
}
