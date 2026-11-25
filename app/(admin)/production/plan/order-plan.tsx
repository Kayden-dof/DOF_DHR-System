'use client';

import { useActionState, useEffect, useId, useMemo, useState } from 'react';
import type { FormState } from '@/lib/forms';
import Link from 'next/link';
import { Msg, Tag } from '@/components/ui';
import { Table, Th, Td } from '@/components/table';
import { Dialog, useDialog } from '@/components/dialog';
import { md, type Step, type WorkCalendar } from '@/lib/timeline';
import { proposeBatches, type SampleTier } from '@/lib/order-plan';
import { addPlansFromOrder } from './actions';

/** 판 위 줄 하나. 서버가 읽어 넘기는 값이고, 제안은 여기서 다시 셈한다 (올릴 때는 서버가 또 셈한다) */
export interface OrderPlanLine {
  lineId: string;
  dmId: string;
  customer: string;
  po: string;
  itemCode: string;
  dueOn: string | null;
  leftQty: number;
  covered: number;
  fgStock: number;
  perSheet: number | null;
  /** 판에 유효 크기가 적혀 있는가 (없으면 «유효 크기를 넣으십시오») */
  sized: boolean;
  sheetMin: number | null;
  sheetMax: number | null;
  multiWo: boolean;
  tiers: SampleTier[];
  steps: Step[] | null;
  startMin: number;
  /** 시간표 없는 판의 배치 간격 기본값 (그 제품 가장 최근 종료 지시의 근무일 수) */
  defaultGap: number | null;
}

/** 겹침을 알릴 이미 있는 계획 · 진행 중 지시 */
export interface Occupied { on: string; name: string }

