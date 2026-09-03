'use client';

import { useActionState, useState, useId } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import { createOrder, cancelOrder } from '../actions';

export interface OrderRow {
  id: string; po_no: string; qty: string; unit_price: string | null;
  ordered_at: string; expected_at: string | null; status: string;
  item_code: string; item_name: string; usage_uom: string;
  supplier_name: string; ordered_by_name: string; lot_count: number;
}
export interface ItemOpt {
  id: string; code: string; name: string; usage_uom: string; type: string;
  /** 품목이 정해 둔 기본 공급자. 고르면 그쪽으로 따라간다 (6차 감사 N7) */
  default_supplier_id: string | null;
}
export interface SupplierOpt { id: string; name: string; status: string }

// 'use client' 모듈은 함수만 서버 경계를 넘는다. 컴포넌트를 객체로 묶어
// 내보내면 서버 쪽에서 undefined 가 되어 화면이 통째로 500 으로 죽는다.
export function NewOrder({ items, suppliers, today }: {
  items: ItemOpt[]; suppliers: SupplierOpt[]; today: string;
}) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(createOrder, {});
  const { open, setOpen } = useDialog(state);
  const [itemId, setItemId] = useState('');
  const item = items.find((i) => i.id === itemId) ?? items[0];

  /*
   * 품목을 고르면 그 품목이 정해 둔 공급자로 따라간다 (6차 감사 N7).
   *
   * 전에는 item.default_supplier_id 가 사양에만 있고 아무도 읽지 않았다.
   * 살 때마다 어디서 사는지를 사람이 다시 떠올려야 했다.
   *
   * 잠그지 않는다 - 이번만 다른 곳에서 사는 일은 있다. 처음 놓이는 값을
   * 정할 뿐이고 그대로 바꿀 수 있다.
   */
  const [supplierId, setSupplierId] = useState('');
  const picked = supplierId
    || (item?.default_supplier_id ?? '')
    || (suppliers[0]?.id ?? '');

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary">발주 등록</button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="발주 등록">
        <form action={action}>
      <h3 className="mb-3 text-sm font-bold text-ink">새 발주</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor={`${uid}-po_no`}>발주번호</label>
          <input id={`${uid}-po_no`} name="po_no" required autoComplete="off" placeholder="PO-2026-001"
                 className="input font-mono" />
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor={`${uid}-item_id`}>품목</label>
          <select id={`${uid}-item_id`} name="item_id" required value={item?.id ?? ''}
                  onChange={(e) => { setItemId(e.target.value); setSupplierId(''); }}
                  className="input">
            {items.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-supplier_id`}>공급자</label>
          <select id={`${uid}-supplier_id`} name="supplier_id" required
                  value={picked} onChange={(e) => setSupplierId(e.target.value)}
                  className="input">
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.status !== 'APPROVED' ? ' (미승인)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-qty`}>수량 ({item?.usage_uom})</label>
          <input id={`${uid}-qty`} name="qty" type="number" step="any" min="0.0001" required className="input tnum" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-unit_price`}>단가</label>
          <input id={`${uid}-unit_price`} name="unit_price" type="number" step="any" min="0" className="input tnum" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-ordered_at`}>발주일</label>
          <input id={`${uid}-ordered_at`} name="ordered_at" type="date" defaultValue={today} required className="input tnum" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-expected_at`}>입고 예정일</label>
          <input id={`${uid}-expected_at`} name="expected_at" type="date" className="input tnum" />
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        수량은 사용 단위 기준입니다. 입고 등록에서 이 발주를 선택하면 자동으로 입고 완료로 넘어갑니다.
      </p>
      <Msg state={state} />
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">등록</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
        </form>
      </Dialog>
    </>
  );
}

export function CancelOrder({ id, poNo }: { id: string; poNo: string }) {
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

