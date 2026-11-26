'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState, useId } from 'react';
import { MOVEMENT_TYPES, MOVEMENT_REASONS, type FormState } from '@/lib/forms';
import { todayKST } from '@/lib/kst';
import { Msg } from '@/components/ui';
import { Unblock } from '@/components/unblock';
import type { Fix } from '@/lib/unblock';
import { moveStock, makeSolutionLot } from '../actions';
import ReceiveForm, { type ItemOpt as ReceiveItemOpt, type SupplierOpt, type OrderOpt } from '../receive-form';
import { num } from '@/lib/fmt';

export interface LotOpt {
  id: string; lot_no: string; item_code: string; item_name: string;
  usage_uom: string; qty_available: string;
}
export interface WoOpt { id: string; batch_no: string; wo_no: string }
export interface SolutionItemOpt {
  id: string; code: string; name: string; usage_uom: string;
  shelf_life_months: number | null;
}

/* ---------------------------------------------------------------------------
   재고 증감 (§4.7)

   반납은 원 로트로 복귀시킨다. 성적서와의 연결을 유지하기 위함이다.
   개봉 후 반납이 안 되는 건은 공정 폐기로 처리한다.
--------------------------------------------------------------------------- */
/* 로트가 없는 품목을 고른 값의 머리. 로트 id 와 섞이지 않게 */
const NEW = 'new:';

