/* ---------------------------------------------------------------------------
   주문에서 생산 계획 - 배치 나누기 · 날짜 놓기 (순수 함수)

   DB 를 읽지 않는다. 화면(생산 > 일정)이 주문 개수 · 형의 장당 개수 · 시료 구간 ·
   공정 시간표를 넘기면, 몇 장을 몇 배치로 언제 시작할지 «제안» 을 돌려준다.
   시스템은 정하지 않는다 - 사람이 고치고 확정한다.

   'use client' 가 아니다 - 서버 화면도 부른다.
--------------------------------------------------------------------------- */

import { DAY, addDays, daysBetween, dayIndex, isOff, planBatch } from './timeline.ts';
import type { Step, WorkCalendar } from './timeline.ts';

/** 시간표 첫 단계의 하루 안 시각 (분). 시간표가 없으면 08:00 */
export function firstStepMin(steps: Step[] | null): number {
  if (!steps || !steps.length) return 480;
  const f = Math.min(...steps.map((x) => x.s));
  return f - dayIndex(f) * DAY;
}

export interface SampleTier { min: number; max: number | null; samples: number }

export interface ProposeInput {
  /** 만들 개수 (시료 빼고) */
  units: number;
  /** model_per_sheet */
  perSheet: number | null;
  sheetMin: number | null;
  sheetMax: number | null;
  /** sample_plan (min_qty · max_qty · sample_qty) */
  sampleTiers: SampleTier[];
  steps: Step[] | null;
  startMin: number;
  calendar: WorkCalendar;
  /** YYYY-MM-DD (KST) */
  today: string;
  dueOn: string | null;
  /** 시간표 없는 판의 배치 간격 (근무일) */
  gapDays: number | null;
}

export interface ProposedBatch {
  sheets: number;
  /** 이 배치에서 만들어지는 개수 (장수 x 장당, 시료 포함) */
  units: number;
  samples: number;
  startOn: string;
  workEndOn: string | null;
  lastOn: string | null;
}

export type Proposal =
  | { ok: true; perSheet: number; units: number; samples: number; sheets: number; batches: ProposedBatch[]; lateDays: number | null; noSteril: boolean }
  | { ok: false; reason: 'no-size' | 'no-units' };

/* 계획의 끝 분은 «끝나는 순간» 이라 그 직전 분의 날이 끝나는 날이다 (24:00 은 그날) */
/** 근무일이면 그날, 아니면 다음 근무일 */
export function nextWorkday(ymd: string, cal: WorkCalendar): string {
  let d = ymd;
  for (let n = 0; isOff(d, cal) && n < 400; n++) d = addDays(d, 1);
  return d;
}

/** n 근무일 뒤 (시작일은 근무일로 맞춘 뒤 센다) */
export function addWorkdays(ymd: string, n: number, cal: WorkCalendar): string {
  let d = nextWorkday(ymd, cal);
  for (let i = 0; i < n; i++) d = nextWorkday(addDays(d, 1), cal);
  return d;
}

/** 배치 개수에 맞는 시료 구간의 시료 수. 구간이 없으면 0 */
export function samplesFor(units: number, tiers: SampleTier[]): number {
  const t = tiers.find((x) => units >= x.min && (x.max == null || units <= x.max));
  return t ? t.samples : 0;
}

/** 장수를 배치로 나눈다: 상한씩, 나머지가 하한보다 적으면 하한으로 (배치가 하나여도 하한) */
function splitSheets(total: number, min: number | null, max: number | null): number[] {
  const lift = (n: number) => (min && n < min ? min : n);
  if (!max || max <= 0 || total <= max) return [lift(total)];
  const out: number[] = [];
  let left = total;
  while (left > max) { out.push(max); left -= max; }
  out.push(lift(left));
  return out;
}

/** 배치마다 그 배치 개수로 시료를 찾는다. 남은 주문 개수에서 시료를 뺀 만큼 담는다 */
function samplesOf(sheets: number[], perSheet: number, units: number, tiers: SampleTier[]): number[] {
  let left = units;
  return sheets.map((s) => {
    const cap = s * perSheet;
    const sm = samplesFor(Math.min(left, cap), tiers);
    left = Math.max(0, left - Math.max(0, cap - sm));
    return sm;
  });
}

export function proposeBatches(input: ProposeInput): Proposal {
  const { units, perSheet, sheetMin, sheetMax, sampleTiers, steps, startMin, calendar, today, dueOn, gapDays } = input;
  if (!(units > 0)) return { ok: false, reason: 'no-units' };
  if (perSheet == null || !(perSheet > 0)) return { ok: false, reason: 'no-size' };

  /* 시료가 배치마다 붙으므로 장수가 달라지면 시료가 달라진다 - 안정될 때까지 (최대 10번) */
  let total = Math.ceil(units / perSheet);
  let sheetList = splitSheets(total, sheetMin, sheetMax);
  let sm = samplesOf(sheetList, perSheet, units, sampleTiers);
  for (let i = 0; i < 10; i++) {
    const want = Math.ceil((units + sm.reduce((a, b) => a + b, 0)) / perSheet);
    if (want <= total) break;
    total = want;
    sheetList = splitSheets(total, sheetMin, sheetMax);
    sm = samplesOf(sheetList, perSheet, units, sampleTiers);
  }

  const hasSteps = !!steps && steps.length > 0;
  const noSteril = !hasSteps || !steps!.some((x) => x.k === 'ext');
  const first = nextWorkday(today, calendar);
  const batches: ProposedBatch[] = [];
  let startOn = first;
  sheetList.forEach((sheets, i) => {
    const b: ProposedBatch = { sheets, units: sheets * perSheet, samples: sm[i], startOn, workEndOn: null, lastOn: null };
    const plan = hasSteps ? planBatch(steps!, startOn, startMin, calendar) : null;
    if (plan) {
      b.workEndOn = addDays(startOn, dayIndex(Math.max(0, plan.sendEnd - 1)));
      b.lastOn = addDays(startOn, dayIndex(Math.max(0, plan.last - 1)));
      startOn = nextWorkday(addDays(b.workEndOn, 1), calendar);
    } else if (gapDays != null) {
      startOn = addWorkdays(startOn, gapDays, calendar);
    }
    batches.push(b);
  });

  let lateDays: number | null = null;
  if (dueOn) {
    const lastB = batches[batches.length - 1];
    const end = lastB.lastOn ?? (gapDays != null ? addWorkdays(lastB.startOn, gapDays, calendar) : null);
    if (end) lateDays = daysBetween(dueOn, end);
  }
  return {
    ok: true, perSheet, units,
    samples: sm.reduce((a, b) => a + b, 0),
    sheets: sheetList.reduce((a, b) => a + b, 0),
    batches, lateDays, noSteril,
  };
}

/** 한 번에 올리는 배치 수의 상한. 한 번 제출이 만드는 계획 수의 모양이다 - 넘으면 만들 개수를 나눠 올린다 (0167) */
export const MAX_BATCHES = 50;
export const TOO_MANY_BATCHES = `한 번에 ${MAX_BATCHES} 배치까지 올릴 수 있습니다. 만들 개수를 나눠 올리십시오`;
export const tooManyBatches = (p: Proposal): boolean => p.ok && p.batches.length > MAX_BATCHES;

export function planNote(p: Extract<Proposal, { ok: true }>, i: number, n: number): string {
  return `장당 ${p.perSheet}개 · ${p.units}개 + 시료 ${p.samples}개 → ${p.sheets}장 · ${i}/${n}`;
}