export function OrderPlan({ lines, calendar, today, occupied, writable }: {
  lines: OrderPlanLine[]; calendar: WorkCalendar; today: string; occupied: Occupied[]; writable: boolean;
}) {
  return (
    <Table grow={5}>
      <thead><tr>
        <Th>거래처 · 발주번호</Th><Th>형명</Th><Th>남음 · 덮임</Th><Th>납기</Th><Th>제안</Th>
        {writable && <><Th>만들 개수</Th><Th><span className="sr-only">올리기</span></Th></>}
      </tr></thead>
      <tbody>
        {lines.map((l) => (
          <LineRow key={l.lineId} line={l} calendar={calendar} today={today} occupied={occupied} writable={writable} />
        ))}
      </tbody>
    </Table>
  );
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
/* 서버와 같은 규칙: 0 이상의 정수만 간격으로 쓴다 */
const gapOf = (s: string) => { const n = num(s); return Number.isInteger(n) && n >= 0 ? n : null; };

function LineRow({ line: l, calendar, today, occupied, writable }: {
  line: OrderPlanLine; calendar: WorkCalendar; today: string; occupied: Occupied[]; writable: boolean;
}) {
  const uid = useId();
  const defUnits = Math.max(0, l.leftQty - l.covered);
  const [units, setUnits] = useState(String(defUnits));
  const [gap, setGap] = useState(l.defaultGap == null ? '' : String(l.defaultGap));
  /* 올린 뒤 덮인 개수가 늘면 기본값도 따라 바뀐다 */
  useEffect(() => { setUnits(String(defUnits)); }, [defUnits]);

  const [state, action, pending] = useActionState<FormState, FormData>(addPlansFromOrder, {});
  const { open, setOpen } = useDialog(state);

  const hasTimeline = !!l.steps && l.steps.length > 0;
  const u = num(units);
  const p = useMemo(() => proposeBatches({
    units: Number.isInteger(u) && u > 0 ? u : 0, perSheet: l.perSheet, sheetMin: l.sheetMin, sheetMax: l.sheetMax,
    sampleTiers: l.tiers, steps: l.steps, startMin: l.startMin, calendar, today, dueOn: l.dueOn,
    gapDays: gapOf(gap),
  }), [u, gap, l, calendar, today]);

  /* 겹침: 제안 배치의 [시작일, 작업 끝날] 안에 이미 있는 계획 · 진행 중 지시의 시작일이 드는가. 막지 않는다 */
  const clash = p.ok
    ? [...new Set(p.batches.flatMap((b) =>
        occupied.filter((o) => o.on >= b.startOn && o.on <= (b.workEndOn ?? b.startOn)).map((o) => o.name)))]
    : [];

  return (
    <tr>
      <Td>
        {l.customer}<br /><span className="font-mono">{l.po}</span>
        {l.multiWo && <> <Tag tone="warn">여러 줄에 걸린 지시</Tag></>}
      </Td>
      <Td nowrap><span className="font-mono">{l.itemCode}</span></Td>
      <Td nowrap>
        <span className="tnum">{l.leftQty.toLocaleString('ko-KR')} · {l.covered.toLocaleString('ko-KR')}</span>
        {l.fgStock > 0 && <><br /><span className="text-muted">완제품 재고 {l.fgStock.toLocaleString('ko-KR')}개</span></>}
      </Td>
      <Td nowrap>{l.dueOn ? <span className="tnum">{md(l.dueOn)}</span> : '-'}</Td>
      <Td>
        {l.perSheet == null ? (
          <span className="text-warn">
            {l.sized ? '이 형명은 한 장에 나오지 않습니다'
              : <Link href={`/settings/dmr?dm=${l.dmId}`} className="underline">유효 크기를 넣으십시오</Link>}
          </span>
        ) : !p.ok ? (
          <span className="text-muted">{defUnits === 0 ? '이미 계획이 덮고 있습니다' : '만들 개수를 넣으십시오'}</span>
        ) : (
          <>
            <span className="tnum">
              장당 {p.perSheet}개 → {p.sheets}장 → {p.batches.map((b) => b.sheets).join(' · ')}장
            </span>
            {p.samples > 0 && <span className="text-muted"> (시료 {p.samples}개 포함)</span>}
            <br />
            <span className="tnum text-muted">
              {p.batches.map((b) => md(b.startOn)).join(' · ')} 시작
              {p.lateDays != null && p.lateDays > 0 && <span className="text-warn"> · 납기 {p.lateDays}일 넘김 예상</span>}
            </span>
            {p.noSteril && <> <Tag tone="quiet">멸균 기간은 셈에 없음</Tag></>}
            {clash.length > 0 && <><br /><span className="text-warn">겹침: {clash.join(' · ')}</span></>}
          </>
        )}
      </Td>
      {writable && (
        <>
          <Td nowrap>
            <label className="sr-only" htmlFor={`${uid}-u`}>만들 개수</label>
            <input id={`${uid}-u`} className="input" type="number" min={0} inputMode="numeric" value={units}
                   onChange={(e) => setUnits(e.target.value)} />
            {!hasTimeline && l.perSheet != null && (
              <>
                <label className="label" htmlFor={`${uid}-g`}>배치 간격 (근무일)</label>
                <input id={`${uid}-g`} className="input" type="number" min={0} step={1} inputMode="numeric" value={gap}
                       onChange={(e) => setGap(e.target.value)} />
              </>
            )}
          </Td>
          <Td nowrap>
            {p.ok && (
              <>
                <button type="button" className="btn-primary" onClick={() => setOpen(true)}>일정에 올리기</button>
                <Dialog open={open} onClose={() => setOpen(false)} title={`${l.po} 일정에 올리기`}>
                  <form action={action}>
                    <input type="hidden" name="line" value={l.lineId} />
                    <input type="hidden" name="dm" value={l.dmId} />
                    <input type="hidden" name="units" value={u} />
                    <input type="hidden" name="gap" value={hasTimeline ? '' : gap} />
                    <input type="hidden" name="covered" value={l.covered} />
                    <p className="text-sm">
                      배치 계획 {p.batches.length}개가 생깁니다. 일정 화면에서 날짜를 옮기거나 지울 수 있습니다.
                    </p>
                    <Msg state={state} />
                    <div className="mt-4 flex gap-2">
                      <button type="submit" disabled={pending} className="btn-primary">올린다</button>
                      <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
                    </div>
                  </form>
                </Dialog>
              </>
            )}
            {state.ok && <Msg state={state} />}
          </Td>
        </>
      )}
    </tr>
  );
}
