'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import type { FormState } from '@/lib/forms';
import { fmtDateTime } from '@/lib/fmt';
import { Msg, Tag } from '@/components/ui';
import NumPad, { PresetPicker } from '@/components/num-pad';
import { startRecord, issueMaterial, endRecord, closeDay } from '../actions';

/** KST 오늘. 만료 비교는 날짜 문자열끼리 한다 */
function todayStr(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
}

export interface Op {
  id: string; seq: number; code: string; name: string; after_cutting: boolean;
  bom: { item_id: string; item_code: string; item_name: string; usage_uom: string;
         basis: string; required: string | null }[];
  /** 이 공정에 걸린 설비. 비어 있으면 화면에 칸이 나오지 않는다 */
  equipment: { code: string; name: string; valid_until: string | null }[];
}
export interface Rec {
  id: string; operation_id: string; day_no: number; attempt: number;
  product_lot_id: string | null; product_lot_no: string | null;
  started_at: Date | null; ended_at: Date | null;
  equipment_id: string | null; rework_qty: number | null; no_material_reason: string | null;
  worker_id: string; worker_name: string;
  issues: { item_id: string; item_code: string; item_name: string;
            lot_no: string; qty: string; usage_uom: string }[];
}
export interface LotOpt {
  id: string; lot_no: string; item_id: string; item_code: string; item_name: string;
  usage_uom: string; qty_available: string; expiry_date: string | null;
}
export interface PersonOpt { id: string; full_name: string }
export interface PlOpt { id: string; lot_no: string; item_code: string; item_name: string }

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
}: {
  woId: string; batchNo: string; sheets: number;
  ops: Op[]; records: Rec[]; lots: LotOpt[]; people: PersonOpt[];
  productLots: PlOpt[]; meId: string; lockedDays: number[];
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
            <b>{day}일차는 마감되었습니다.</b> 기록서를 인쇄했으므로 더 이상 고칠 수 없습니다.
            빠뜨린 것은 다음 일차에 정정 기록으로 남기십시오.
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
      {op && (
        <OperationCard
          woId={woId} day={day} op={op} rec={rec} lots={lots} people={people}
          productLots={productLots} locked={locked} sheets={sheets}
          attemptCount={dayRecords.filter((r) => r.operation_id === op.id).length}
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
}: {
  woId: string; day: number; op: Op; rec: Rec | null; lots: LotOpt[];
  people: PersonOpt[]; productLots: PlOpt[]; locked: boolean; sheets: number;
  attemptCount: number;
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

      {rec && rec.issues.length > 0 && (
        <div className="border-t border-line">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">투입 자재</th>
                <th className="th">로트번호</th>
                <th className="th text-right">수량</th>
              </tr>
            </thead>
            <tbody>
              {rec.issues.map((x, i) => (
                <tr key={i}>
                  <td className="td">{x.item_name}</td>
                  <td className="td font-mono text-sm">{x.lot_no}</td>
                  <td className="td tnum text-right font-semibold">
                    {Number(x.qty)} {x.usage_uom}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
  const [equip, setEquip] = useState(
    op.equipment.length === 1 ? op.equipment[0].code : '');

  return (
    <form action={action} className="space-y-4 p-4">
      <input type="hidden" name="work_order_id" value={woId} />
      <input type="hidden" name="operation_id" value={op.id} />
      <input type="hidden" name="day_no" value={day} />
      <input type="hidden" name="attempt" value={attempt} />
      <input type="hidden" name="rotation_worker_id" value={rotation} />
      <input type="hidden" name="product_lot_id" value={lot} />
      <input type="hidden" name="equipment_id" value={equip} />

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
              const gone = !q.valid_until || q.valid_until < todayStr();
              return (
                <button key={q.code} type="button"
                        onClick={() => setEquip((v) => (v === q.code ? '' : q.code))}
                        data-on={equip === q.code} className="tile">
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

      <div>
        <span className="label">순환자 (없으면 비워 둡니다)</span>
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
                실제로 넣은 양이 다르면 고쳐 적으십시오.
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
            자재를 기록하거나, 아래에서 해당 없음 사유를 고르십시오. 둘 다 없으면 마감되지 않습니다.
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
              그만두기
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
        마감하면 제조기록서가 발행되고 <b className="text-ink">이 묶음은 더 이상 고칠 수 없습니다.</b>
        {' '}잠금을 푸는 방법은 없습니다. 빠뜨린 것은 다음 일차에 정정 기록으로 남겨야 합니다.
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
              그만두기
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
