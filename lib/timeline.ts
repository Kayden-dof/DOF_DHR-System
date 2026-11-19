/* ---------------------------------------------------------------------------
   공정 시간표 · 배치 일정 계산 (0137 · 사용자 2026-11-19)

   «DX2401 공정 타임라인» 아티팩트의 계산을 옮겼다. 시간표 편집 화면(설정 >
   제품표준서), 생산 > 일정, 일정표 인쇄가 이 하나를 쓴다.

   'use client' 가 아니다 - 서버 화면(인쇄)도 부른다. 클라이언트 모듈의 함수를
   서버가 부르면 운영에서 React 441 로 죽는다.

   ── 시각의 단위 ───────────────────────────────────────────────────────────
   시간표의 시각은 «1일차 0시부터 몇 분» 이다. 날짜가 아니라 순서와 간격만 말한다.
   배치 일정이 그것을 시작일 · 시각에 얹고, 손작업이 휴무일에 걸리면 다음
   근무일로 미룬다. 그 때문에 대기가 늘어 허용 상한을 넘으면 짚는다.

   시스템은 판정하지 않는다. 범위 밖 · 순서 · 근무시간 밖은 «확인할 곳» 이다.
--------------------------------------------------------------------------- */

export type StepKind = 'work' | 'wait' | 'prep' | 'ext';

export interface Step {
  id: string;
  /** 공정 차례 두 자리 ('01') */
  p: string;
  n: string;
  k: StepKind;
  /** 시작 (분, 1일차 0시 = 0) */
  s: number;
  /** 소요 (분) */
  d: number;
  mn: number | null;
  mx: number | null;
  /** 앞 작업 id */
  a: string[];
  m: string;
}

export interface WorkCalendar {
  /** 0 일 · 1 월 … 6 토 */
  workdays: number[];
  dayStart: number;
  dayEnd: number;
  lunch: boolean;
  /** 손작업이 휴무일에 걸리면 다음 근무일로 미룬다 */
  skipOff: boolean;
  /** YYYY-MM-DD */
  holidays: string[];
}

export const DEFAULT_CALENDAR: WorkCalendar = {
  workdays: [1, 2, 3, 4, 5], dayStart: 480, dayEnd: 1020, lunch: true, skipOff: true, holidays: [],
};

export const DAY = 1440;
export const LUNCH = [720, 780] as const;

export const KIND_LABEL: Record<StepKind, string> = {
  work: '작업', wait: '대기', prep: '병행 준비', ext: '외부',
};
export const KIND_NOTE: Record<StepKind, string> = {
  work: '사람 손', wait: '장비 · 침지 · 세척 진행', prep: '대기 중 시약 제조', ext: '멸균 위탁',
};
export const KINDS: StepKind[] = ['work', 'wait', 'prep', 'ext'];

/* 공정마다 한 색. 아티팩트의 색을 그대로 쓴다 - 사용자가 고른 색이다 */
const PROC_COLORS = ['#2f6fbd', '#0f8b8d', '#b8452e', '#7a4fb3', '#2e8b57', '#3d5a80', '#a0662a', '#c23b73', '#555b66'];
export const procColor = (p: string) => PROC_COLORS[(Math.max(1, Number(p) || 1) - 1) % PROC_COLORS.length];

export const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/* --- 글로 옮기기 --------------------------------------------------------- */

const pad2 = (n: number) => String(n).padStart(2, '0');
const inDay = (m: number) => ((m % DAY) + DAY) % DAY;
export const dayIndex = (m: number) => Math.floor(m / DAY);
/** "09:30" */
export const hhmm = (m: number) => `${pad2(Math.floor(inDay(m) / 60))}:${pad2(inDay(m) % 60)}`;
/** "2일차 09:30" */
export const at = (m: number) => `${dayIndex(m) + 1}일차 ${hhmm(m)}`;
/** "45분" · "18시간" · "2시간 10분" */
export const dur = (m: number) =>
  m >= 120 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`;
/** "09:30" → 570 */
export const toMin = (v: string) => {
  const [h, mm] = v.split(':').map(Number);
  return (h || 0) * 60 + (mm || 0);
};
/** 허용범위 글: "30분 ~ 1시간" · "18시간 이상" · '' */
export const rangeText = (x: Pick<Step, 'mn' | 'mx'>) =>
  x.mn == null && x.mx == null ? ''
    : `${x.mn != null ? dur(x.mn) : ''}${x.mx != null ? ` ~ ${dur(x.mx)}` : ' 이상'}`;
/** 한 날 안이면 "09:00~10:00", 넘으면 "09:00~2일차 10:00" */
export const span = (a: number, b: number) =>
  dayIndex(a) === dayIndex(b) ? `${hhmm(a)}~${hhmm(b)}` : `${hhmm(a)}~${dayIndex(b) + 1}일차 ${hhmm(b)}`;

export const endOf = (x: Step) => x.s + x.d;
export const isHands = (x: Step) => x.k === 'work' || x.k === 'prep';

/* --- 날짜 (UTC 로 세어 시간대에 흔들리지 않는다) ------------------------- */

const utc = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
};
export const addDays = (ymd: string, n: number) => {
  const t = new Date(utc(ymd) + n * 864e5);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
};
export const weekday = (ymd: string) => new Date(utc(ymd)).getUTCDay();
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 864e5);
/** "11/25 (수)" */
export const md = (ymd: string) => {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}/${d} (${DOW[weekday(ymd)]})`;
};
export const isOff = (ymd: string, cal: WorkCalendar) =>
  !cal.workdays.includes(weekday(ymd)) || cal.holidays.includes(ymd);

