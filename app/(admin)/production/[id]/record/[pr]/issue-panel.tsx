'use client';

import { useActionState, useId } from 'react';
import { Msg } from '@/components/ui';
import type { FormState } from '@/lib/forms';
import { addForcedIssue } from '../../../record-actions';

export type IssueLot = { id: string; item: string; lot_no: string; left: string; uom: string; outside: boolean };

/* 투입 더하기 (관리자 정정 · 0165) -  투입 한 줄을 더한다 */
export default function IssuePanel({ recordId, woId, lots }: {
  recordId: string; woId: string; lots: IssueLot[];
}) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(
    addForcedIssue.bind(null, recordId, woId), {});
  return (
    <section className="card space-y-3 py-4">
      <div>
        <h2 className="text-base font-semibold text-ink">투입 더하기 (관리자 정정)</h2>
        <p className="mt-0.5 text-sm text-muted">
          종이 기록서에는 쓴 자재가 적혀 있는데 투입이 없어 재고가 그대로일 때 더합니다.
        </p>
      </div>
      <form action={action} className="space-y-3">
        <div>
          <label className="label" htmlFor={`${uid}-lot`}>자재 로트</label>
          <select id={`${uid}-lot`} name="material_lot_id" required defaultValue=""
                  disabled={lots.length === 0} className="input">
            <option value="" disabled>
              {lots.length === 0 ? '쓸 수 있는 로트가 없습니다' : '로트를 고르십시오'}
            </option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>{l.item} · {l.lot_no} · 잔여 {l.left} {l.uom}{l.outside ? ' · 구성표 밖' : ''}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor={`${uid}-qty`}>수량 (사용 단위)</label>
            <input id={`${uid}-qty`} name="qty" type="number" step="any" min="0" required
                   inputMode="decimal" className="input tnum" />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-why`}>사유</label>
            <input id={`${uid}-why`} name="why" required autoComplete="off"
                   placeholder="예: 종이 기록서에 0.8 L 적혀 있음" className="input" />
          </div>
        </div>
        <Msg state={state} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending || lots.length === 0} className="btn-primary">
            투입 더하기
          </button>
          <span className="text-sm text-muted">
            잠긴 일차여도 더합니다. 재고에서 빠지고 정정 내역에 남습니다. 인쇄된 종이는 바뀌지 않습니다.
          </span>
        </div>
      </form>
    </section>
  );
}
