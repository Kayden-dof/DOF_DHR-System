'use client';

import { useActionState, useMemo, useState } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import { receiveMaterial } from './actions';

export interface ItemOpt {
  id: string; code: string; name: string; type: string;
  purchase_uom: string; usage_uom: string; conversion: string;
  shelf_life_months: number | null;
}
export interface SupplierOpt { id: string; name: string; status: string }
export interface OrderOpt {
  id: string; po_no: string; item_id: string; supplier_id: string; qty: string;
  unit_price: string | null;
}

/* ---------------------------------------------------------------------------
   자재 입고 등록 (수입검사지 등록)

   관리자가 책상에서 쓰는 화면이라 키보드 입력을 그대로 둔다.
   성적서 번호는 S02로 필수이며, 로트번호는 채번 규칙이 만든다.
--------------------------------------------------------------------------- */
export default function ReceiveForm({ items, suppliers, orders, today }: {
  items: ItemOpt[]; suppliers: SupplierOpt[]; orders: OrderOpt[]; today: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(receiveMaterial, {});
  const { open, setOpen } = useDialog(state);
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('');
  const [poId, setPoId] = useState('');

  const pool = useMemo(() => items.filter((i) => i.type !== 'FIN'), [items]);
  const item = pool.find((i) => i.id === itemId) ?? pool[0];
  const conv = Number(item?.conversion ?? 1);
  const usageQty = Number(qty || 0) * conv;
  const isRaw = item?.type === 'RAW';
  const poPool = orders.filter((o) => !itemId || o.item_id === itemId);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary">자재 입고 등록</button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="자재 입고 등록">
        <form action={action}>
      <h3 className="text-sm font-bold text-ink">자재 입고</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="label">품목</label>
          <select name="item_id" required value={item?.id ?? ''}
                  onChange={(e) => setItemId(e.target.value)} className="input">
            {pool.map((i) => (
              <option key={i.id} value={i.id}>{i.code} · {i.name}</option>
            ))}
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
          <label className="label">연결할 발주</label>
          <select name="purchase_order_id" value={poId}
                  onChange={(e) => setPoId(e.target.value)} className="input">
            <option value="">연결 안 함</option>
            {poPool.map((o) => (
              <option key={o.id} value={o.id}>{o.po_no} · {Number(o.qty)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">공급자 로트번호</label>
          <input name="supplier_lot_no" required autoComplete="off" className="input font-mono" />
        </div>
        <div>
          <label className="label">성적서 번호 (필수)</label>
          <input name="coa_no" required autoComplete="off" placeholder="COA-..."
                 className="input font-mono" />
        </div>
        <div>
          <label className="label">성적서 일자</label>
          <input name="coa_date" type="date" required defaultValue={today} className="input tnum" />
        </div>
        <div>
          <label className="label">입고일</label>
          <input name="received_at" type="date" required defaultValue={today} className="input tnum" />
        </div>

        <div>
          <label className="label">입고 수량 ({item?.purchase_uom})</label>
          <input name="purchase_qty" type="number" step="any" min="0.0001" required
                 value={qty} onChange={(e) => setQty(e.target.value)} className="input tnum" />
        </div>
        <div>
          <label className="label">재고 반영 ({item?.usage_uom})</label>
          <div className="readout tnum justify-end font-semibold">
            {qty ? usageQty.toLocaleString() : ''}
          </div>
        </div>
        <div>
          <label className="label">단가 ({item?.usage_uom}당)</label>
          <input name="unit_price" type="number" step="any" min="0" className="input tnum" />
        </div>
        <div>
          <label className="label">유효기한</label>
          <input name="expiry_date" type="date" className="input tnum" />
        </div>

        <div>
          <label className="label">보관 위치</label>
          <input name="location" autoComplete="off" className="input" />
        </div>
        {isRaw && (
          <div>
            <label className="label">두께 구간</label>
            <input name="thickness_band" placeholder="0510" autoComplete="off"
                   className="input font-mono" />
            <p className="mt-1 text-xs text-faint">0.5~1.0mm 는 0510</p>
          </div>
        )}
      </div>

      {conv !== 1 && (
        <p className="mt-3 rounded-md bg-info-bg px-3 py-2 text-xs leading-relaxed text-ink">
          {item?.purchase_uom} 1개는 {item?.usage_uom} {conv}입니다.
          입고 수량을 사용 단위로 바꿔 재고에 넣습니다.
        </p>
      )}
      {isRaw && (
        <p className="mt-2 rounded-md bg-brand-soft px-3 py-2 text-xs leading-relaxed text-ink">
          원재료입니다. 여기서 넣은 <b>두께 구간</b>이 배치를 거쳐 제품 로트로 상속됩니다.
          한 배치는 하나의 두께 구간이므로 재단에서 나올 수 있는 형명이 좁혀집니다.
        </p>
      )}

      <Msg state={state} />

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? '등록 중' : '입고 등록'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
        </form>
      </Dialog>
    </>
  );
}
