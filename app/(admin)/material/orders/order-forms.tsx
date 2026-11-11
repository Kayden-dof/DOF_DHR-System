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
  /** 그 발주로 들어온 양 (사용 단위). 0102 의 po_received */
  received: string;
}
export interface ItemOpt {
  id: string; code: string; name: string; usage_uom: string; type: string;
  /** 품목이 정해 둔 기본 공급자. 고르면 그쪽으로 따라간다 (6차 감사 N7) */
  default_supplier_id: string | null;
}
export interface SupplierOpt { id: string; name: string; status: string }

// 'use client' 모듈은 함수만 서버 경계를 넘는다. 컴포넌트를 객체로 묶어
// 내보내면 서버 쪽에서 undefined 가 되어 화면이 통째로 500 으로 죽는다.
export function NewOrder({ items, suppliers, today, presetItem, presetQty, label }: {
  items: ItemOpt[]; suppliers: SupplierOpt[]; today: string;
  /**
   * 최소 재고선 아래 줄에서 열 때 그 품목과 모자란 양 (UI/UX 검수 2026-11-11).
   * 입고 폼의 presetPo 와 같은 꼴이다 - 폼을 하나 더 만들지 않는다.
   */
  presetItem?: string;
  presetQty?: number;
  /** 단추 글씨. 줄에서는 짧게 */
  label?: string;
}) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(createOrder, {});
  const { open, setOpen } = useDialog(state);
  const [itemId, setItemId] = useState('');
  /*
   * 품목은 고르기 전까지 비워 둔다 (UI/UX 검수 2026-11-11). 전에는 목록 첫 품목이
   * 말없이 골라져 있었다. 줄에서 열면 그 줄의 품목으로 시작한다.
   */
  const item = items.find((i) => i.id === itemId);

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
    || (suppliers.find((x) => x.status === 'APPROVED')?.id ?? suppliers[0]?.id ?? '');

  /* 줄에서 열면 늘 그 품목으로 시작한다 */
  const start = () => {
    if (presetItem) { setItemId(presetItem); setSupplierId(''); }
    setOpen(true);
  };

  return (
    <>
      <button onClick={start} className={label ? 'qd-text-action' : 'btn-primary'}>
        {label ?? '발주 등록'}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="발주 등록">
        <form action={action}>
      <h3 className="mb-3 text-sm font-semibold text-ink">새 발주</h3>
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
            <option value="">선택하십시오</option>
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
                {s.name}{s.status === 'SUSPENDED' ? ' (정지)' : s.status !== 'APPROVED' ? ' (미승인)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-qty`}>수량{item ? ` (${item.usage_uom})` : ''}</label>
          <input id={`${uid}-qty`} name="qty" type="number" step="any" min="0.0001" required
                 defaultValue={presetQty && presetQty > 0 ? Number(presetQty.toFixed(6)) : undefined}
                 className="input tnum" />
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
        {presetQty && presetQty > 0 ? ' 수량은 최소 재고선까지 모자란 양으로 채웠습니다.' : ''}
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
      <button onClick={() => setAsk(true)} className="qd-text-action">취소</button>
    );
  }
  return (
    <form action={action} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-muted">{poNo} 취소?</span>
      <button type="submit" disabled={pending} className="qd-text-action qd-text-action--danger">예</button>
      <button type="button" onClick={() => setAsk(false)} className="qd-text-action">
        아니오
      </button>
      <Msg state={state} />
    </form>
  );
}

