'use client';

import { useActionState, useMemo, useState, useId } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg, Warnings } from '@/components/ui';
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
  /** 그 발주로 이미 들어온 양 (사용 단위). 0102 의 po_received */
  received: string;
}

/* ---------------------------------------------------------------------------
   자재 입고 등록 (수입검사지 등록)

   관리자가 책상에서 쓰는 화면이라 키보드 입력을 그대로 둔다.
   성적서 번호는 S02로 필수이며, 로트번호는 채번 규칙이 만든다.
--------------------------------------------------------------------------- */
/** 아직 안 들어온 양 (사용 단위) */
const remain = (o: OrderOpt) => Math.max(Number(o.qty) - Number(o.received ?? 0), 0);

export default function ReceiveForm({ items, suppliers, orders, today, presetPo, label }: {
  items: ItemOpt[]; suppliers: SupplierOpt[]; orders: OrderOpt[]; today: string;
  /**
   * 발주 줄에서 열 때 그 발주. 열릴 때마다 이 값으로 되돌린다.
   *
   * 폼을 하나 더 만들지 않는다 - 두 화면이 각자 입고 폼을 그리면 칸이 조금씩
   * 갈라지고, 한쪽만 고치는 일이 생긴다 (§10).
   */
  presetPo?: string;
  /** 단추 글씨. 발주 줄에서는 짧게 */
  label?: string;
}) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(receiveMaterial, {});
  const { open, setOpen } = useDialog(state);
  const [itemId, setItemId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [poId, setPoId] = useState('');

  const pool = useMemo(() => items.filter((i) => i.type !== 'FIN'), [items]);
  const item = pool.find((i) => i.id === itemId) ?? pool[0];
  const conv = Number(item?.conversion ?? 1);
  const usageQty = Number(qty || 0) * conv;
  const isRaw = item?.type === 'RAW';
  const poPool = orders.filter((o) => !itemId || o.item_id === itemId);
  const po = orders.find((o) => o.id === poId);

  /*
   * 발주를 고르면 그 발주의 값으로 채운다.
   *
   * 전에는 고르기만 하고 아무것도 안 채웠다. 공급자 · 수량 · 단가가 발주에
   * 이미 있는데 다시 쳐야 했고, 다시 치는 자리마다 발주와 어긋날 수 있었다.
   *
   * 채우고 나서도 잠그지 않는다. 실제로 온 것이 발주와 다를 수 있고, 그때
   * 적어야 하는 것은 **실제로 온 것**이다. 다르면 아래에서 짚는다.
   */
  const takePo = (id: string) => {
    setPoId(id);
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    const it = pool.find((x) => x.id === o.item_id);
    setItemId(o.item_id);
    setSupplierId(o.supplier_id);
    /* 남은 양은 사용 단위다. 폼이 받는 것은 구매 단위이므로 되돌려 넣는다 */
    const left = remain(o) / Number(it?.conversion ?? 1);
    setQty(left > 0 ? String(Number(left.toFixed(6))) : '');
    setPrice(o.unit_price ? String(Number(o.unit_price)) : '');
  };

  /* 발주 줄에서 열면 늘 그 발주로 시작한다 */
  const start = () => {
    if (presetPo) takePo(presetPo);
    setOpen(true);
  };

  /* ---------------------------------------------------------------------
     적은 것이 발주와 다른가

     ── 단위 뒤에 조사를 붙이지 않는다 ──────────────────────────────────
     `usage_uom` 은 제조소가 설정에서 정한다 (§2.0). 받침이 있을지 없을지
     코드는 모른다 - `장은` 이 맞고 `EA은` 은 틀리다. 그래서 숫자와 단위
     뒤는 `입니다` 나 문장 끝으로 받고 조사를 얹지 않는다.

     띄어쓰기도 같은 이유로 붙인다. `2 만` 이라고 띄우니 **2만(20,000)**
     으로 읽혔다 (사용자 지적 2026-09-08).

     ── 모자란 것은 경고가 아니다 ───────────────────────────────────────
     처음에는 넷을 다 "확인하고 진행하십시오" 아래 두었다. 그런데 발주보다
     적게 들어오는 것은 **이 화면이 지원하는 정상 경로**다 - 나눠 들어오는
     발주를 다루려고 0102 를 만들었는데, 그것을 쓸 때마다 경고가 뜨면 경고가
     경고가 아니게 된다.

     모자란 것은 조용한 안내로 내리고, 확인이 필요한 넷만 경고로 둔다.
  --------------------------------------------------------------------- */
  const left = po ? remain(po) : 0;
  const uom = item?.usage_uom ?? '';
  const short = po && qty && usageQty < left - 1e-9;   // 나눠 들어온다
  const num = (n: number) => Number(n.toFixed(6)).toLocaleString();

  const gaps: { kind: string; detail: string }[] = [];
  if (po) {
    if (supplierId && supplierId !== po.supplier_id) {
      const want = suppliers.find((s) => s.id === po.supplier_id)?.name ?? '(알 수 없음)';
      const got = suppliers.find((s) => s.id === supplierId)?.name ?? '(알 수 없음)';
      gaps.push({ kind: '공급자',
        detail: `발주에 적힌 곳은 ${want}입니다. 지금 고른 곳은 ${got}입니다.` });
    }
    if (itemId && itemId !== po.item_id) {
      const want = items.find((i) => i.id === po.item_id);
      gaps.push({ kind: '품목',
        detail: `발주에 적힌 품목은 ${want?.code} ${want?.name}입니다.` });
    }
    if (qty && usageQty > left + 1e-9) {
      gaps.push({ kind: '수량',
        detail: `남은 발주 ${num(left)}${uom}보다 ${num(usageQty - left)}${uom} 많습니다.` });
    }
    if (price && po.unit_price && Math.abs(Number(price) - Number(po.unit_price)) > 1e-9) {
      gaps.push({ kind: '단가',
        detail: `발주에 적힌 단가는 ${Number(po.unit_price).toLocaleString()}입니다.` });
    }
  }

  return (
    <>
      <button onClick={start} className={label ? 'btn-ghost btn-row' : 'btn-primary'}>
        {label ?? '자재 입고 등록'}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="자재 입고 등록">
        <form action={action}>
      <h3 className="text-sm font-bold text-ink">자재 입고</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="label" htmlFor={`${uid}-item_id`}>품목</label>
          <select id={`${uid}-item_id`} name="item_id" required value={item?.id ?? ''}
                  onChange={(e) => setItemId(e.target.value)} className="input">
            {pool.map((i) => (
              <option key={i.id} value={i.id}>{i.code} · {i.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`${uid}-supplier_id`}>공급자</label>
          <select id={`${uid}-supplier_id`} name="supplier_id" required
                  value={supplierId || suppliers[0]?.id || ''}
                  onChange={(e) => setSupplierId(e.target.value)} className="input">
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.status !== 'APPROVED' ? ' (미승인)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`${uid}-purchase_order_id`}>연결할 발주</label>
          <select id={`${uid}-purchase_order_id`} name="purchase_order_id" value={poId}
                  onChange={(e) => takePo(e.target.value)} className="input">
            <option value="">연결 안 함</option>
            {poPool.map((o) => (
              <option key={o.id} value={o.id}>
                {o.po_no} · 남은 {remain(o)}
                {Number(o.received ?? 0) > 0 ? ` (발주 ${Number(o.qty)})` : ''}
              </option>
            ))}
          </select>
          {po && Number(po.received ?? 0) > 0 && (
            <p className="mt-1 text-xs text-muted">
              이미 <b className="tnum text-ink">{Number(po.received)}</b> 들어왔습니다.
              나눠 들어오는 발주입니다.
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor={`${uid}-supplier_lot_no`}>공급자 로트번호</label>
          <input id={`${uid}-supplier_lot_no`} name="supplier_lot_no" required autoComplete="off" className="input font-mono" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-coa_no`}>성적서 번호 (필수)</label>
          <input id={`${uid}-coa_no`} name="coa_no" required autoComplete="off" placeholder="COA-..."
                 className="input font-mono" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-coa_date`}>성적서 일자</label>
          <input id={`${uid}-coa_date`} name="coa_date" type="date" required defaultValue={today} className="input tnum" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-qc_passed_on`}>합격판정일자 (필수)</label>
          <input id={`${uid}-qc_passed_on`} name="qc_passed_on" type="date" required
                 defaultValue={today} className="input tnum" />
          <p className="mt-1 text-xs text-muted">
            서면 합격 판정 서류의 날짜입니다. <b className="text-ink">로트번호가 이 날짜로
            만들어집니다.</b>
          </p>
        </div>

        <div>
          <label className="label" htmlFor={`${uid}-received_at`}>입고일</label>
          <input id={`${uid}-received_at`} name="received_at" type="date" required defaultValue={today} className="input tnum" />
        </div>

        <div>
          <label className="label" htmlFor={`${uid}-purchase_qty`}>입고 수량 ({item?.purchase_uom})</label>
          <input id={`${uid}-purchase_qty`} name="purchase_qty" type="number" step="any" min="0.0001" required
                 value={qty} onChange={(e) => setQty(e.target.value)} className="input tnum" />
        </div>
        <div>
          <label className="label">재고 반영 ({item?.usage_uom})</label>
          <div className="readout tnum justify-end font-semibold">
            {qty ? usageQty.toLocaleString() : ''}
          </div>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-unit_price`}>단가 ({item?.usage_uom}당)</label>
          <input id={`${uid}-unit_price`} name="unit_price" type="number" step="any" min="0"
                 value={price} onChange={(e) => setPrice(e.target.value)} className="input tnum" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-expiry_date`}>유효기한</label>
          <input id={`${uid}-expiry_date`} name="expiry_date" type="date" className="input tnum" />
        </div>

        <div>
          <label className="label" htmlFor={`${uid}-location`}>보관 위치</label>
          <input id={`${uid}-location`} name="location" autoComplete="off" className="input" />
        </div>
        {isRaw && (
          <div>
            <label className="label" htmlFor={`${uid}-thickness_band`}>두께 구간</label>
            <input id={`${uid}-thickness_band`} name="thickness_band" placeholder="0510" autoComplete="off"
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
          한 배치는 하나의 구간이므로 그 배치에서 나올 수 있는 형명이 좁혀집니다.
        </p>
      )}

      {/*
        * 나눠 들어오는 것은 정상이므로 조용히 알리기만 한다. 무엇이 남고
        * 그 뒤에 무슨 일이 되는지가 이 줄이 할 말의 전부다.
        */}
      {short && (
        <p className="mt-3 rounded-md bg-info-bg px-3 py-2 text-xs leading-relaxed text-ink">
          남은 발주 {num(left)}{uom} 가운데 {num(usageQty)}{uom}입니다.
          발주는 <b>발주중</b>으로 남고, 다음 입고에 {num(left - usageQty)}{uom} 붙일 수 있습니다.
        </p>
      )}

      {/*
        * 발주와 다른 자리를 짚는다. 막지 않는다 - 실제로 온 것을 적는 자리이고,
        * 판정은 사람이 한다 (§1 · §2).
        */}
      {gaps.length > 0 && <div className="mt-3"><Warnings items={gaps} /></div>}

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
