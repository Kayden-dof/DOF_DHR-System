'use client';

import { useActionState, useState } from 'react';
import { MOVEMENT_TYPES, MOVEMENT_REASONS, type FormState } from '@/lib/forms';
import { Msg } from '@/components/ui';
import { moveStock, makeSolution } from '../actions';

export interface LotOpt {
  id: string; lot_no: string; item_code: string; item_name: string;
  usage_uom: string; qty_available: string;
}
export interface WoOpt { id: string; batch_no: string; wo_no: string }

/* ---------------------------------------------------------------------------
   재고 증감 (§4.7)

   반납은 원 로트로 복귀시킨다. 성적서와의 연결을 유지하기 위함이다.
   개봉 후 반납이 안 되는 건은 공정 폐기로 처리한다.
--------------------------------------------------------------------------- */
export function MovementForm({ lots, orders }: { lots: LotOpt[]; orders: WoOpt[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(moveStock, {});
  const [type, setType] = useState('RETURN');
  const [lotId, setLotId] = useState('');
  const lot = lots.find((l) => l.id === lotId) ?? lots[0];
  const meta = MOVEMENT_TYPES.find((m) => m.code === type);
  const needsWo = type === 'DISPOSAL_WIP';

  return (
    <form action={action} className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="label">자재 로트</label>
          <select name="material_lot_id" required value={lot?.id ?? ''}
                  onChange={(e) => setLotId(e.target.value)} className="input">
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.lot_no} · {l.item_name} (잔여 {Number(l.qty_available)} {l.usage_uom})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">유형</label>
          <select name="type" value={type} onChange={(e) => setType(e.target.value)}
                  className="input">
            {MOVEMENT_TYPES.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">
            수량 {type === 'ADJUSTMENT' ? '(늘리면 +, 줄이면 -)' : `(${lot?.usage_uom ?? ''})`}
          </label>
          <input name="qty" type="number" step="any" required className="input tnum" />
        </div>

        <div>
          <label className="label">사유</label>
          <select name="reason_code" className="input">
            {MOVEMENT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className={needsWo ? '' : 'lg:col-span-3'}>
          <label className="label">상세</label>
          <input name="reason_detail" autoComplete="off" className="input" />
        </div>
        {needsWo && (
          <div className="lg:col-span-2">
            <label className="label">작업지시 (공정 폐기는 필수)</label>
            <select name="work_order_id" required className="input">
              {orders.map((o) => (
                <option key={o.id} value={o.id}>{o.batch_no} · {o.wo_no}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
        {meta?.note}
        {type === 'RETURN' &&
          ' 개봉 후 반납이 안 되는 건은 공정 폐기로 처리하십시오.'}
      </p>

      <Msg state={state} />
      <div className="mt-3">
        <button type="submit" disabled={pending || lots.length === 0} className="btn-primary">
          기록
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------------
   용액 제조 (§4.7)

   20X PBS와 30% 에탄올 희석액은 당일 제조 · 당일 폐기라 로트를 만들지 않는다.
   원료가 차감되는 것만 기록한다.
--------------------------------------------------------------------------- */
export function SolutionForm({ lots }: { lots: LotOpt[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(makeSolution, {});
  const [rows, setRows] = useState([0, 1, 2, 3]);

  return (
    <form action={action} className="p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">제조한 용액</label>
          <input name="name" required autoComplete="off" placeholder="20X PBS"
                 className="input" />
        </div>
        <div>
          <label className="label">비고</label>
          <input name="note" autoComplete="off" className="input" />
        </div>
      </div>

      <p className="label mt-4">차감할 원료</p>
      <div className="space-y-2">
        {rows.map((i) => (
          <div key={i} className="flex gap-2">
            <select name={`lot_${i}`} className="input flex-1 text-xs">
              <option value="">사용 안 함</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lot_no} · {l.item_name} (잔여 {Number(l.qty_available)} {l.usage_uom})
                </option>
              ))}
            </select>
            <input name={`qty_${i}`} type="number" step="any" min="0"
                   placeholder="수량" className="input w-32 tnum text-xs" />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setRows((r) => [...r, r.length])}
              className="btn-quiet mt-2 h-8 px-2 text-xs">
        원료 줄 추가
      </button>

      <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
        당일 제조 · 당일 폐기이므로 용액 자체의 로트는 만들지 않습니다.
        원료가 얼마나 빠졌는지만 기록으로 남습니다.
      </p>

      <Msg state={state} />
      <div className="mt-3">
        <button type="submit" disabled={pending || lots.length === 0} className="btn-primary">
          제조 기록
        </button>
      </div>
    </form>
  );
}