/* --- 점검 ---------------------------------------------------------------- */

export interface Issue { level: 'r' | 'a'; text: string }

/**
 * 한 작업의 확인할 곳.
 *   r  허용 최소보다 짧거나 최대보다 김
 *   a  앞 작업이 끝나기 전에 시작 · 근무시간 밖 손작업
 */
export function issues(steps: Step[], x: Step, cal: WorkCalendar): Issue[] {
  const out: Issue[] = [];
  if (x.mn != null && x.d < x.mn) out.push({ level: 'r', text: `최소 ${dur(x.mn)} 보다 짧음` });
  if (x.mx != null && x.d > x.mx) out.push({ level: 'r', text: `최대 ${dur(x.mx)} 보다 김` });
  for (const id of x.a) {
    const p = steps.find((y) => y.id === id);
    if (p && x.s < endOf(p)) out.push({ level: 'a', text: `앞 작업 «${p.n}» 끝(${at(endOf(p))}) 전에 시작` });
  }
  if (isHands(x)) {
    const r0 = inDay(x.s), r1 = r0 + x.d;
    if (r0 < cal.dayStart || r1 > cal.dayEnd) out.push({ level: 'a', text: '근무시간 밖 손작업' });
  }
  return out;
}

/** 앞 작업이 끝나야 시작하도록 뒤 작업을 민다. 당기지는 않는다 */
export function pushAfter(steps: Step[]): Step[] {
  const T = steps.map((x) => ({ ...x }));
  const byId = new Map(T.map((x) => [x.id, x]));
  for (let guard = 0, changed = true; changed && guard < 200; guard++) {
    changed = false;
    for (const x of T) {
      if (!x.a.length) continue;
      let need = x.s;
      for (const id of x.a) { const p = byId.get(id); if (p) need = Math.max(need, endOf(p)); }
      if (need > x.s) { x.s = need; changed = true; }
    }
  }
  return T;
}

export interface Summary {
  /** 첫 작업부터 멸균 발송(외부 앞 마지막 작업)까지 */
  elapsed: number;
  sendDay: number;
  hands: number;
  bad: number;
  late: number;
}

export function summary(steps: Step[], cal: WorkCalendar): Summary {
  if (!steps.length) return { elapsed: 0, sendDay: 0, hands: 0, bad: 0, late: 0 };
  const s0 = Math.min(...steps.map((x) => x.s));
  const ext = steps.filter((x) => x.k === 'ext').map((x) => x.s);
  const cut = ext.length ? Math.min(...ext) : Infinity;
  const core = steps.filter((x) => x.k !== 'ext' && x.s < cut);
  const e0 = core.length ? Math.max(...core.map(endOf)) : s0;
  const all = steps.flatMap((x) => issues(steps, x, cal));
  const bad = all.filter((i) => i.level === 'r').length;
  return {
    elapsed: e0 - s0,
    sendDay: Math.ceil(e0 / DAY),
    hands: core.filter((x) => x.k !== 'wait').reduce((a, x) => a + x.d, 0),
    bad, late: all.length - bad,
  };
}

/* --- 배치 일정 ------------------------------------------------------------ */

export interface PlanRow {
  x: Step;
  /** 시작일 0시부터의 분 */
  s: number;
  e: number;
  /** 실제로 걸리는 시간 - 대기는 휴무로 늘어난 만큼 길다 */
  eff: number;
  flags: Issue[];
  /** 그 작업이 시작하는 날 (YYYY-MM-DD) */
  date: string;
}

export interface Plan {
  rows: PlanRow[];
  /** 마지막 작업이 끝나는 분 */
  last: number;
  /** 멸균 발송(외부로 넘기는 작업)이 끝나는 분 */
  sendEnd: number;
}

/**
 * 시간표를 시작일 · 시각에 얹는다.
 *
 * 첫 작업이 시작 시각에 오고 나머지는 같은 간격으로 따른다. 손작업이 있는 날이
 * 휴무일이면 그날부터 뒤를 다음 근무일까지 통째로 민다(skipOff). 민 만큼 앞 대기가
 * 늘어나므로 대기의 허용 상한을 다시 본다.
 */
