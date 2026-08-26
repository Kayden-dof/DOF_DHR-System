'use client';

import { useActionState, useState } from 'react';
import { PL_STATUS_LABEL, type FormState } from '@/lib/forms';
import { Msg, Caution } from '@/components/ui';
import { cutLot, setLotStatus, cancelWorkOrder, finishWorkOrder } from '../actions';

export interface LotRow {
  id: string; lot_no: string; item_code: string; item_name: string;
  qty_produced: number; qty_sample: number; qty_available: number;
  manufactured_on: string; expiry_date: string; status: string;
  location: string | null; shelf_months: number | null; shipped: number;
}
export interface FinOpt { id: string; code: string; name: string }

/* ---------------------------------------------------------------------------
   재단 분할

   한 배치는 하나의 두께 구간이므로 나올 수 있는 형명이 좁혀진다.
   제조번호는 채번 규칙이 만들고 유효기한은 이 시점 값으로 고정된다.
--------------------------------------------------------------------------- */
export function CutForm({ woId, options, today, used }: {
  woId: string; options: FinOpt[]; today: string; used: Set<string>;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(cutLot, {});
  const [produced, setProduced] = useState('');
  const [sample, setSample] = useState('0');
  const pool = options.filter((o) => !used.has(o.id));
  const avail = Math.max(0, Number(produced || 0) - Number(sample || 0));

  return (
    <form action={action} className="border-t border-line bg-canvas p-4">
      <input type="hidden" name="work_order_id" value={woId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className="label">형명</label>
          <select name="item_id" required className="input">
            {pool.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">생산 수량</label>
          <input name="qty_produced" type="number" min={1} required value={produced}
                 onChange={(e) => setProduced(e.target.value)} className="input tnum" />
        </div>
        <div>
          <label className="label">샘플 수량</label>
          <input name="qty_sample" type="number" min={0} value={sample}
                 onChange={(e) => setSample(e.target.value)} className="input tnum" />
        </div>
        <div>
          <label className="label">제조일</label>
          <input name="manufactured_on" type="date" defaultValue={today} className="input tnum" />
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted">
        출하 가능 수량은 <b className="text-ink tnum">{avail}</b>개가 됩니다.
        완제품검사 샘플은 생산 수량에서 빠지며 회수되어도 복귀하지 않습니다.
        유효기한은 지금 시점의 사용기간으로 고정되고, 나중에 사용기간이 바뀌어도
        이 로트에는 소급되지 않습니다.
      </p>

      <Msg state={state} />
      <div className="mt-3">
        <button type="submit" disabled={pending || pool.length === 0} className="btn-primary">
          제조번호 부여
        </button>
        {pool.length === 0 && (
          <span className="ml-2 text-xs text-faint">더 나눌 형명이 없습니다.</span>
        )}
      </div>
    </form>
  );
}

export function LotStatusForm({ lot, woId }: { lot: LotRow; woId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setLotStatus, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-quiet h-8 px-2 text-xs">수정</button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={lot.id} />
      <input type="hidden" name="work_order_id" value={woId} />
      <div className="w-36">
        <label className="label">상태</label>
        <select name="status" defaultValue={lot.status} className="input h-9 text-xs">
          {Object.entries(PL_STATUS_LABEL).map(([c, l]) => (
            <option key={c} value={c}>{l}</option>
          ))}
        </select>
      </div>
      <div className="w-32">
        <label className="label">보관 위치</label>
        <input name="location" defaultValue={lot.location ?? ''} className="input h-9 text-xs" />
      </div>
      <button type="submit" disabled={pending} className="btn-ghost h-9 px-3 text-xs">저장</button>
      <button type="button" onClick={() => setOpen(false)} className="btn-quiet h-9 px-2 text-xs">
        닫기
      </button>
      <div className="w-full"><Msg state={state} /></div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

export function CancelForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(cancelWorkOrder, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-danger h-9 px-3 text-xs">취소</button>;
  }

  return (
    <form action={action} className="w-full rounded-md border border-danger/30 bg-danger-bg p-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm font-semibold text-ink">작업지시를 취소합니다</p>
      <Caution>
        지시서번호와 배치번호는 소멸하며 재사용하지 않습니다. 번호가 비는 것이 정상이고,
        취소 기록이 그 설명이 됩니다.
      </Caution>
      <div className="mt-2">
        <label className="label">취소 사유</label>
        <input name="cancelled_reason" required autoComplete="off" className="input" />
      </div>
      <Msg state={state} />
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={pending} className="btn-danger h-9 px-3 text-xs">
          취소한다
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost h-9 px-3 text-xs">
          그만두기
        </button>
      </div>
    </form>
  );
}

export function FinishForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(finishWorkOrder, {});
  const [ask, setAsk] = useState(false);

  if (!ask) {
    return <button onClick={() => setAsk(true)} className="btn-ghost h-9 px-3 text-xs">배치 종료</button>;
  }

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-muted">종료하고 편철 표지를 뽑습니까?</span>
      <button type="submit" disabled={pending} className="btn-primary h-9 px-3 text-xs">종료</button>
      <button type="button" onClick={() => setAsk(false)} className="btn-quiet h-9 px-2 text-xs">
        아니오
      </button>
      <Msg state={state} />
    </form>
  );
}
