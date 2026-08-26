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

/** 화면 맨 위. 제목과 그 화면이 무엇을 하는 곳인지 한 줄. */
export function PageTitle({
  title, note, action, crumb,
}: { title: string; note?: React.ReactNode; action?: React.ReactNode; crumb?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumb && <p className="crumb mb-1.5">{crumb}</p>}
        <h1 className="text-[1.375rem] font-bold text-ink">{title}</h1>
        {note && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">{note}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** 한 화면 안의 구역 머리. 페이지 제목보다 한 단계 아래. */
export function PageHead({
  title, note, action,
}: { title: string; note?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-[0.9375rem] font-bold text-ink">{title}</h2>
        {note && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{note}</p>}
      </div>
      {action}
    </div>
  );
}

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
            {title && <h3 className="text-[0.875rem] font-bold tracking-tight text-ink">{title}</h3>}
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
    <div className="px-4 py-10 text-center">
      <p className="text-sm text-faint">{children}</p>
      {hint && <p className="mt-1.5 text-xs text-faint/80">{hint}</p>}
    </div>
  );
}

export function Field({
  label, children, wide = false,
}: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <div className="text-[0.6875rem] font-bold tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-sm text-ink">{children}</div>
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
  brand: 'bg-brand-tint text-brand',
  solid: 'bg-brand text-white',
  quiet: 'bg-canvas-deep text-muted',
  faint: 'bg-canvas text-faint',
};

export function Tag({
  tone = 'quiet', children,
}: { tone?: keyof typeof TONE | string; children: React.ReactNode }) {
  return <span className={`chip ${TONE[tone] ?? TONE.quiet}`}>{children}</span>;
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