export function planBatch(steps: Step[], startOn: string, startMin: number, cal: WorkCalendar): Plan | null {
  if (!startOn || !steps.length) return null;
  const f = Math.min(...steps.map((x) => x.s));
  const fDay = dayIndex(f);
  const shift = startMin - (f - fDay * DAY);
  const base = new Map(steps.map((x) => [x.id, x.s - fDay * DAY + shift]));
  const handDays = new Set(steps.filter(isHands).map((x) => dayIndex(base.get(x.id)!)));
  const maxD = Math.max(...steps.map((x) => dayIndex(base.get(x.id)! + x.d))) + 1;
  const sh: number[] = [];
  let acc = 0;
  for (let d = 0; d <= maxD; d++) {
    if (cal.skipOff && handDays.has(d)) {
      for (let n = 0; isOff(addDays(startOn, d + acc), cal) && n < 30; n++) acc++;
    }
    sh[d] = acc;
  }
  const st = new Map(steps.map((x) => {
    const b = base.get(x.id)!;
    return [x.id, b + (sh[Math.max(0, dayIndex(b))] ?? acc) * DAY];
  }));
  const rows: PlanRow[] = steps.map((x) => {
    const s0 = st.get(x.id)!;
    const succ = steps.filter((y) => y.a.includes(x.id))
      .map((y) => (st.get(y.id)! - s0) - (base.get(y.id)! - base.get(x.id)!));
    const eff = x.k === 'wait' && succ.length ? x.d + Math.max(0, Math.min(...succ)) : x.d;
    const flags: Issue[] = [];
    if (x.mx != null && eff > x.mx) {
      flags.push({ level: 'r', text: `${eff > x.d ? '휴무로 대기가 늘어 ' : ''}최대 ${dur(x.mx)} 초과 (${dur(eff)})` });
    }
    if (x.mn != null && eff < x.mn) flags.push({ level: 'r', text: `최소 ${dur(x.mn)} 미달` });
    const date = addDays(startOn, dayIndex(s0));
    if (isHands(x) && isOff(date, cal)) flags.push({ level: 'a', text: '휴무일 손작업' });
    return { x, s: s0, e: s0 + eff, eff, flags, date };
  }).sort((a, b) => a.s - b.s || a.x.id.localeCompare(b.x.id));
  const extIds = new Set(steps.filter((x) => x.k === 'ext').map((x) => x.id));
  const before = rows.filter((r) => r.x.k !== 'ext' && !r.x.a.some((id) => extIds.has(id)));
  return {
    rows,
    last: Math.max(...rows.map((r) => r.e)),
    sendEnd: before.length ? Math.max(...before.map((r) => (r.x.k === 'wait' ? r.s : r.e))) : 0,
  };
}

/** 그날 (0부터) 손작업이 있는 날 */
export const workDays = (plan: Plan) =>
  [...new Set(plan.rows.filter((r) => isHands(r.x)).map((r) => dayIndex(r.s)))].sort((a, b) => a - b);

/** 그날 이어서 진행 중인 대기 · 외부 */
export const carried = (plan: Plan, k: number) =>
  plan.rows.filter((r) => (r.x.k === 'wait' || r.x.k === 'ext') && dayIndex(r.s) < k && dayIndex(r.e - 1) >= k);

/* --- 저장 전 모양 확인 (DB 의 timeline_steps_ok 와 같은 규칙 + 공정 차례) ---- */

export function cleanSteps(raw: unknown, opSeqs: string[]): { steps: Step[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: '시간표 모양이 아닙니다' };
  const ids = new Set<string>();
  const steps: Step[] = [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  for (const r of raw as Record<string, unknown>[]) {
    const id = String(r?.id ?? '').trim();
    const n = String(r?.n ?? '').trim();
    const p = String(r?.p ?? '');
    const k = r?.k as StepKind;
    const s = num(r?.s), d = num(r?.d), mn = num(r?.mn), mx = num(r?.mx);
    if (!id || ids.has(id)) return { error: '작업 이름표가 비었거나 겹칩니다' };
    if (!n) return { error: '이름이 빈 작업이 있습니다' };
    if (!opSeqs.includes(p)) return { error: `«${n}» 의 공정 ${p} 이 이 제품표준서에 없습니다` };
    if (!KINDS.includes(k)) return { error: `«${n}» 의 구분이 틀립니다` };
    if (s == null || s < 0 || !Number.isInteger(s)) return { error: `«${n}» 의 시작이 틀립니다` };
    if (d == null || d < 1 || !Number.isInteger(d)) return { error: `«${n}» 의 소요는 1분 이상이어야 합니다` };
    if ((mn != null && mn < 0) || (mx != null && mx < 0)) return { error: `«${n}» 의 허용범위가 틀립니다` };
    if (mn != null && mx != null && mn > mx) return { error: `«${n}» 의 허용 최소가 최대보다 큽니다` };
    ids.add(id);
    steps.push({
      id, p, n, k, s, d, mn, mx,
      a: Array.isArray(r?.a) ? (r.a as unknown[]).map(String) : [],
      m: String(r?.m ?? ''),
    });
  }
  for (const x of steps) {
    x.a = [...new Set(x.a)].filter((id) => id !== x.id);
    if (x.a.some((id) => !ids.has(id))) return { error: `«${x.n}» 의 앞 작업이 시간표에 없습니다` };
  }
  return { steps };
}
