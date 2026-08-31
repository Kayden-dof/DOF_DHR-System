'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { FormState } from '@/lib/forms';
import { fmtDateTime } from '@/lib/fmt';
import { Msg, Tag } from '@/components/ui';
import NumPad, { PresetPicker } from '@/components/num-pad';
import { Dialog } from '@/components/dialog';
import { todayKST } from '@/lib/kst';
import {
  startRecord, issueMaterial, endRecord, closeDay, cutAtField,
  amendIssue, returnIssue,
} from '../actions';


export interface Op {
  id: string; seq: number; code: string; name: string; after_cutting: boolean;
  typical_day: number | null;
  bom: { item_id: string; item_code: string; item_name: string; usage_uom: string;
         basis: string; required: string | null }[];
  /** 이 공정에 걸린 설비. 비어 있으면 화면에 칸이 나오지 않는다 */
  equipment: { id: string; code: string; name: string; valid_until: string | null }[];
}
export interface Rec {
  id: string; operation_id: string; day_no: number; attempt: number;
  product_lot_id: string | null; product_lot_no: string | null;
  started_at: Date | null; ended_at: Date | null;
  equipment_id: string | null; rework_qty: number | null; no_material_reason: string | null;
  worker_id: string; worker_name: string;
  issues: { id: string; item_id: string; item_code: string; item_name: string;
            lot_no: string; qty: string; usage_uom: string;
            amend_reason: string | null; returned: string | null }[];
}
export interface LotOpt {
  id: string; lot_no: string; item_id: string; item_code: string; item_name: string;
  usage_uom: string; qty_available: string; expiry_date: string | null;
}
export interface PersonOpt { id: string; full_name: string }
export interface PlOpt {
  id: string; lot_no: string; item_code: string; item_name: string;
  qty_produced?: number; qty_sample?: number;
}
export interface FinOpt { id: string; code: string; name: string }
export interface SampleTier { min_qty: number; max_qty: number | null; sample_qty: number }

/*
 * 정정 · 반납 사유. 현장에는 키보드가 없다 (사용자 지적). 자유 입력 대신
 * 실제로 일어나는 일을 미리 적어 두고 고르게 한다. 목록에 없는 일이 자주
 * 생기면 그때 목록을 늘린다 - 자유 입력으로 돌아가지 않는다.
 */
const AMEND_REASONS = [
  '계량값을 잘못 읽음',
  '단위를 잘못 봄',
  '다른 공정 몫을 함께 적음',
  '기입 중 잘못 눌림',
];

const RETURN_REASONS = [
  '중복 기입',
  '다른 로트로 잘못 적음',
  '실제로 넣지 않음',
  '필요량보다 많이 꺼냄',
];

/*
 * 순환자를 타일로 보여 줄 최대 인원. 없음 타일까지 합해 3열 두 줄이 한계다.
 * 이보다 많아지면 목록으로 바꾼다.
 */
const ROTATION_TILE_MAX = 5;

const REASONS = [
  '해당 공정 미실시',
  '자재 사용 없음',
  '이전 일차에 투입 완료',
  '설비 점검으로 미실시',
];

