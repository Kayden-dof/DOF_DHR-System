import type { FormState } from '@/lib/forms';

/* 서버 액션 결과 표시. 성공도 실패도 같은 자리에 나온다. */
export function Msg({ state, className = '' }: { state: FormState; className?: string }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className={`mt-2 rounded-md border border-danger/25 bg-danger-bg px-3 py-2 text-sm leading-relaxed text-danger ${className}`}
      >
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p
        className={`mt-2 rounded-md border border-ok/25 bg-ok-bg px-3 py-2 text-sm leading-relaxed text-ink ${className}`}
      >
        <span className="chip mr-2 bg-ok text-white">완료</span>
        {state.message}
      </p>
    );
  }
  return null;
}

export function PageHead({
  title, note, action,
}: { title: string; note?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-bold text-ink">{title}</h2>
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
          <div>
            {title && <h3 className="text-sm font-bold text-ink">{title}</h3>}
            {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
          </div>
          {action && <div className="ml-auto">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-faint">{children}</p>;
}

export function Field({
  label, children, wide = false,
}: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  );
}

const TONE: Record<string, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  brand: 'bg-brand-soft text-brand',
  quiet: 'bg-canvas text-muted',
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
    <div className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2.5">
      <p className="text-xs font-bold text-warn">확인하고 진행하십시오</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((w, i) => (
          <li key={i} className="text-sm leading-relaxed text-ink">
            <span className="chip mr-2 bg-warn text-white">{w.kind}</span>
            {w.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* 되돌릴 수 없는 조작 앞에 두는 안내. */
export function Caution({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-line-strong bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
      {children}
    </p>
  );
}
