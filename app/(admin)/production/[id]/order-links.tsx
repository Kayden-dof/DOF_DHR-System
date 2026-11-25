'use client';

import { useActionState, useId } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import { linkWorkOrderLine, unlinkWorkOrderLine } from '../../shipping/orders/actions';

/* ---------------------------------------------------------------------------
   이 배치로 채우는 주문 줄 (0159 · 사용자 2026-11-25 «작업지시서를 주문줄에 걸고 … 권고»)

   비어 있으면 내부 발행이다. 출고는 여기 걸린 줄이 아니어도 나간다 (사용자 «열어놔줘»).
--------------------------------------------------------------------------- */
export interface OrderLinkRow { id: string; label: string }

export function OrderLinks({ woId, linked, options, readOnly }: {
  woId: string; linked: OrderLinkRow[]; options: OrderLinkRow[]; readOnly: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="label mb-0">주문 줄</span>
      {linked.length === 0 ? (
        <span className="text-sm text-muted">없음 (내부 발행)</span>
      ) : linked.map((l) => (
        <span key={l.id} className="inline-flex items-center gap-2 text-sm">
          <span className="font-mono">{l.label}</span>
          {!readOnly && <UnlinkButton id={l.id} woId={woId} label={l.label} />}
        </span>
      ))}
      {!readOnly && options.length > 0 && <LinkForm woId={woId} options={options} />}
    </div>
  );
}

function LinkForm({ woId, options }: { woId: string; options: OrderLinkRow[] }) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(linkWorkOrderLine, {});
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="work_order_id" value={woId} />
      <label htmlFor={`${uid}-l`} className="sr-only">걸 주문 줄</label>
      <select id={`${uid}-l`} name="sales_order_line_id" required defaultValue="" className="input w-auto">
        <option value="">주문 줄 고르기</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <button type="submit" disabled={pending} className="btn-ghost">걸기</button>
      <Msg state={state} />
    </form>
  );
}

function UnlinkButton({ id, woId, label }: { id: string; woId: string; label: string }) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(unlinkWorkOrderLine, {});
  const { open, setOpen } = useDialog(state);
  return (
    <>
      <button onClick={() => setOpen(true)} className="qd-text-action">떼기</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="주문 줄 떼기">
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="work_order_id" value={woId} />
          <p className="mb-3 font-mono text-sm">{label}</p>
          <label className="label" htmlFor={`${uid}-r`}>사유</label>
          <textarea id={`${uid}-r`} name="reason" required rows={2} className="input" />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            이 배치가 그 주문을 위한 것이라는 표시만 없어집니다. 이미 나간 출고는 그대로이고, 뗀 것은 되돌리지 않습니다.
          </p>
          <Msg state={state} />
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={pending} className="btn-danger">뗀다</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
