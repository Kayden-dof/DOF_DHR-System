'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg } from '@/components/ui';
import { createOrder, cancelOrder } from '../actions';

export interface OrderRow {
  id: string; po_no: string; qty: string; unit_price: string | null;
  ordered_at: string; expected_at: string | null; status: string;
  item_code: string; item_name: string; usage_uom: string;
  supplier_name: string; ordered_by_name: string; lot_count: number;
}
export interface ItemOpt { id: string; code: string; name: string; usage_uom: string; type: string }
export interface SupplierOpt { id: string; name: string; status: string }

function New({ items, suppliers, today }: {
  items: ItemOpt[]; suppliers: SupplierOpt[]; today: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createOrder, {});
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const item = items.find((i) => i.id === itemId) ?? items[0];

  if (!open) return <button onClick={() => setOpen(true)} className="btn-primary">발주 등록</button>;

  return (
    <form action={action} className="card p-4">
      <h3 className="mb-3 text-sm font-bold text-ink">새 발주</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">발주번호</label>
          <input name="po_no" required autoComplete="off" placeholder="PO-2026-001"
                 className="input font-mono" />
        </div>
        <div className="lg:col-span-2">
          <label className="label">품목</label>
          <select name="item_id" required value={item?.id ?? ''}
                  onChange={(e) => setItemId(e.target.value)} className="input">
            {items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">공급자</label>
          <select name="supplier_id" required className="input">
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.status !== 'APPROVED' ? ' (미승인)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">수량 ({item?.usage_uom})</label>
          <input name="qty" type="number" step="any" min="0.0001" required className="input tnum" />
        </div>
        <div>
          <label className="label">단가</label>
          <input name="unit_price" type="number" step="any" min="0" className="input tnum" />
        </div>
        <div>
          <label className="label">발주일</label>
          <input name="ordered_at" type="date" defaultValue={today} required className="input tnum" />
        </div>
        <div>
          <label className="label">입고 예정일</label>
          <input name="expected_at" type="date" className="input tnum" />
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        수량은 사용 단위 기준입니다. 입고 등록에서 이 발주를 고르면 자동으로 입고 완료로 넘어갑니다.
      </p>
      <Msg state={state} />
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">등록</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
    </form>
  );
}

function Cancel({ id, poNo }: { id: string; poNo: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(cancelOrder, {});
  const [ask, setAsk] = useState(false);

  if (state.ok) return <span className="text-xs text-ok">취소됨</span>;
  if (!ask) {
    return (
      <button onClick={() => setAsk(true)} className="btn-quiet h-8 px-2 text-xs">취소</button>
    );
  }
  return (
    <form action={action} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-muted">{poNo} 취소?</span>
      <button type="submit" disabled={pending} className="btn-danger h-8 px-2 text-xs">예</button>
      <button type="button" onClick={() => setAsk(false)} className="btn-quiet h-8 px-2 text-xs">
        아니오
      </button>
      <Msg state={state} />
    </form>
  );
}

const OrderForms = { New, Cancel };
export default OrderForms;
