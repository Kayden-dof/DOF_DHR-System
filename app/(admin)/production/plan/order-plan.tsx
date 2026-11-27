'use client';

import { useActionState, useEffect, useId, useMemo, useState } from 'react';
import type { FormState } from '@/lib/forms';
import Link from 'next/link';
import { Msg, Tag } from '@/components/ui';
import { Table, Th, Td } from '@/components/table';
import { Dialog, useDialog } from '@/components/dialog';
import { md, type Step, type WorkCalendar } from '@/lib/timeline';
import { proposeBatches, oneBatchMax, samplesFor, tooManyBatches, TOO_MANY_BATCHES, type SampleTier } from '@/lib/order-plan';
import { addPlansFromOrder } from './actions';

/** 판 위 줄 하나. 서버가 읽어 넘기는 값이고, 제안은 여기서 다시 셈한다 (올릴 때는 서버가 또 셈한다) */
export interface OrderPlanLine {
  lineId: string;
  dmId: string;
  /** 이 줄에 쓰는 제품표준서 판 (제품 코드 · 판) */
  dmLabel: string;
  customer: string;
  po: string;
  itemCode: string;
  /** 납품요청일 (고객 발주서의 값) */
  dueOn: string | null;
  /**
   * 출고 마감일 (0173). 있으면 이것이 이 줄의 마감이다 - 현황 · 수주와 같은 잣대 (정밀 점검 E). 전에는 이 판만
   * 납품요청일로 «넘김» 을 셌다 (SD_261110-02 납품요청 11-19 · 출고 마감 12-31).
   */
  shipBy: string | null;
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
        <Th>거래처 · 발주번호</Th><Th>형명</Th><Th>남음 · 덮임</Th><Th>출고 마감</Th><Th>제안</Th>
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
  const need = Math.max(0, l.leftQty - l.covered);
  /*
   * 한 배치(장입 상한)에 드는 최대 개수 (사용자 2026-11-26 «장입 상한에 맞춰 만들 개수의 최대치
   * 안내 · 20장이 들어가는 수량을 1차 제안»). 장당 개수가 달라지면 이 값도 따라 바뀐다.
   * 1차 제안은 남은 개수이되, 한 배치를 넘으면 한 배치 가득이다. 그보다 많이 넣으면 배치를 나눈다.
   */
  const cap = useMemo(() => oneBatchMax(l.perSheet, l.sheetMin, l.sheetMax, l.tiers),
    [l.perSheet, l.sheetMin, l.sheetMax, l.tiers]);
  const defUnits = cap != null && need > cap ? cap : need;
  const [units, setUnits] = useState(String(defUnits));
  const [gap, setGap] = useState(l.defaultGap == null ? '' : String(l.defaultGap));
  /* 올린 뒤 덮인 개수가 늘면 기본값도 따라 바뀐다 */
  useEffect(() => { setUnits(String(defUnits)); }, [defUnits]);

  const [state, action, pending] = useActionState<FormState, FormData>(addPlansFromOrder, {});
  const { open, setOpen } = useDialog(state);

  const hasTimeline = !!l.steps && l.steps.length > 0;
  /* 이 줄의 마감 - 출고 마감일, 없으면 납품요청일 (서버의 올리기와 같은 셈) */
  const deadline = l.shipBy ?? l.dueOn;
  const u = num(units);
  const p = useMemo(() => proposeBatches({
    units: Number.isInteger(u) && u > 0 ? u : 0, perSheet: l.perSheet, sheetMin: l.sheetMin, sheetMax: l.sheetMax,
    sampleTiers: l.tiers, steps: l.steps, startMin: l.startMin, calendar, today, dueOn: deadline,
    gapDays: gapOf(gap),
  }), [u, gap, l, calendar, today, deadline]);

  /* 한 번에 올리는 배치 수의 상한 (서버도 같은 셈으로 거부한다) */
  const tooMany = tooManyBatches(p);
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
      <Td nowrap>
        <span className="font-mono">{l.itemCode}</span>
        <div className="text-xs text-muted">{l.dmLabel}</div>
      </Td>
      <Td nowrap>
        <span className="tnum">{l.leftQty.toLocaleString('ko-KR')}개 · {l.covered.toLocaleString('ko-KR')}개</span>
        {l.fgStock > 0 && <><br /><span className="text-muted">완제품 재고 {l.fgStock.toLocaleString('ko-KR')}개</span></>}
      </Td>
      <Td nowrap>
        {deadline ? <span className="tnum">{md(deadline)}</span> : '-'}
        {!l.shipBy && l.dueOn && <div className="text-xs text-muted">납품요청일</div>}
      </Td>
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
              {p.lateDays != null && (p.lateDays > 0
                ? <span className="text-warn"> · 출고 마감 {p.lateDays}일 넘김 예상</span>
                : <> · 여유 {-p.lateDays}일</>)}
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
            {cap != null && (
              <p className="mt-1 text-xs text-faint">
                한 배치 최대 <span className="tnum font-semibold text-muted">{cap.toLocaleString('ko-KR')}개</span>
                <br />
                <span className="tnum">장입 {l.sheetMax}장 × 장당 {l.perSheet}개</span>
                {samplesFor(cap, l.tiers) > 0 && <> · 시료 {samplesFor(cap, l.tiers)}개 빼고</>}
              </p>
            )}
            {cap != null && p.ok && p.batches.length > 1 && (
              <p className="mt-0.5 text-xs text-warn">한 배치를 넘어 {p.batches.length}배치로 나눕니다</p>
            )}
            {!hasTimeline && l.perSheet != null && (
              <>
                <label className="label" htmlFor={`${uid}-g`}>배치 간격 (근무일)</label>
                <input id={`${uid}-g`} className="input" type="number" min={0} step={1} inputMode="numeric" value={gap}
                       onChange={(e) => setGap(e.target.value)} />
                {l.defaultGap != null && <p className="mt-1 text-xs text-faint">지난 배치 기준 {l.defaultGap}일</p>}
              </>
            )}
          </Td>
          <Td nowrap>
            {tooMany && <span className="block whitespace-normal text-warn">{TOO_MANY_BATCHES}</span>}
            {p.ok && !tooMany && (
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