/* ---------------------------------------------------------------------------
   현장 공정 기록

   키보드를 쓰지 않는다. 일차와 공정은 타일로 고르고, 수량은 숫자 패드로 넣고,
   사유는 미리 정한 문구에서 고른다. 되돌릴 수 없는 조작 앞에는 확인을 둔다.
--------------------------------------------------------------------------- */
export default function WorkPanel({
  woId, batchNo, sheets, ops, records, lots, people, productLots, meId, lockedDays,
  cutOpId, finished, sampleTiers, sampleBasis, band,
}: {
  woId: string; batchNo: string; sheets: number;
  ops: Op[]; records: Rec[]; lots: LotOpt[]; people: PersonOpt[];
  productLots: PlOpt[]; meId: string; lockedDays: number[];
  /** 재단 공정. 이 공정 카드에서 형명별 수량을 적는다 */
  cutOpId: string | null;
  finished: FinOpt[];
  sampleTiers: SampleTier[];
  sampleBasis: string | null;
  band: string | null;
}) {
  const myRecords = useMemo(() => records.filter((r) => r.worker_id === meId), [records, meId]);

  /*
   * 일차는 배치 전체가 공유하는 번호다 (§11 "지시서별 실작업일 순번").
   * 내 기록만 보고 세면, 남이 2일차까지 해 둔 배치에 오늘 합류한 사람 화면에
   * 1일차가 떠 버린다. 그대로 기록하면 제조기록서에 잘못된 일차가 찍히고,
   * 인쇄하고 나면 고칠 방법이 없다 (S04).
   *
   * 그래서 일차 목록은 배치의 모든 기록에서 뽑는다. 어느 일차에 내 기록이
   * 있는지는 따로 표시한다.
   */
  const days = useMemo(() => {
    const s = new Set(records.map((r) => r.day_no));
    return [...s].sort((a, b) => a - b);
  }, [records]);
  const nextDay = (days.at(-1) ?? 0) + 1;

  const myDays = useMemo(
    () => new Set(myRecords.map((r) => r.day_no)), [myRecords]);

  const [day, setDay] = useState(
    // 내가 마지막으로 손댄 일차를 연다. 없으면 배치의 마지막 일차.
    [...myDays].sort((a, b) => a - b).at(-1) ?? days.at(-1) ?? 1);
  const [opId, setOpId] = useState<string | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);

  const locked = lockedDays.includes(day);
  const dayRecords = myRecords.filter((r) => r.day_no === day);
  const op = ops.find((o) => o.id === opId) ?? null;
  const rec = op ? dayRecords.find((r) => r.operation_id === op.id && !r.ended_at)
                 ?? dayRecords.filter((r) => r.operation_id === op.id).at(-1) ?? null
                 : null;

  const stateOf = (o: Op) => {
    const rs = dayRecords.filter((r) => r.operation_id === o.id);
    if (rs.length === 0) return 'none';
    return rs.some((r) => !r.ended_at) ? 'open' : 'done';
  };

  /*
   * 기록지는 작업자별로 나온다. 그래서 내 기록만 내 화면에 뜬다.
   * 그런데 같은 배치를 두 사람이 나눠 하면 남이 이미 끝낸 공정이 내 화면에서는
   * 빈칸으로 보여 그대로 다시 하게 된다. 누가 언제 했는지는 판정이 아니라
   * 사실이므로 표시만 한다. 그 사람의 기록을 내가 고칠 수는 없다.
   */
  const othersOf = (o: Op) => {
    const rs = records.filter((r) => r.operation_id === o.id && r.worker_id !== meId);
    if (rs.length === 0) return null;
    const names = [...new Set(rs.map((r) => r.worker_name))].join(' · ');
    return { names, days: [...new Set(rs.map((r) => r.day_no))].sort((a, b) => a - b) };
  };

  /*
   * 한 배치에서 같은 공정을 두 번 하지 않는다. 그래서 다른 일차에 이미 마감된
   * 공정은 오늘 할 일 목록에서 빼고 아래로 내린다.
   *
   * 지우지는 않는다. 재세척처럼 회차를 다시 기록해야 하는 경우가 실제로 있고
   * (WS-05 pH 8 초과), 공정 순서를 강제하지 않는 것이 §10 이다. 접어 둘 뿐이라
   * 필요하면 한 번 눌러 펼치고 그 자리에서 다음 회차로 기록한다.
   */
  const closedElsewhere = (o: Op) => {
    const rs = records.filter(
      (r) => r.operation_id === o.id && r.ended_at && r.day_no !== day);
    if (rs.length === 0) return null;
    return {
      days: [...new Set(rs.map((r) => r.day_no))].sort((a, b) => a - b),
      names: [...new Set(rs.map((r) => r.worker_name))].join(' · '),
    };
  };

  const todo = ops.filter((o) => stateOf(o) !== 'none' || !closedElsewhere(o));
  const earlier = ops.filter((o) => stateOf(o) === 'none' && closedElsewhere(o));

  const mine = ops.filter((o) => stateOf(o) === 'done').length;

  return (
    <div className="space-y-5">
      {/* 일차 --------------------------------------------------------------- */}
      <section className="card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold text-ink">일차</h2>
          <span className="text-sm text-muted">지시서별 실작업일 순번</span>
        </div>
        <div className="mt-3.5 flex flex-wrap gap-2">
          {days.map((n) => {
            const mineHere = myRecords.filter((r) => r.day_no === n).length;
            return (
              <button key={n} onClick={() => { setDay(n); setOpId(null); }}
                      data-on={day === n}
                      className="tile no-select w-[6.5rem] items-center gap-0.5 text-center">
                <span className="text-xl font-bold tnum">{n}일차</span>
                <span className={`text-xs ${
                  lockedDays.includes(n) ? 'text-ok' : mineHere > 0 ? 'text-muted' : 'text-faint'
                }`}>
                  {lockedDays.includes(n)
                    ? '내 기록 마감'
                    : mineHere > 0
                      ? `내 기록 ${mineHere}건`
                      : '다른 작업자'}
                </span>
              </button>
            );
          })}
          {!days.includes(nextDay) && (
            <button onClick={() => { setDay(nextDay); setOpId(null); }}
                    data-on={day === nextDay}
                    className="tile no-select w-[6.5rem] items-center gap-0.5 border-dashed text-center">
              <span className="text-xl font-bold tnum">{nextDay}일차</span>
              <span className="text-xs text-muted">새로 시작</span>
            </button>
          )}
        </div>

        {locked && (
          <p className="mt-3 rounded-md border border-ok/30 bg-ok-bg px-3 py-2.5 text-sm leading-relaxed text-ink">
            <b>{day}일차는 마감되었습니다.</b> 기록서를 인쇄했으므로 더 이상 수정할 수 없습니다.
            누락된 것은 다음 일차에 정정 기록으로 남기십시오.
          </p>
        )}
      </section>

      {/* 공정 --------------------------------------------------------------- */}
      <section className="card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold text-ink">{day}일차 공정</h2>
          <span className="text-sm text-muted">
            마감 <b className="tnum text-ink">{mine}</b> / {ops.length}
            {dayRecords.some((r) => !r.ended_at) && (
              <span className="ml-2 font-bold text-warn">진행 중 {
                dayRecords.filter((r) => !r.ended_at).length
              }</span>
            )}
          </span>
        </div>

        <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
          {todo.map((o) => (
            <OpTile key={o.id} o={o} state={stateOf(o)} others={othersOf(o)}
                    selected={o.id === opId}
                    onPick={() => setOpId(o.id === opId ? null : o.id)} />
          ))}
        </div>

        {todo.length === 0 && (
          <p className="mt-3.5 rounded-md bg-surface-sub px-4 py-6 text-center text-sm text-muted">
            이 일차에 남은 공정이 없습니다.
          </p>
        )}

        {earlier.length > 0 && (
          <div className="mt-4 border-t border-line-soft pt-4">
            <button type="button" onClick={() => setShowEarlier((v) => !v)}
                    aria-expanded={showEarlier}
                    className="flex w-full items-center justify-between rounded-md px-1 py-2 text-left">
              <span className="text-sm font-semibold text-muted">
                앞 일차에 마감한 공정 <b className="tnum text-ink">{earlier.length}</b>
              </span>
              <span className="text-xs text-faint">
                {showEarlier ? '접기' : '재작업이면 펼치십시오'}
              </span>
            </button>

            {showEarlier && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {earlier.map((o) => (
                  <OpTile key={o.id} o={o} state="closed" others={closedElsewhere(o)}
                          selected={o.id === opId}
                          onPick={() => setOpId(o.id === opId ? null : o.id)} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 선택한 공정 --------------------------------------------------------- */}
      {/*
        * 회차는 배치 전체에서 센다. 일차와 작업자로 가리면, 어제 한 공정을
        * 오늘 다시 할 때 회차가 1 로 돌아간다 (2차 검수 결함 7).
        * 실제 값은 넣을 때 DB 가 정한다 (0055). 여기 값은 미리 보여 주는 것이다.
        */}
      {op && (
        <OperationCard
          woId={woId} day={day} op={op} rec={rec} lots={lots} people={people}
          productLots={productLots} locked={locked} sheets={sheets}
          attemptCount={records.filter((r) => r.operation_id === op.id).length}
          isCut={op.id === cutOpId} finished={finished}
          sampleTiers={sampleTiers} sampleBasis={sampleBasis} band={band}
        />
      )}

      {/* 일차 마감 ----------------------------------------------------------- */}
      {!locked && dayRecords.length > 0 && (
        <CloseDayCard woId={woId} day={day} batchNo={batchNo}
                      open={dayRecords.filter((r) => !r.ended_at).length} />
      )}

      {locked && (
        <div className="flex justify-end">
          <Link href={`/print/day-record/${woId}/${day}/${meId}`}
                className="btn-ghost h-12 px-5 text-sm">
            {day}일차 기록서 다시 보기
          </Link>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** 공정 하나. 왼쪽 띠가 상태를 먼저 말한다. */
function OpTile({
  o, state, others, selected, onPick,
}: {
  o: Op;
  state: 'none' | 'open' | 'done' | 'closed';
  others: { names: string; days: number[] } | null;
  selected: boolean;
  onPick: () => void;
}) {
  const bar = state === 'open' ? 'bg-warn'
    : state === 'done' ? 'bg-ok'
    : state === 'closed' ? 'bg-line-strong'
    : others ? 'bg-line-strong' : 'bg-transparent';

  return (
    <button onClick={onPick} data-on={selected}
            className={`tile no-select relative gap-1 pl-6 ${
              state === 'closed' ? 'opacity-70' : ''}`}>
      <span aria-hidden className={`absolute inset-y-2 left-2 w-1 rounded-full ${bar}`} />

      <div className="flex items-center gap-2">
        <span className="w-5 text-center text-sm font-bold tnum text-faint">{o.seq}</span>
        <span className="flex-1 text-base font-semibold text-ink">{o.name}</span>
        {state === 'open' && <Tag tone="warn">진행 중</Tag>}
        {state === 'done' && <Tag tone="ok">마감</Tag>}
        {state === 'closed' && others && (
          <Tag tone="quiet">{others.days.join(' · ')}일차 마감</Tag>
        )}
      </div>

      <div className="pl-7 text-xs text-muted">
        {o.code}
        {/*
          * 보통 몇 일차에 하는 공정인가. 오늘 어디까지 하는지 가늠하라고 적는
          * 참고값이다. 다른 일차에 기록해도 막지 않는다.
          */}
        {o.typical_day !== null && ` · 보통 ${o.typical_day}일차`}
        {o.after_cutting && ' · 제품 로트별'}
        {o.bom.length > 0 && ` · 자재 ${o.bom.length}종`}
      </div>

      {others && state === 'none' && (
        <div className="pl-7 text-xs text-faint">
          {others.names} 님이 {others.days.join(' · ')}일차에 기록
        </div>
      )}
      {others && state === 'closed' && (
        <div className="pl-7 text-xs text-faint">{others.names}</div>
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function OperationCard({
  woId, day, op, rec, lots, people, productLots, locked, sheets, attemptCount,
  isCut, finished, sampleTiers, sampleBasis, band,
}: {
  woId: string; day: number; op: Op; rec: Rec | null; lots: LotOpt[];
  people: PersonOpt[]; productLots: PlOpt[]; locked: boolean; sheets: number;
  attemptCount: number;
  isCut: boolean; finished: FinOpt[]; band: string | null;
  sampleTiers: SampleTier[]; sampleBasis: string | null;
}) {
  const running = rec && !rec.ended_at;

  return (
    <section className="card overflow-hidden">
      <header className="section-head bg-brand-soft">
        <div>
          <h2 className="text-base font-bold text-ink">{op.name}</h2>
          <p className="text-xs text-muted">{op.code}</p>
        </div>
        {rec && (
          <div className="ml-auto text-right text-xs text-muted">
            <div>시작 <span className="tnum">{fmtDateTime(rec.started_at)}</span></div>
            {rec.ended_at && <div>종료 <span className="tnum">{fmtDateTime(rec.ended_at)}</span></div>}
            {rec.attempt > 1 && <div className="text-warn">{rec.attempt}회차</div>}
          </div>
        )}
      </header>

      {locked ? (
        <p className="px-4 py-6 text-sm text-muted">마감된 일차입니다.</p>
      ) : !rec || rec.ended_at ? (
        <StartCard woId={woId} day={day} op={op} people={people}
                   productLots={productLots} attempt={attemptCount + 1}
                   done={!!rec?.ended_at} />
      ) : (
        <RunningCard woId={woId} op={op} rec={rec} lots={lots} sheets={sheets} />
      )}

      {/*
        * 재단 결과는 재단한 사람이 재단한 자리에서 적는다 (사용자 지적).
        * 공정을 시작해야 칸이 열린다 - 시작하지 않은 사람이 결과부터 적는 일을
        * 막는 건 DB 가 하지만, 화면에서도 순서를 보여 준다.
        */}
      {isCut && rec && (
        <CutPanel woId={woId} finished={finished} lots={productLots}
                  sampleTiers={sampleTiers} sampleBasis={sampleBasis} band={band} />
      )}

      {rec && rec.issues.length > 0 && (
        <div className="border-t border-line">
          {/*
            * 투입한 줄. 잘못 적었으면 눌러서 고친다 (§1 지우지는 않는다).
            * 인쇄해서 잠긴 뒤에는 열리지 않는다 - 그때는 다음 일차에 정정
            * 기록으로 남긴다.
            */}
          {rec.issues.map((x) => (
            <IssueRow key={x.id} woId={woId} x={x} locked={locked} />
          ))}

          {/*
            * 반납은 로트로 돌아간다. 어느 줄에서 돌아왔는지는 자료에 없으므로
            * 줄마다 붙이지 않고 로트별로 한 번만 적는다. 같은 로트를 두 줄에
            * 넣었을 때 줄마다 "반납 2통" 이 뜨면 4통이 돌아간 것처럼 읽힌다.
            */}
          {[...new Map(
            rec.issues
              .filter((x) => x.returned && Number(x.returned) > 0)
              .map((x) => [x.lot_no, x]),
          ).values()].map((x) => (
            <p key={x.lot_no}
               className="border-t border-line-soft bg-warn-bg px-4 py-2 text-xs leading-relaxed text-ink">
              <b className="font-mono">{x.lot_no}</b> 반납{' '}
              <b className="tnum">{Number(x.returned)}</b> {x.usage_uom} · 이 배치에서 원 로트로 되돌림
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function StartCard({ woId, day, op, people, productLots, attempt, done }: {
  woId: string; day: number; op: Op; people: PersonOpt[]; productLots: PlOpt[];
  attempt: number; done: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(startRecord, {});
  const [rotation, setRotation] = useState('');
  const [lot, setLot] = useState('');
  /*
   * 설비를 하나만 걸어 둔 공정이면 눌러야 할 것이 하나뿐이라 미리 골라 둔다.
   * 장갑 낀 손으로 답이 정해진 타일을 한 번 더 누르게 만들 이유가 없다.
   */
  // 대장을 가리키는 참조를 보낸다. 코드는 DB 가 그 시점 대장에서 떠 온다
  const [equip, setEquip] = useState(
    op.equipment.length === 1 ? op.equipment[0].id : '');

  return (
    <form action={action} className="space-y-4 p-4">
      <input type="hidden" name="work_order_id" value={woId} />
      <input type="hidden" name="operation_id" value={op.id} />
      <input type="hidden" name="day_no" value={day} />
      <input type="hidden" name="attempt" value={attempt} />
      <input type="hidden" name="rotation_worker_id" value={rotation} />
      <input type="hidden" name="product_lot_id" value={lot} />
      <input type="hidden" name="equipment_ref" value={equip} />

      {done && (
        <p className="rounded-md bg-warn-bg px-3 py-2.5 text-sm leading-relaxed text-ink">
          이 공정은 이미 마감했습니다. 다시 시작하면 <b>{attempt}회차</b>로 기록됩니다.
          재작업이나 재세척일 때만 쓰십시오.
        </p>
      )}

      {op.after_cutting && (
        <div>
          <span className="label">제품 로트 (재단 이후 공정)</span>
          {productLots.length === 0 ? (
            <p className="rounded-md bg-danger-bg px-3 py-2.5 text-sm text-danger">
              아직 재단하지 않았습니다. 재단 전에는 이 공정을 기록할 수 없습니다.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {productLots.map((p) => (
                <button key={p.id} type="button" onClick={() => setLot(p.id)}
                        data-on={lot === p.id} className="tile">
                  <span className="font-mono text-base font-bold">{p.lot_no}</span>
                  <span className="text-xs text-muted">{p.item_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/*
        * 설비.
        *
        * 강제하지 않는다. 고르지 않아도 공정은 시작된다 - 차단은 S01~S05 뿐이고
        * 설비 미기록은 그중에 없다. 이 공정에 걸린 설비가 없으면 칸 자체가
        * 나오지 않는다.
        */}
      {op.equipment.length > 0 && (
        <div>
          <span className="label">설비</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {/*
              * 밸리데이션 기한이 지난 설비는 타일에 그 사실이 붙는다. 골라도
              * 기록은 진행된다 - 차단은 S01~S05 뿐이고, 검토 지원이 사용일
              * 기준으로 다시 짚는다 (§8.5). 현장에서 판단을 요구하지 않고
              * 사실을 보여 준다.
              */}
            {op.equipment.map((q) => {
              const gone = !q.valid_until || q.valid_until < todayKST();
              return (
                <button key={q.code} type="button"
                        onClick={() => setEquip((v) => (v === q.id ? '' : q.id))}
                        data-on={equip === q.id} className="tile">
                  <span className="flex items-center gap-2 font-mono text-base font-bold">
                    {q.code}
                    {gone && (
                      <span className="chip bg-danger-bg text-danger">
                        {q.valid_until ? '밸리데이션 기한 경과' : '밸리데이션 기록 없음'}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {q.name}
                    {q.valid_until && !gone && <> · 밸리데이션 만료 {q.valid_until}</>}
                    {q.valid_until && gone && <> · 만료 {q.valid_until}</>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/*
        * 순환자.
        *
        * 사람이 몇 안 되면 타일이 낫다. 한 번 눌러 고르고 무엇이 골라졌는지
        * 한눈에 보인다. 그런데 사람이 늘면 타일이 화면을 덮어 정작 아래의
        * 시작 단추가 밀려 내려간다 (사용자 지적).
        *
        * 그래서 넘어가면 목록으로 바꾼다. 태블릿에서 목록을 누르면 전체 화면
        * 고르개가 떠서 손가락으로도 고르기 쉽다. 어느 쪽이든 고르지 않으면
        * 없음이다 - 순환자는 원래 없을 수 있는 자리다 (§11 "공정당 0~1명").
        */}
      <div>
        <span className="label">순환자 (고르지 않으면 없음)</span>
        {people.length > ROTATION_TILE_MAX ? (
          <select
            value={rotation}
            onChange={(e) => setRotation(e.target.value)}
            className="input text-base"
            aria-label="순환자"
          >
            <option value="">없음</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" onClick={() => setRotation('')}
                    data-on={rotation === ''} className="tile items-center text-center">
              <span className="text-sm font-semibold">없음</span>
            </button>
            {people.map((p) => (
              <button key={p.id} type="button" onClick={() => setRotation(p.id)}
                      data-on={rotation === p.id} className="tile items-center text-center">
                <span className="text-sm font-semibold">{p.full_name}</span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted">
          순환자는 서명하지 않습니다. 이름만 기록서에 나옵니다.
        </p>
      </div>

      <Msg state={state} />

      <button type="submit" disabled={pending || (op.after_cutting && !lot)}
              className="btn-primary h-14 w-full text-base">
        {pending ? '시작하는 중' : `${op.name} 시작`}
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function RunningCard({ woId, op, rec, lots, sheets }: {
  woId: string; op: Op; rec: Rec; lots: LotOpt[]; sheets: number;
}) {
  const [tab, setTab] = useState<'material' | 'end'>('material');
  const recorded = new Set(rec.issues.map((x) => x.item_id));
  const missing = op.bom.filter((b) => !recorded.has(b.item_id));

  return (
    <div>
      {/* 장갑 낀 손이 누른다. 전환 단추도 조작 대상이므로 --tap 을 그대로 받는다 */}
      <div className="grid grid-cols-2 gap-1 border-b border-line p-2">
        {(['material', 'end'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
                  aria-pressed={tab === t}
                  className={`no-select flex h-[var(--tap)] items-center justify-center gap-2 rounded-md text-base font-bold transition-colors ${
                    tab === t
                      ? 'bg-brand-tint text-brand'
                      : 'text-muted hover:bg-surface-sub'
                  }`}>
            {t === 'material' ? '자재 투입' : '공정 마감'}
            {t === 'material' && rec.issues.length > 0 && (
              <span className="chip bg-brand text-white">{rec.issues.length}</span>
            )}
            {t === 'end' && missing.length > 0 && (
              <span className="chip bg-warn-bg text-warn">자재 {missing.length}종 남음</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'material' ? (
        <MaterialForm woId={woId} rec={rec} op={op} lots={lots} sheets={sheets} />
      ) : (
        <EndForm woId={woId} rec={rec} op={op} missing={missing} />
      )}
    </div>
  );
}

function MaterialForm({ woId, rec, op, lots, sheets }: {
  woId: string; rec: Rec; op: Op; lots: LotOpt[]; sheets: number;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(issueMaterial, {});
  const [lotId, setLotId] = useState('');

  const bomItems = new Set(op.bom.map((b) => b.item_id));
  const pool = lots.filter((l) => bomItems.size === 0 || bomItems.has(l.item_id));
  const lot = pool.find((l) => l.id === lotId);
  const bom = op.bom.find((b) => b.item_id === lot?.item_id);
  const need = bom?.required ? Number(bom.required) : null;

  if (pool.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted">
        이 공정에 넣을 수 있는 자재 로트가 없습니다. 관리자에게 입고를 요청하십시오.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4 p-4">
      <input type="hidden" name="work_order_id" value={woId} />
      <input type="hidden" name="process_record_id" value={rec.id} />
      <input type="hidden" name="material_lot_id" value={lotId} />

      <div>
        <span className="label">자재 로트</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {pool.map((l) => (
            <button key={l.id} type="button" onClick={() => setLotId(l.id)}
                    data-on={lotId === l.id} className="tile">
              <span className="font-mono text-base font-bold">{l.lot_no}</span>
              <span className="text-xs text-muted">
                {l.item_name} · 잔여 <span className="tnum">{Number(l.qty_available)}</span> {l.usage_uom}
              </span>
            </button>
          ))}
        </div>
      </div>

      {lot && (
        <NumPad
          /*
           * 로트를 고를 때마다 패드를 새로 만든다. key 가 없으면 앞 로트의
           * 예상값이 그대로 남아 다음 자재에 딸려 들어간다.
           */
          key={lot.id}
          name="qty"
          label={`투입 수량 (${lot.usage_uom})`}
          unit={lot.usage_uom}
          max={Number(lot.qty_available)}
          /*
           * 자재 구성표에서 계산한 예상 소요량을 미리 채운다. 장갑 낀 손으로
           * 같은 숫자를 매번 찍는 일을 없앤다.
           *
           * 채워 넣은 값이지 확인된 값이 아니다. 그래서 아래에 예상값임을 그대로
           * 적어 두고, 다르면 지우고 실제 넣은 양을 적게 한다. 시스템은 둘을
           * 비교해 판정하지 않는다 (§7 "예정과 실제가 달라도 고쳐주지 않는다").
           */
          initial={need !== null ? String(need) : ''}
          hint={
            need !== null ? (
              <>
                자재 구성표 기준 장입 {sheets}장의 <b className="text-ink">예상</b> 소요량{' '}
                <b className="text-ink tnum">{need} {lot.usage_uom}</b>을 미리 채웠습니다.
                실제로 넣은 양이 다르면 고쳐 입력하십시오.
              </>
            ) : null
          }
        />
      )}

      <Msg state={state} />

      <button type="submit" disabled={pending || !lotId} className="btn-primary h-14 w-full text-base">
        {pending ? '기록하는 중' : '자재 기록'}
      </button>
    </form>
  );
}

function EndForm({ woId, rec, op, missing }: {
  woId: string; rec: Rec; op: Op;
  missing: { item_code: string; item_name: string }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(endRecord, {});
  const [confirm, setConfirm] = useState(false);

  return (
    <form action={action} className="space-y-4 p-4">
      <input type="hidden" name="work_order_id" value={woId} />
      <input type="hidden" name="process_record_id" value={rec.id} />

      {missing.length > 0 && (
        <div className="rounded-md border border-warn/30 bg-warn-bg p-3">
          <p className="text-sm font-bold text-ink">아직 기록하지 않은 자재가 있습니다</p>
          <ul className="mt-1.5 space-y-0.5 text-sm text-ink">
            {missing.map((m) => (
              <li key={m.item_code}>· {m.item_name} ({m.item_code})</li>
            ))}
          </ul>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            자재를 기록하거나, 아래에서 해당 없음 사유를 선택하십시오. 둘 다 없으면 마감되지 않습니다.
          </p>
        </div>
      )}

      {missing.length > 0 && (
        <PresetPicker name="no_material_reason" label="해당 없음 사유" presets={REASONS} />
      )}

      {op.name.includes('포장') && (
        <NumPad name="rework_qty" label="재포장 수량 (없으면 비워 둡니다)"
                allowDecimal={false} />
      )}

      <Msg state={state} />

      {!confirm ? (
        <button type="button" onClick={() => setConfirm(true)}
                className="btn-primary h-14 w-full text-base">
          공정 마감
        </button>
      ) : (
        <div className="space-y-3">
          <p className="rounded-md bg-canvas px-3 py-2.5 text-sm leading-relaxed text-ink">
            <b>{op.name}</b>을 마감합니다. 종료 시각이 지금으로 찍힙니다.
            마감 후에도 일차를 마감하기 전이면 자재를 더 넣을 수 있습니다.
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary h-14 flex-1 text-base">
              {pending ? '마감하는 중' : '마감한다'}
            </button>
            <button type="button" onClick={() => setConfirm(false)}
                    className="btn-ghost h-14 flex-1 text-base">
              취소
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function CloseDayCard({ woId, day, batchNo, open }: {
  woId: string; day: number; batchNo: string; open: number;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(closeDay, {});
  const [confirm, setConfirm] = useState(false);

  return (
    <section className="card border-brand-line p-4">
      <h2 className="text-base font-bold text-ink">{day}일차 마감</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        마감하면 제조기록서가 발행되고 <b className="text-ink">이 묶음은 더 이상 수정할 수 없습니다.</b>
        {' '}잠금을 푸는 방법은 없습니다. 누락된 것은 다음 일차에 정정 기록으로 남겨야 합니다.
      </p>

      {open > 0 && (
        <p className="mt-3 rounded-md bg-warn-bg px-3 py-2.5 text-sm text-ink">
          아직 마감하지 않은 공정이 <b className="tnum">{open}</b>건 있습니다.
          마감하지 않은 공정은 종료 시각이 빈 채로 인쇄됩니다.
        </p>
      )}

      <Msg state={state} />

      {!confirm ? (
        <button onClick={() => setConfirm(true)} className="btn-ghost mt-4 h-14 w-full text-base">
          {day}일차 마감하고 기록서 발행
        </button>
      ) : (
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="work_order_id" value={woId} />
          <input type="hidden" name="day_no" value={day} />
          <p className="rounded-md border border-danger/25 bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-ink">
            배치 <b className="font-mono">{batchNo}</b>의 <b>{day}일차</b>를 마감합니다.
            되돌릴 수 없습니다.
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary h-14 flex-1 text-base">
              {pending ? '마감하는 중' : '마감한다'}
            </button>
            <button type="button" onClick={() => setConfirm(false)}
                    className="btn-ghost h-14 flex-1 text-base">
              취소
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------------
   재단 결과 (현장)

   여기가 배치가 갈라지는 자리다. 재단 전에는 배치 하나가 통째로 흐르고, 재단
   뒤에는 형명별 제품 로트가 각각 흐른다 (§3 ①). 그 갈라짐을 만드는 사람이
   잘라 낸 작업자이므로, 세어 본 수를 그 자리에서 적는다.

   ── 화면이 답해 주는 것 ───────────────────────────────────────────────────
   · 고를 형명은 이 배치의 두께 구간 것뿐이다 - 두께는 원재료가 정한다 (§3 ③)
   · 샘플을 몇 개 빼야 하는지는 제품표준서에 적힌 값을 그대로 보여 준다
   · 출하 가능 수량이 몇 개가 되는지 적는 동안 계속 보인다
   · 이미 부여한 제조번호와 그 수량이 위에 쌓인다

   샘플 수를 시스템이 정하지 않는다. 검사 기준이 정하고 제품표준서에 옮겨 적힌
   값을 읽어 올 뿐이다. 등록된 값이 없으면 아무것도 안내하지 않는다 (§1).
--------------------------------------------------------------------------- */
function CutPanel({ woId, finished, lots, sampleTiers, sampleBasis, band }: {
  woId: string; finished: FinOpt[]; lots: PlOpt[];
  sampleTiers: SampleTier[]; sampleBasis: string | null; band: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(cutAtField, {});
  const [item, setItem] = useState('');
  const [produced, setProduced] = useState('');
  const [sample, setSample] = useState('');
  /* 사람이 직접 시료 수를 고쳤는가. 고쳤으면 그 값을 덮어쓰지 않는다 */
  const [touched, setTouched] = useState(false);

  const made = lots.reduce((a, l) => a + (l.qty_produced ?? 0), 0);
  const picked = finished.find((f) => f.id === item);

  /*
   * 생산 수량이 드는 구간을 찾는다. DB 의 required_sample() 과 같은 규칙이다 -
   * 겹치는 구간이 있어도 시작값이 큰 쪽이 이겨 답이 하나로 정해진다.
   * 여기 값은 안내와 미리 채우기에만 쓰고, 기록되는 건 사람이 적은 값이다.
   */
  const n = Number(produced || 0);
  const needTier = n > 0
    ? [...sampleTiers]
        .sort((a, b) => b.min_qty - a.min_qty)
        .find((t) => n >= t.min_qty && (t.max_qty === null || n <= t.max_qty)) ?? null
    : null;
  const need = needTier?.sample_qty ?? null;

  // 사람이 손대기 전까지는 구간이 정한 수를 따라간다
  const shown = touched ? sample : (need === null ? '' : String(need));
  const avail = Math.max(0, n - Number(shown || 0));

  return (
    <div className="border-t border-line bg-canvas p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-bold text-ink">재단 결과</h3>
        <p className="text-xs leading-relaxed text-muted">
          형명별로 몇 장이 나왔는지 적으면 제조번호가 붙습니다.
          {band && <> 이 배치의 두께 구간은 <b className="text-ink">{band}</b> 입니다.</>}
        </p>
      </div>

      {/* 이미 부여한 것부터 보여 준다. 같은 형명을 두 번 적지 않게 한다 */}
      {lots.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {lots.map((l) => (
            <li key={l.id}
                className="flex flex-wrap items-baseline gap-x-3 rounded-md border border-line bg-surface px-3 py-2">
              <span className="font-mono text-base font-bold text-ink">{l.lot_no}</span>
              <span className="text-sm text-body">{l.item_code}</span>
              <span className="ml-auto text-sm text-muted">
                생산 <b className="tnum text-ink">{l.qty_produced ?? 0}</b>
                {(l.qty_sample ?? 0) > 0 && <> · 샘플 <b className="tnum text-ink">{l.qty_sample}</b></>}
              </span>
            </li>
          ))}
          <li className="px-3 pt-1 text-sm text-muted">
            지금까지 <b className="tnum text-ink">{made}</b>개를 재단했습니다.
          </li>
        </ul>
      )}

      {finished.length === 0 ? (
        <p className="mt-3 rounded-md bg-warn-bg px-3 py-2.5 text-sm leading-relaxed text-ink">
          이 두께 구간({band ?? '미기재'})에 해당하는 형명이 없습니다.
          관리자 화면에서 형명을 확인하십시오.
        </p>
      ) : (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="work_order_id" value={woId} />
          <input type="hidden" name="item_id" value={item} />

          <div>
            <span className="label">형명</span>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {finished.map((f) => {
                const already = lots.some((l) => l.item_code === f.code);
                return (
                  <button key={f.id} type="button" onClick={() => setItem(f.id)}
                          data-on={item === f.id} className="tile">
                    <span className="font-mono text-base font-bold">{f.code}</span>
                    <span className="text-xs text-muted">
                      {f.name}{already && ' · 이미 부여함'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">생산 수량</label>
              <input name="qty_produced" type="number" min={1} required inputMode="numeric"
                     value={produced} onChange={(e) => setProduced(e.target.value)}
                     className="input tnum text-lg" />
            </div>
            <div>
              <label className="label">샘플 수량</label>
              <input name="qty_sample" type="number" min={0} inputMode="numeric"
                     value={shown}
                     onChange={(e) => { setTouched(true); setSample(e.target.value); }}
                     className="input tnum text-lg" />
            </div>
            <div>
              <label className="label">제조일</label>
              {/*
                * 한국 시각으로 오늘이다.
                *
                * 전에는 toISOString().slice(0,10) 을 썼는데 그건 UTC 날짜다.
                * 아침 9시 이전에 재단하면 전날이 기본값으로 들어갔고, 그 값이
                * 제조일과 유효기한으로 굳었다. 0052 가 둘을 불변으로 만들어
                * 두어 사후 정정도 안 된다 (2차 검수 결함 8).
                *
                * 3인 현장은 8시에 시작한다. 아침 재단은 드문 일이 아니다.
                */}
              <input name="manufactured_on" type="date"
                     defaultValue={todayKST()}
                     className="input tnum" />
            </div>
          </div>

          {/*
            * 뽑아야 할 시료 수는 검사기준서의 구간표가 정한다. 여기서는 지금 적은
            * 생산 수량이 드는 구간을 찾아 그 수와 근거를 그대로 읽어 준다.
            * 드는 구간이 없으면 아무것도 적지 않는다 - 잘못된 수를 안내하는 것보다
            * 안내하지 않는 편이 낫다 (§1).
            */}
          {need !== null ? (
            <p className="text-sm leading-relaxed text-muted">
              생산 <b className="tnum text-ink">{Number(produced)}</b>개는{' '}
              <b className="tnum text-ink">{needTier!.min_qty}~{needTier!.max_qty ?? ''}</b> 구간이라
              시료 <b className="tnum text-ink">{need}</b>개를 출력합니다.
              {sampleBasis && <span className="text-faint"> ({sampleBasis})</span>}
              {touched && Number(sample || 0) !== need && (
                <b className="text-warn"> 지금 적은 값은 {Number(sample || 0)}개입니다.</b>
              )}
            </p>
          ) : sampleTiers.length > 0 && Number(produced || 0) > 0 ? (
            <p className="text-sm leading-relaxed text-muted">
              생산 {Number(produced)}개가 드는 시료 구간이 등록되어 있지 않습니다.
              시료 수는 검사기준서를 보고 입력하십시오.
            </p>
          ) : null}

          <p className="text-sm leading-relaxed text-muted">
            {picked && <><b className="font-mono text-ink">{picked.code}</b> · </>}
            출하 가능 수량은 <b className="tnum text-ink">{avail}</b>개가 됩니다.
            샘플은 생산 수량에서 빠지며 회수되어도 복귀하지 않습니다.
            유효기한은 지금 시점의 사용기간으로 고정됩니다.
          </p>

          <Msg state={state} />
          <button type="submit" disabled={pending || !item} className="btn-primary w-full sm:w-auto">
            {pending ? '부여하는 중' : '제조번호 부여'}
          </button>
        </form>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   투입한 자재 한 줄

   평소에는 그냥 읽는 줄이다. 잘못 적었을 때만 눌러서 편다.

   ── 왜 지우지 않는가 ──────────────────────────────────────────────────────
   이 시스템에는 삭제가 없다 (§1). 종이가 정본이고, 종이에서는 잘못 적은 줄을
   지우지 않고 한 줄 긋고 정정자와 사유를 적는다. 여기서도 같다 - 원래 값은
   감사추적에 남고 정정 사유는 기록지에 함께 찍힌다.

   두 가지 길을 준다. 무엇이 잘못됐는지가 다르기 때문이다.

     수량이 틀림      그 줄의 수량을 고친다. 재고가 차액만큼 움직인다
     넣지 말았어야 함 원 로트로 반납한다. 줄은 남고 재고가 돌아온다

   수량을 0 으로 만들어 없앤 셈 치지 않는다. 0 인 투입 줄은 "안 넣었다"와
   "넣었다가 물렀다"를 구분하지 못한다.
--------------------------------------------------------------------------- */
function IssueRow({ woId, x, locked }: {
  woId: string;
  x: Rec['issues'][number];
  locked: boolean;
}) {
  const [mode, setMode] = useState<null | 'amend' | 'return'>(null);
  const [aState, aAction, aPending] = useActionState<FormState, FormData>(amendIssue, {});
  const [rState, rAction, rPending] = useActionState<FormState, FormData>(returnIssue, {});

  /* 고쳐지면 스스로 닫힌다. 열린 채로 두면 한 번 더 눌러 두 번 움직인다 */
  const done = aState.ok || rState.ok;
  useEffect(() => { if (done) setMode(null); }, [done]);

  return (
    <div className="border-b border-line-soft last:border-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{x.item_name}</span>
        <span className="font-mono text-sm text-muted">{x.lot_no}</span>
        <span className="tnum text-base font-bold text-ink">
          {Number(x.qty)} {x.usage_uom}
        </span>
        {!locked && (
          <button type="button" onClick={() => setMode(mode ? null : 'amend')}
                  className="btn-quiet h-9 px-3 text-xs">
            {mode ? '닫기' : '정정'}
          </button>
        )}
      </div>

      {/* 이미 고친 줄이면 그 사실을 적는다. 기록지에도 같이 나간다 */}
      {x.amend_reason && (
        <p className="px-4 pb-2 text-xs leading-relaxed text-warn">
          정정함 · {x.amend_reason}
        </p>
      )}

      <Dialog
        open={!!mode}
        onClose={() => setMode(null)}
        wide
        title="투입 정정"
        note={<>{x.item_name} · <span className="font-mono">{x.lot_no}</span> ·{' '}
          <span className="tnum">지금 {Number(x.qty)} {x.usage_uom}</span></>}
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode('amend')} data-on={mode === 'amend'}
                  className="tile w-auto flex-1 items-center py-3 text-center">
            <span className="text-base font-bold">수량을 잘못 적음</span>
            <span className="text-xs text-muted">수량을 고칩니다</span>
          </button>
          <button type="button" onClick={() => setMode('return')} data-on={mode === 'return'}
                  className="tile w-auto flex-1 items-center py-3 text-center">
            <span className="text-base font-bold">넣지 말았어야 함</span>
            <span className="text-xs text-muted">원 로트로 반납합니다</span>
          </button>
        </div>

        {/* 숫자는 숫자판으로, 사유는 목록에서 고른다. 현장에는 키보드가 없다 */}
        {mode === 'return' ? (
          <form action={rAction} className="mt-4 space-y-4">
            <input type="hidden" name="id" value={x.id} />
            <input type="hidden" name="work_order_id" value={woId} />
            <NumPad name="qty" label="반납 수량" unit={x.usage_uom}
                    initial={String(Number(x.qty))} max={Number(x.qty)} />
            <PresetPicker name="reason" label="반납 사유"
                          presets={RETURN_REASONS} allowNone={false} />
            <p className="text-sm leading-relaxed text-muted">
              투입 기록은 그대로 남고 반납이 따로 적힙니다. 개봉해서 되돌릴 수
              없는 자재는 반납이 아니라 폐기로 처리해야 합니다.
            </p>
            <Msg state={rState} />
            <button type="submit" disabled={rPending} className="btn-primary w-full">
              {rPending ? '반납하는 중' : '반납한다'}
            </button>
          </form>
        ) : (
          <form action={aAction} className="mt-4 space-y-4">
            <input type="hidden" name="id" value={x.id} />
            <input type="hidden" name="work_order_id" value={woId} />
            <NumPad name="qty" label="맞는 수량" unit={x.usage_uom}
                    initial={String(Number(x.qty))} />
            <PresetPicker name="reason" label="정정 사유"
                          presets={AMEND_REASONS} allowNone={false} />
            <Msg state={aState} />
            <button type="submit" disabled={aPending} className="btn-primary w-full">
              {aPending ? '정정하는 중' : '정정한다'}
            </button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
