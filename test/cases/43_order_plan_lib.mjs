// =============================================================================
// 43_order_plan_lib.mjs - 배치 나누기 · 날짜 놓기 (순수 함수, DB 를 쓰지 않는다)
// 근거: 주문에서 생산 계획 · 자재 소요 예보 (lib/order-plan.ts)
// =============================================================================

import { proposeBatches, nextWorkday, addWorkdays, samplesFor, planNote } from '../../lib/order-plan.ts';
import { DEFAULT_CALENDAR } from '../../lib/timeline.ts';

const CAL = { ...DEFAULT_CALENDAR, holidays: ['2026-11-30'] };
const S = (id, extra = {}) => ({ id, p: '01', n: `작업 ${id}`, k: 'work', s: 480, d: 60, mn: null, mx: null, a: [], m: '', ...extra });
/* 1일차 작업 - 2일차 외부 - 3일차 작업. 외부와 그것에 기대는 단계는 발송 끝에서 빠진다 */
const TL3 = [S('a'), S('e', { k: 'ext', s: 1440 + 480, a: ['a'] }), S('c', { s: 2880 + 480, a: ['e'] })];
const base = (o = {}) => ({
  units: 1000, perSheet: 16, sheetMin: 1, sheetMax: 30, sampleTiers: [],
  steps: null, startMin: 480, calendar: CAL, today: '2026-11-28', dueOn: null, gapDays: null, ...o,
});
const sheetsOf = (p) => p.batches.map((b) => b.sheets);