export function MovementForm({ lots, orders, fix, lotless = [], receive }: {
  /** 로트가 없는 품목. 고르면 입고 등록이 그 품목으로 열린다 (사용자 2026-11-26) */
  lotless?: { id: string; code: string; name: string }[];
  receive?: { items: ReceiveItemOpt[]; suppliers: SupplierOpt[]; orders: OrderOpt[]; today: string };
  lots: LotOpt[]; orders: WoOpt[];
  /** 자재 로트가 없을 때 입고하러 가는 자리 (lib/unblock.ts) */
  fix?: Fix;
}) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(moveStock, {});
  /*
   * 로트 · 유형 · 사유 · 작업 지시는 비워 둔 채 연다 (UI/UX 검수 2026-11-11).
   * 전에는 목록 첫 로트와 «반납» 이 말없이 골라져 있어, 고르지 않은 로트의 재고가
   * 움직일 수 있었다.
   */
  const [type, setType] = useState('');
  const [lotId, setLotId] = useState('');
  /* 고른 로트 없는 품목 (입고 등록으로 연다). 고를 때마다 폼을 새로 붙여 그 품목으로 연다 */
  const [newItem, setNewItem] = useState('');
  const [newTick, setNewTick] = useState(0);
  const lot = lots.find((l) => l.id === lotId);
  const meta = MOVEMENT_TYPES.find((m) => m.code === type);
  const needsWo = type === 'DISPOSAL_WIP';

  /* 기록이 끝나면 다시 비운다. 같은 로트에 두 번 들어가지 않게 (CutForm 과 같은 까닭) */
  useEffect(() => {
    if (state.ok) { setLotId(''); setType(''); }
  }, [state]);

  return (
    <>
    <form action={action} className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="label" htmlFor={`${uid}-material_lot_id`}>자재 로트</label>
          <select id={`${uid}-material_lot_id`} name="material_lot_id" required value={lot?.id ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v.startsWith(NEW)) { setNewItem(v.slice(NEW.length)); setNewTick((t) => t + 1); setLotId(''); }
                    else setLotId(v);
                  }} className="input">
            <option value="">선택하십시오</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.lot_no} · {l.item_name} (잔여 {num(l.qty_available)} {l.usage_uom})
              </option>
            ))}
            {receive && lotless.length > 0 && (
              <optgroup label="로트가 없는 품목 · 고르면 입고 등록">
                {lotless.map((i) => (
                  <option key={i.id} value={`${NEW}${i.id}`}>{i.code} · {i.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          {/*
            * 재고 증감은 들어온 로트를 움직인다 - 로트가 없는 품목은 여기 나오지 않는다
            * (사용자 2026-11-26 «타이벡 파우치 넣으려고 했더니 안 나오네»). 그 길을 칸 아래에서 알려 준다.
            */}
          <p className="mt-1 text-xs leading-relaxed text-muted">
            로트가 없는 자재는 목록 아래 «로트가 없는 품목» 에서 고르면 입고 등록이 그 품목으로 열립니다.
            기존 보유분은 성적서 칸이 «성적서 미확인 (합격 라벨 기준)» 으로 채워져 있습니다.
          </p>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-type`}>유형</label>
          <select id={`${uid}-type`} name="type" required value={type}
                  onChange={(e) => setType(e.target.value)} className="input">
            <option value="">선택하십시오</option>
            {MOVEMENT_TYPES.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-qty`}>
            {/* 로트를 고르기 전에는 단위가 없다 - 빈 괄호 «수량 ()» 를 띄우지 않는다 */}
            수량 {type === 'ADJUSTMENT' ? '(늘리면 +, 줄이면 -)' : lot?.usage_uom ? `(${lot.usage_uom})` : ''}
          </label>
          <input id={`${uid}-qty`} name="qty" type="number" step="any" required className="input tnum" />
        </div>

        <div>
          <label className="label" htmlFor={`${uid}-reason_code`}>사유</label>
          <select id={`${uid}-reason_code`} name="reason_code" required className="input">
            <option value="">선택하십시오</option>
            {MOVEMENT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className={needsWo ? '' : 'lg:col-span-3'}>
          <label className="label" htmlFor={`${uid}-reason_detail`}>상세</label>
          <input id={`${uid}-reason_detail`} name="reason_detail" autoComplete="off" className="input" />
        </div>
        {needsWo && (
          <div className="lg:col-span-2">
            <label className="label" htmlFor={`${uid}-work_order_id`}>작업 지시 (공정 폐기는 필수)</label>
            <select id={`${uid}-work_order_id`} name="work_order_id" required className="input">
              <option value="">선택하십시오</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>{o.batch_no} · {o.wo_no}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
        {meta?.note ?? '유형을 고르면 무엇이 바뀌는지 여기 나옵니다.'}
        {type === 'RETURN' &&
          ' 개봉 후 반납이 안 되는 건은 공정 폐기로 처리하십시오.'}
      </p>

      <Msg state={state} />
      <div className="mt-3">
        <button type="submit" disabled={pending || lots.length === 0} className="btn-primary">
          기록
        </button>
        {lots.length === 0 && (
          <Unblock fix={fix} align="start" className="mt-2"
                   why="기록할 자재 로트가 없습니다." todo="자재 입고 등록하기" />
        )}
      </div>
    </form>
    {/* 입고 창은 재고 증감 양식 밖에 붙인다 - 창의 제출이 이 양식으로 번지지 않게 */}
    {receive && newItem && (
      <ReceiveForm key={`${newItem}-${newTick}`} items={receive.items} suppliers={receive.suppliers}
                   orders={receive.orders} today={receive.today}
                   presetItem={newItem} existing autoOpen hideButton />
    )}
    </>
  );
}

/* ---------------------------------------------------------------------------
   원액 제조 (§4.7)

   원료 로트에서 꺼내 원액 로트를 세운다. 로트번호는 채번 규칙이 만들고,
   유효기간(제조일 + 품목의 사용기간)과 단가(원료 비용 ÷ 제조량)는 DB 함수가
   정한다. 화면은 값을 받아 보낼 뿐이다.

   사용기간이 비어 있는 품목이면 유효기간이 비어 선다. 막지 않고, 그렇다고
   미리 적어 준다. 단가 없는 원료가 섞여도 같다 - 결과 문구가 말한다.
--------------------------------------------------------------------------- */
export function SolutionLotForm({ items, lots, fix, fixed = false }: {
  items: SolutionItemOpt[]; lots: LotOpt[]; fix?: Fix;
  /**
   * 품목을 하나로 정해 둔다 - 현장 알칼리 처리에서 재고가 없는 그 원액을 만든다 (사용자 2026-11-25).
   * 라벨 인쇄는 관리 화면 몫이라 내지 않는다.
   */
  fixed?: boolean;
}) {
  /* 라벨과 입력을 잇는다 (4차 감사 G2). 같은 부품이 여러 번 그려져도 겹치지 않는다 */
  const uid = useId();

  const [state, action, pending] = useActionState<FormState, FormData>(makeSolutionLot, {});
  const [rows, setRows] = useState([0, 1, 2, 3]);
  const [itemId, setItemId] = useState('');
  const item = items.find((i) => i.id === itemId) ?? items[0];
  const none = items.length === 0;

  return (
    <form action={action} className="p-4">
      {none && (
        <p className="mb-3 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
          원액 품목이 없습니다. 설정의 품목 화면에서 유형이 원액인 품목을 먼저 등록하십시오.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${uid}-item_id`}>원액 품목</label>
          {fixed && item ? (
            <>
              <input type="hidden" name="item_id" value={item.id} />
              <p id={`${uid}-item_id`} className="input bg-canvas">{item.code} · {item.name}</p>
            </>
          ) : (
            <select id={`${uid}-item_id`} name="item_id" required value={item?.id ?? ''}
                    onChange={(e) => setItemId(e.target.value)} disabled={none} className="input">
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.code} · {i.name}</option>
              ))}
            </select>
          )}
          {item && (
            <p className="mt-1 text-xs leading-relaxed text-faint">
              {item.shelf_life_months
                ? `사용기간 ${item.shelf_life_months}개월. 유효기간은 제조일에서 그만큼 뒤로 정해집니다.`
                : '이 품목은 사용기간이 설정되지 않아 유효기간이 비어 있게 됩니다.'}
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-made_on`}>제조일</label>
          <input id={`${uid}-made_on`} name="made_on" type="date" required defaultValue={todayKST()}
                 className="input tnum" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-qty`}>
            제조량{item ? ` (${item.usage_uom})` : ''}
          </label>
          <input id={`${uid}-qty`} name="qty" type="number" step="any" min="0" required
                 className="input tnum" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${uid}-note`}>비고</label>
          <input id={`${uid}-note`} name="note" autoComplete="off" className="input" />
        </div>
      </div>

      <p className="label mt-4">차감할 원료</p>
      <div className="space-y-2">
        {rows.map((i) => (
          <div key={i} className="flex gap-2">
            <select name={`lot_${i}`} aria-label={`원료 ${i + 1}번째 줄`} className="input flex-1">
              <option value="">사용 안 함</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lot_no} · {l.item_name} (잔여 {num(l.qty_available)} {l.usage_uom})
                </option>
              ))}
            </select>
            <input name={`qty_${i}`} type="number" step="any" min="0"
                   aria-label={`원료 ${i + 1}번째 줄의 수량`}
                   placeholder="수량" className="input w-32 tnum" />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setRows((r) => [...r, r.length])}
              className="btn-quiet mt-2">
        원료 줄 추가
      </button>

      <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
        원액 로트가 서고 원료가 그 로트로 차감됩니다. 로트번호는 채번 규칙이 만듭니다.
      </p>

      <Msg state={state} />
      {state.ok && state.href && !fixed && (
        <div className="mt-2">
          <Link href={state.href} className="btn-ghost">라벨 인쇄</Link>
        </div>
      )}
      <div className="mt-3">
        <button type="submit" disabled={pending || none || lots.length === 0} className="btn-primary">
          제조 기록
        </button>
        {lots.length === 0 && (
          <Unblock fix={fix} align="start" className="mt-2"
                   why="원료로 쓸 자재 로트가 없습니다." todo="자재 입고 등록하기" />
        )}
      </div>
    </form>
  );
}
