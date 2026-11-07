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
        data-tone="error"
        className={`qd-notice rise mt-2.5 ${className}`}
      >
        <span aria-hidden className="mt-px shrink-0 font-semibold">!</span>
        <span>{state.error}</span>
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p
        role="status"
        data-tone="success"
        className={`qd-notice rise mt-2.5 ${className}`}
      >
        <span aria-hidden className="mt-px shrink-0 font-semibold text-ok">&#10003;</span>
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

/*
 * 판의 이름은 판 «밖» 에 선다 (정본 `.qd-section-title` · Q-Carnet 과 같은 짜임).
 *
 * 이름 · 크기 · 앞의 모노 번호 · 아래 여백은 정본이 준다. 이 화면에만 있는 것은
 * 부제(note)와 머리 줄의 단추다. 머리 줄이 있으면 이름은 --flush 로 여백을 내려놓고
 * 그 여백은 머리 줄(.panel-head)이 대신 준다.
 *
 * 판의 면 · 선 · 모서리는 정본 `.qd-panel` 이 준다. `.card` 는 안의 표를 판 모서리에
 * 맞춰 자르고 현장 크기를 받는 이 시스템의 이름이라 함께 단다.
 */
export function Panel({
  title, titleAs: Title = 'h2', note, action, children, className = '',
}: {
  title?: string;
  /** 이름의 제목 수준. 화면 이름이 h1 이라 판은 h2 가 기본이다. 판 안의 작은 제목만 h3 */
  titleAs?: 'h2' | 'h3';
  note?: React.ReactNode; action?: React.ReactNode;
  children: React.ReactNode;
  /** 자리 잡기(격자 칸 · 높이)만. 가장 바깥에 붙는다 */
  className?: string;
}) {
  const frame = 'qd-panel card overflow-hidden';
  const row = Boolean(note || action);
  if (!title && !row) {
    return <section className={`${frame} ${className}`.trim()}>{children}</section>;
  }

  const name = title && (
    <Title className={`qd-section-title${row ? ' qd-section-title--flush' : ''}`}
           data-hangul={tagHangul(title)}>
      {title}
    </Title>
  );

  return (
    /* 격자 안에서 옆 판과 높이를 맞추도록 판이 남는 높이를 채운다 */
    <section className={`flex min-w-0 flex-col ${className}`.trim()}>
      {row ? (
        <header className="panel-head">
          <div className="min-w-0">
            {name}
            {note && <p className="mt-1.5 text-xs leading-relaxed text-muted">{note}</p>}
          </div>
          {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      ) : name}
      <div className={`${frame} grow`}>{children}</div>
    </section>
  );
}

/** 표를 감싸 가로 넘침만 처리한다. 표가 화면 밖으로 나가 잘리는 것을 막는다. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="qd-table-scroll">{children}</div>;
}

export function Empty({ children, hint, action }: {
  children: React.ReactNode; hint?: React.ReactNode;
  /** 채우러 가는 단추 (components/unblock.tsx). 안내 줄은 <p> 라 그 안에 두지 않는다 */
  action?: React.ReactNode;
}) {
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
     *
     * ── 짜임은 정본 `.qd-empty` 다 ─────────────────────────────────────────
     * 판 하나 · 가운데 · 조용한 제목 · 한 줄 설명. 크기 · 여백 · 색은 정본이 준다.
     * 판(Panel) 안에 놓이면 겉 판이 선 · 면을 이미 그리므로 빈 목록은 제 선을
     * 내려놓는다 (정본 q-design.list.css).
     */
    <div className="qd-empty qd-empty--compact">
      <p className="qd-empty-title">{children}</p>
      {hint && <p className="qd-empty-desc">{hint}</p>}
      {action && <div className="qd-empty-actions">{action}</div>}
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
    <div className={wide ? 'qd-field qd-field-wide' : 'qd-field'}>
      {/* 이름은 입력칸 이름표와 같은 정본 이름표다. 한글이면 자간을 푼다 */}
      <div className="qd-field-label" data-hangul={tagHangul(label)}>{label}</div>
      <div className="text-sm text-ink">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   진행 막대

   ── 왜 넣는가 (사용자 지적 2026-09-11) ────────────────────────────────────
   목록이 배치번호와 제품명과 상태만 적고 있었다. 그런데 목록을 열어 놓고 묻는
   것은 늘 하나다 - **이 배치가 어디쯤인가.** 그 답이 화면에 없어서, 알려면
   배치를 하나씩 열어 봐야 했다.

   숫자만 적어도 되지만(4/12) 숫자는 견줘야 뜻이 산다. 여섯 줄을 훑으며 4/12 와
   9/12 를 머릿속에서 견주는 것보다, 길이가 다른 막대 여섯 개를 보는 쪽이 빠르다.
   장식이 아니라 답이다.

   ── 판정하지 않는다 (§1) ──────────────────────────────────────────────────
   빠르다 · 늦다를 말하지 않는다. 끝난 공정 수를 전체로 나눈 값일 뿐이고,
   숫자를 나란히 적어 막대가 무엇을 줄인 것인지 늘 보이게 한다.
--------------------------------------------------------------------------- */
export function Progress({ done, total, width = 'var(--qd-carnet-progress-width)' }: {
  done: number; total: number; width?: string;
}) {
  if (total <= 0) return null;
  const pct = Math.max(0, Math.min(100, (done / total) * 100));
  return (
    <span className="inline-flex items-center gap-2">
      {/* 막대는 정본 `.qd-progress` 다. 채움은 강조색 한 가지 (업무 화면에 기울기를 두지 않는다) */}
      <span className="qd-progress shrink-0" role="progressbar" aria-label="공정 진행"
            aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.max(0, Math.min(total, done))}
            style={{ width }}>
        <span className="qd-progress-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="tnum text-xs text-muted">
        <b className={done === total ? 'text-brand' : 'text-ink'}>{done}</b>/{total}
      </span>
    </span>
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
      <div className="qd-kpi-label" data-hangul={tagHangul(label)}>{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`qd-kpi-value tnum ${color}`}>{value}</span>
        {unit && <span className="qd-kpi-unit">{unit}</span>}
      </div>
    </>
  );

  if (!href) return <div className="qd-kpi">{body}</div>;
  return (
    <a href={href} className="qd-kpi qd-kpi--link">
      {body}
    </a>
  );
}

