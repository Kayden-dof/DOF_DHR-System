'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import type { FormState } from '@/lib/forms';
import { fmtDateTime } from '@/lib/fmt';
import { Msg, Tag } from '@/components/ui';
import NumPad, { PresetPicker } from '@/components/num-pad';
import { startRecord, issueMaterial, endRecord, closeDay } from '../actions';

export interface Op {
  id: string; seq: number; code: string; name: string; after_cutting: boolean;
  bom: { item_id: string; item_code: string; item_name: string; usage_uom: string;
         basis: string; required: string | null }[];
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
  const days = useMemo(() => {
    const s = new Set(myRecords.map((r) => r.day_no));
    return [...s].sort((a, b) => a - b);
  }, [myRecords]);
  const nextDay = (days.at(-1) ?? 0) + 1;

  const [day, setDay] = useState(days.at(-1) ?? 1);
  const [opId, setOpId] = useState<string | null>(null);

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
          {days.map((n) => (
            <button key={n} onClick={() => { setDay(n); setOpId(null); }}
                    data-on={day === n}
                    className="tile no-select w-[6.5rem] items-center gap-0.5 text-center">
              <span className="text-xl font-bold tnum">{n}일차</span>
              <span className={`text-xs ${lockedDays.includes(n) ? 'text-ok' : 'text-muted'}`}>
                {lockedDays.includes(n)
                  ? '마감됨'
                  : `${myRecords.filter((r) => r.day_no === n).length}건`}
              </span>
            </button>
          ))}
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
          <span className="text-sm text-muted tnum">
            내 기록 {mine} / {ops.length}
          </span>
        </div>

        <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
          {ops.map((o) => {
            const st = stateOf(o);
            const others = othersOf(o);
            return (
              <button key={o.id} onClick={() => setOpId(o.id === opId ? null : o.id)}
                      data-on={o.id === opId}
                      className="tile no-select relative gap-1 pl-6">
                <span aria-hidden className={`absolute inset-y-2 left-2 w-1 rounded-full ${
                  st === 'open' ? 'bg-warn'
                    : st === 'done' ? 'bg-ok'
                    : others ? 'bg-line-strong' : 'bg-transparent'
                }`} />

                <div className="flex items-center gap-2">
                  <span className="w-5 text-center text-sm font-bold tnum text-faint">{o.seq}</span>
                  <span className="flex-1 text-base font-semibold text-ink">{o.name}</span>
                  {st === 'open' && <Tag tone="warn">진행 중</Tag>}
                  {st === 'done' && <Tag tone="ok">마감</Tag>}
                </div>

                <div className="pl-7 text-xs text-muted">
                  {o.code}
                  {o.after_cutting && ' · 제품 로트별'}
                  {o.bom.length > 0 && ` · 자재 ${o.bom.length}종`}
                </div>

                {others && st === 'none' && (
                  <div className="pl-7 text-xs text-faint">
                    {others.names} 님이 {others.days.join(' · ')}일차에 기록
                  </div>
                )}
              </button>
            );
          })}
        </div>
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

  return (
    <form action={action} className="space-y-4 p-4">
      <input type="hidden" name="work_order_id" value={woId} />
      <input type="hidden" name="operation_id" value={op.id} />
      <input type="hidden" name="day_no" value={day} />
      <input type="hidden" name="attempt" value={attempt} />
      <input type="hidden" name="rotation_worker_id" value={rotation} />
      <input type="hidden" name="product_lot_id" value={lot} />

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
      <div className="flex gap-1 border-b border-line px-4 pt-3">
        {(['material', 'end'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
                  className={`rounded-t-md px-4 py-2.5 text-sm font-semibold ${
                    tab === t ? 'bg-canvas text-ink' : 'text-muted'
                  }`}>
            {t === 'material' ? `자재 투입 ${rec.issues.length > 0 ? `(${rec.issues.length})` : ''}` : '공정 마감'}
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
          name="qty"
          label={`투입 수량 (${lot.usage_uom})`}
          unit={lot.usage_uom}
          max={Number(lot.qty_available)}
          hint={
            need !== null ? (
              <>
                자재 구성표 기준 장입 {sheets}장의 소요량은{' '}
                <b className="text-ink tnum">{need} {lot.usage_uom}</b>입니다.
                실제로 넣은 양을 그대로 적으십시오. 예정과 달라도 시스템이 고치지 않습니다.
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