export default [

{
  id: 'OL-01', expect: '통과',
  name: '장수 · 상한과 하한으로 배치 나누기',
  async run(t) {
    const p = proposeBatches(base());
    t.eq(p.ok, true, '제안이 선다');
    t.eq(p.sheets, 63, '1000개 / 장당 16 = 63장');
    t.eq(sheetsOf(p), [30, 30, 3], '상한 30 → 30 · 30 · 3');
    t.eq(sheetsOf(proposeBatches(base({ sheetMax: 20 }))), [20, 20, 20, 3], '상한 20 → 20 · 20 · 20 · 3');
    t.eq(sheetsOf(proposeBatches(base({ sheetMin: 5 }))), [30, 30, 5], '나머지가 하한 5 보다 적으면 5');
    t.eq(sheetsOf(proposeBatches(base({ sheetMax: null }))), [63], '상한이 없으면 한 배치');
    t.eq(sheetsOf(proposeBatches(base({ units: 20, sheetMin: 5 }))), [5], '배치 하나여도 하한 5');
    t.eq(sheetsOf(proposeBatches(base({ units: 20, sheetMin: 5, sheetMax: null }))), [5], '상한 없어도 하한 5');
    t.eq(sheetsOf(proposeBatches(base({ units: 480 }))), [30], '정확히 상한 30장은 한 배치');
    t.eq(sheetsOf(proposeBatches(base({ units: 481 }))), [30, 1], '상한 하나 넘으면 둘');
  },
},

{
  id: 'OL-02', expect: '통과',
  name: '시료 - 배치 개수로 구간을 찾고 시료만큼 장수가 는다',
  async run(t) {
    const tiers = [{ min: 1, max: 50, samples: 3 }, { min: 51, max: null, samples: 5 }];
    t.eq(samplesFor(50, tiers), 3, '50개 → 3');
    t.eq(samplesFor(51, tiers), 5, '51개 → 5');
    t.eq(samplesFor(0, tiers), 0, '0개 → 0');
    const hi = [{ min: 10, max: 50, samples: 2 }];
    t.eq(samplesFor(9, hi), 0, '구간 밑 → 0');
    t.eq(samplesFor(10, hi), 2, '구간 하한 포함');
    t.eq(samplesFor(51, hi), 0, '구간 위 → 0');
    t.eq(samplesFor(10, []), 0, '구간이 없으면 0');
    const p = proposeBatches(base({ units: 100, perSheet: 10, sheetMax: 5, sampleTiers: tiers }));
    t.eq(p.ok, true, '제안이 선다');
    t.eq(p.batches[0].samples, 3, '50개 배치는 시료 3');
    const sumUnits = p.batches.reduce((a, b) => a + b.units, 0);
    const sumSamples = p.batches.reduce((a, b) => a + b.samples, 0);
    t.eq(p.samples, sumSamples, '시료 합');
    t.ok(sumUnits >= 100 + sumSamples, `배치 개수 합 ${sumUnits} >= 100 + 시료 ${sumSamples}`);
    const one = proposeBatches(base({ units: 100, perSheet: 10, sheetMax: null, sampleTiers: tiers }));
    t.eq(one.batches[0].samples, 5, '한 배치 100개는 시료 5');
    t.eq(one.sheets, 11, '(100 + 5) / 10 = 11장');
  },
},

{
  id: 'OL-03', expect: '통과',
  name: '날짜 - 휴무를 건너뛰고 둘째 배치는 첫 배치 발송이 끝난 다음 근무일',
  async run(t) {
    t.eq(nextWorkday('2026-11-28', CAL), '2026-12-01', '토 · 일 · 월(공휴일) 건너뜀');
    t.eq(nextWorkday('2026-12-01', CAL), '2026-12-01', '근무일이면 그날');
    t.eq(addWorkdays('2026-12-01', 7, CAL), '2026-12-10', '7 근무일 뒤');
    const p = proposeBatches(base({ units: 40, perSheet: 20, sheetMax: 1, steps: TL3 }));
    t.eq(p.batches.length, 2, '두 배치');
    t.eq(p.batches[0].startOn, '2026-12-01', '첫 시작');
    t.eq(p.batches[0].workEndOn, '2026-12-01', '발송은 1일차에 끝');
    t.eq(p.batches[0].lastOn, '2026-12-03', '첫 배치 끝은 3일차');
    t.eq(p.batches[1].startOn, '2026-12-02', '둘째는 첫 발송 다음 근무일');
    t.eq(p.batches[1].lastOn, '2026-12-04', '둘째 끝');
  },
},

{
  id: 'OL-04', expect: '통과',
  name: '시간표가 없으면 간격으로 벌리고, 간격도 없으면 같은 날',
  async run(t) {
    const p = proposeBatches(base({ gapDays: 7 }));
    t.eq(p.batches.map((b) => b.startOn), ['2026-12-01', '2026-12-10', '2026-12-21'], '7 근무일씩');
    t.eq(p.batches.every((b) => b.workEndOn === null && b.lastOn === null), true, '끝 날짜 없음');
    const q = proposeBatches(base({ gapDays: null, dueOn: '2026-12-31' }));
    t.eq(new Set(q.batches.map((b) => b.startOn)).size, 1, '모두 같은 시작');
    t.eq(q.lateDays, null, '간격이 없으면 넘김을 모른다');
  },
},

{
  id: 'OL-05', expect: '거부',
  name: '장당 개수 · 만들 개수가 없으면 제안하지 않는다',
  async run(t) {
    t.eq(proposeBatches(base({ perSheet: null })), { ok: false, reason: 'no-size' }, '장당 없음');
    t.eq(proposeBatches(base({ perSheet: 0 })), { ok: false, reason: 'no-size' }, '장당 0');
    t.eq(proposeBatches(base({ units: 0 })), { ok: false, reason: 'no-units' }, '개수 0');
  },
},

{
  id: 'OL-06', expect: '통과',
  name: '납기 넘김 · 멸균 위탁 단계 유무',
  async run(t) {
    const one = (o) => proposeBatches(base({ units: 10, perSheet: 20, steps: TL3, ...o }));
    t.eq(one({ dueOn: '2026-12-01' }).lateDays, 2, '납기보다 2일 늦음');
    t.eq(one({ dueOn: '2026-12-06' }).lateDays, -3, '납기보다 3일 이름');
    t.eq(one({}).lateDays, null, '납기 없음');
    t.eq(one({}).noSteril, false, '외부 단계가 있다');
    t.eq(one({ steps: [S('a')] }).noSteril, true, '외부 단계가 없다');
    t.eq(one({ steps: null }).noSteril, true, '시간표 없음도 멸균 위탁 없음');
    const mid = one({ steps: [S('a', { s: 480, d: 960 })] }).batches[0];
    t.eq(mid.workEndOn, '2026-12-01', '24:00 에 끝나는 작업은 그날 끝');
    t.eq(mid.lastOn, '2026-12-01', '끝 시각은 그 직전 분의 날');
    const g = proposeBatches(base({ units: 10, perSheet: 20, gapDays: 3, dueOn: '2026-12-01' }));
    t.eq(g.lateDays, 3, '시간표 없이 간격만: 마지막 시작일 + 간격 3 근무일');
  },
},

{
  id: 'OL-07', expect: '통과',
  name: '비고 글',
  async run(t) {
    const p = proposeBatches(base());
    t.eq(planNote(p, 1, 3), '장당 16개 · 1000개 + 시료 0개 → 63장 · 1/3', '비고');
  },
},

];