/*
 * 배지는 정본 `.qd-tag` 다 (모노 · 헤어라인 테두리 · 모서리 6). 크기 · 글꼴 · 색은
 * 거기서 온다. 뜻(ok · warn …)은 이 시스템의 말이고 색 이름(green · copper …)은
 * 정본의 말이다. 둘을 잇는 곳이 여기 하나다. 색 값은 정본 기반 CSS 의
 * `--qa-state-*` 가 이 시스템의 상태색(팔레트)을 잇는다.
 */
const TONE: Record<string, string> = {
  ok: 'qd-tag--green',
  warn: 'qd-tag--copper',
  danger: 'qd-tag--red',
  info: 'qd-tag--cobalt',
  brand: 'qd-tag--gold',
  /* 한 단계 무거운 층. 정본의 primary 는 채움이 아니라 옅은 면 + 진한 테두리다 */
  solid: 'qd-tag--gold qd-tag--primary',
  quiet: 'qd-tag--gray',
  faint: 'qd-tag--tertiary',
};

/** 뜻이 있는 상태에만 점을 붙인다 */
const DOT = new Set(['ok', 'warn', 'danger', 'info', 'brand']);

/**
 * 정본 배지 · 이름표는 라틴 자간이 기본이라 한글이면 `data-hangul` 로 푼다.
 * 글이 아닌 것(숫자와 글이 섞인 조각 등)은 한글로 본다.
 */
export const tagHangul = (n: React.ReactNode) =>
  typeof n === 'string' && !/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(n) ? undefined : '';

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
  return (
    <span className={`qd-tag qd-tag--sm ${TONE[tone] ?? TONE.quiet}`}
          data-hangul={tagHangul(children)}>
      {DOT.has(tone) && <span aria-hidden className="qd-tag-dot" />}
      {children}
    </span>
  );
}

/* 경고 묶음. 차단이 아니라 표시다 (§2 "경고만"). */
export function Warnings({ items }: { items: { kind: string; detail: string }[] }) {
  if (items.length === 0) return null;
  return (
    /* 정본 안내 상자(.qd-notice)의 경고 결. 옆 띠는 쓰지 않는다 (Q-Design · 옆 띠 금지) */
    <div className="qd-notice block" data-tone="warning" role="note">
      <p className="text-xs font-semibold text-warn">확인하고 진행하십시오</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((w, i) => (
          <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-ink">
            <span className="qd-tag qd-tag--sm qd-tag--copper qd-tag--primary mt-px shrink-0"
                  data-hangul={tagHangul(w.kind)}>{w.kind}</span>
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
    /*
      * 되돌릴 수 없는 조작 앞에 두는 안내. 색은 쓰지 않는다 - 경고가 아니라
      * **안내**이고, 색을 쓰면 진짜 경고와 무게가 같아진다. 정본 안내 상자의 중립 결.
      */
    <p className="qd-notice" data-tone="neutral" role="note">
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
    <p className="qd-panel card px-4 py-2.5 text-xs leading-relaxed text-muted">
      최근 <b className="tnum text-ink">{cap}</b>건만 보이고 있습니다.
      {hint ? <> {hint}</> : ' 찾는 것이 없으면 위에서 걸러 내거나 검색하십시오.'}
    </p>
  );
}
