'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FormState } from '@/lib/forms';
import { Msg } from '@/components/ui';
import { DOW } from '@/lib/timeline';
import { savePlan, deletePlan, saveCalendar } from './actions';

/* 저장한 뒤 그 계획을 연다 */
function useGo(state: FormState) {
  const router = useRouter();
  useEffect(() => { if (state.ok && state.href) router.push(state.href); }, [state, router]);
}

export interface DmOption { id: string; label: string; note: string }
export interface WoOption { id: string; dm: string; label: string }
export interface PlanValue {
  id: string; label: string; dm: string; start_on: string; start_time: string; wo: string | null; note: string;
}

export function PlanForm({ dms, wos, value, suggest }: {
  dms: DmOption[]; wos: WoOption[];
  /** 고치는 계획. 없으면 새 계획 */
  value?: PlanValue;
  /** 새 계획의 칸을 채울 값 (지난 계획 + 7일) */
  suggest?: { label: string; start_on: string; start_time: string; dm: string };
}) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(savePlan, {});
  useGo(state);
  const [dm, setDm] = useState(value?.dm ?? suggest?.dm ?? dms[0]?.id ?? '');
  const choice = wos.filter((w) => w.dm === dm);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 px-4 py-3">
      {value && <input type="hidden" name="id" value={value.id} />}
      <div>
        <label className="label" htmlFor={`${uid}-l`}>배치번호 (예정)</label>
        <input id={`${uid}-l`} name="label" className="input" required maxLength={40}
               defaultValue={value?.label ?? suggest?.label ?? ''} placeholder="예: B261125-01" />
      </div>
      <div className="min-w-[12rem]">
        <label className="label" htmlFor={`${uid}-d`}>제품표준서 판</label>
        <select id={`${uid}-d`} name="dm" className="input" value={dm} onChange={(e) => setDm(e.target.value)} required>
          {dms.length === 0 && <option value="">시간표가 있는 판이 없습니다</option>}
          {dms.map((o) => <option key={o.id} value={o.id}>{o.label}{o.note ? ` (${o.note})` : ''}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-s`}>시작일</label>
        <input id={`${uid}-s`} name="start_on" type="date" className="input" required
               defaultValue={value?.start_on ?? suggest?.start_on ?? ''} />
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-t`}>시작 시각</label>
        <input id={`${uid}-t`} name="start_time" type="time" className="input" required
               defaultValue={value?.start_time ?? suggest?.start_time ?? '08:00'} />
      </div>
      <div className="min-w-[12rem]">
        <label className="label" htmlFor={`${uid}-w`}>이은 작업 지시</label>
        <select id={`${uid}-w`} name="wo" className="input" defaultValue={value?.wo ?? ''}>
          <option value="">아직 없음</option>
          {choice.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      </div>
      <div className="min-w-[12rem] flex-1">
        <label className="label" htmlFor={`${uid}-n`}>메모</label>
        <input id={`${uid}-n`} name="note" className="input" maxLength={200} defaultValue={value?.note ?? ''} />
      </div>
      <button type="submit" className="btn-primary" disabled={pending || !dms.length}>
        {value ? '계획 고치기' : '계획 넣기'}
      </button>
      <Msg state={state} className="w-full" />
    </form>
  );
}

export function DeletePlan({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deletePlan, {});
  useGo(state);
  return (
    <form action={action} className="inline-flex items-center gap-2"
          onSubmit={(e) => { if (!confirm(`계획 ${label} 을 지울까요? 계획만 지워지고 작업 지시 · 기록은 그대로입니다.`)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="qd-text-action" disabled={pending}>계획 지우기</button>
      <Msg state={state} />
    </form>
  );
}

export function CalendarForm({ value }: {
  value: { workdays: number[]; day_start: string; day_end: string; lunch: boolean; skip_off: boolean; holidays: string };
}) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(saveCalendar, {});
  return (
    <form action={action} className="space-y-3 px-4 py-3">
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <legend className="label">근무 요일</legend>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <label key={d} className="inline-flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="wd" value={d} defaultChecked={value.workdays.includes(d)} /> {DOW[d]}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor={`${uid}-a`}>근무 시작</label>
          <input id={`${uid}-a`} name="day_start" type="time" className="input" defaultValue={value.day_start} />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-b`}>근무 끝</label>
          <input id={`${uid}-b`} name="day_end" type="time" className="input" defaultValue={value.day_end} />
        </div>
        <label className="inline-flex items-center gap-1.5 pb-2 text-sm">
          <input type="checkbox" name="lunch" defaultChecked={value.lunch} /> 점심 12~13시
        </label>
        <label className="inline-flex items-center gap-1.5 pb-2 text-sm">
          <input type="checkbox" name="skip_off" defaultChecked={value.skip_off} /> 손작업이 휴무일에 걸리면 다음 근무일로 미루기
        </label>
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-h`}>공휴일</label>
        <input id={`${uid}-h`} name="holidays" className="input" defaultValue={value.holidays}
               placeholder="예: 2026-12-25, 2027-01-01" />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-ghost" disabled={pending}>근무 달력 저장</button>
        <span className="text-xs text-faint">모든 배치 일정과 공정 시간표의 근무시간 표시가 이 달력을 따릅니다.</span>
      </div>
      <Msg state={state} />
    </form>
  );
}
