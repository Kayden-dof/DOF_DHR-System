'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import { findModel } from '@/lib/model-find';
import { createOrder, updateOrder, cancelOrder, cancelLine, saveCustomer } from './actions';
import { num } from '@/lib/fmt';

export interface ModelOpt { id: string; code: string; name: string; udi: string | null }
export interface CustomerOpt {
  id: string; name: string; biz_no: string | null; contact_name: string | null; contact_phone: string | null;
  contact_email: string | null; address: string | null; note: string; is_active: boolean;
}
export interface OrderHead {
  id: string; customer_po_no: string; customer_name: string; ordered_on: string;
  ship_to: string | null; due_on: string | null; note: string;
}
export interface LineRow {
  id: string; code: string; name: string; qty: number; shipped: number; left: number; cancelled: boolean;
}

/* ---------------------------------------------------------------------------
   형명 줄 하나. «형명 · UDI» 칸에 형명 코드 · UDI-DI · 라벨 바코드를 넣으면 그 형명을 고른다
   (재단과 같은 셈 · lib/model-find.ts)
--------------------------------------------------------------------------- */
function LineInput({ k, models, onRemove }: { k: number; models: ModelOpt[]; onRemove?: () => void }) {
  const uid = useId();
  const [find, setFind] = useState('');
  const [itemId, setItemId] = useState('');
  const found = find ? findModel(find, models) : undefined;
  /*
   * 찾기 칸과 고른 형명이 어긋나지 않게 (수주 검토 M8): 맞는 형명이 있으면 고르고, 글을 고쳐 맞는 것이
   * 없어지면 고른 것도 비운다 (필수 칸이라 등록이 멈춘다). 목록에서 직접 고르면 찾기 칸을 비운다.
   */
  useEffect(() => {
    if (found) setItemId(found.id);
    else if (find.trim()) setItemId('');
  }, [found, find]);

  /*
   * 안내 글은 형명 칸 «밑의 줄» 에 따로 둔다 (사용자 2026-11-25 스크린샷). 칸 안에 두면
   * 아래 끝 정렬(items-end) 때문에 형명 칸만 글 높이만큼 떠서 옆 두 칸과 이름표 · 칸 높이가
   * 어긋났다. 좁은 화면(한 줄 한 칸)에서는 글이 형명 칸 바로 밑에 그대로 선다.
   */
  return (
    <div className="grid items-end gap-2 sm:grid-cols-[12rem_1fr_7rem_auto]">
      <div>
        <label className="label" htmlFor={`${uid}-find`}>형명 · UDI</label>
        <input id={`${uid}-find`} value={find} onChange={(e) => setFind(e.target.value)} autoComplete="off"
               placeholder="PD05050510" className="input font-mono" />
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-item`}>형명</label>
        <select id={`${uid}-item`} name={`line_item_${k}`} value={itemId}
                onChange={(e) => { setItemId(e.target.value); setFind(''); }} className="input">
          <option value="">선택하십시오</option>
          {models.map((o) => (
            <option key={o.id} value={o.id}>{o.code} · {o.name}{o.udi ? ` · UDI ${o.udi}` : ''}</option>
          ))}
        </select>
      </div>
      {find && !found && (
        <p className="text-xs text-warn sm:col-start-2 sm:row-start-2">맞는 형명이 없습니다.</p>
      )}
      <div>
        <label className="label" htmlFor={`${uid}-qty`}>수량</label>
        <input id={`${uid}-qty`} name={`line_qty_${k}`} type="number" min="1" step="1" className="input tnum" />
      </div>
      {onRemove ? (
        <button type="button" onClick={onRemove} className="qd-text-action mb-2">줄 빼기</button>
      ) : <span />}
    </div>
  );
}

/** 새 형명 줄 여럿. start 줄로 시작하고 «줄 더하기» 로 늘린다 */
function LinesEditor({ models, start }: { models: ModelOpt[]; start: number }) {
  const [keys, setKeys] = useState<number[]>(() => Array.from({ length: start }, (_, i) => i));
  const [next, setNext] = useState(start);
  return (
    <div className="space-y-2">
      {keys.map((k) => (
        <LineInput key={k} k={k} models={models}
                   onRemove={keys.length > 1 || start === 0 ? () => setKeys(keys.filter((x) => x !== k)) : undefined} />
      ))}
      <button type="button" onClick={() => { setKeys([...keys, next]); setNext(next + 1); }}
              className="qd-text-action">줄 더하기</button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   주문 등록
--------------------------------------------------------------------------- */
export function NewOrderForm({ customers, models, today }: {
  customers: CustomerOpt[]; models: ModelOpt[]; today: string;
}) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(createOrder, {});
  const [gen, setGen] = useState(0);
  const [customer, setCustomer] = useState('');
  useEffect(() => { if (state.ok) { setGen((g) => g + 1); setCustomer(''); } }, [state]);
  const live = customers.filter((c) => c.is_active);

  return (
    <form key={gen} action={action}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor={`${uid}-c`}>거래처</label>
          <select id={`${uid}-c`} name="customer_id" required value={customer}
                  onChange={(e) => setCustomer(e.target.value)} className="input">
            <option value="">선택하십시오</option>
            {live.map((c) => <option key={c.id} value={c.id}>{c.name}{c.biz_no ? ` · ${c.biz_no}` : ''}</option>)}
            <option value="new">새 거래처 등록</option>
          </select>
        </div>
        {customer === 'new' && (
          <>
            <div>
              <label className="label" htmlFor={`${uid}-nn`}>상호</label>
              <input id={`${uid}-nn`} name="new_customer_name" required autoComplete="off" className="input" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-nb`}>사업자등록번호</label>
              <input id={`${uid}-nb`} name="new_biz_no" autoComplete="off" placeholder="000-00-00000"
                     className="input font-mono" />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor={`${uid}-po`}>고객 발주번호</label>
          <input id={`${uid}-po`} name="customer_po_no" required autoComplete="off" className="input font-mono" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-on`}>발주일</label>
          <input id={`${uid}-on`} name="ordered_on" type="date" required defaultValue={today} className="input tnum" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-st`}>납품처</label>
          <input id={`${uid}-st`} name="ship_to" autoComplete="off" placeholder="비우면 거래처와 같습니다"
                 className="input" />
        </div>
        <div>
          <label className="label" htmlFor={`${uid}-due`}>납품요청일</label>
          <input id={`${uid}-due`} name="due_on" type="date" className="input tnum" />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="label" htmlFor={`${uid}-note`}>메모</label>
          <input id={`${uid}-note`} name="note" autoComplete="off" placeholder="결제조건 · 특기사항" className="input" />
        </div>
      </div>
      <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">형명 줄</h3>
      <LinesEditor models={models} start={1} />
      <Msg state={state} />
      <div className="mt-4">
        <button type="submit" disabled={pending} className="btn-primary">주문 등록</button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------------
   주문 고치기 - 머리 값 · 줄 수량 · 줄 더하기
--------------------------------------------------------------------------- */
export function EditOrder({ order, lines, models }: { order: OrderHead; lines: LineRow[]; models: ModelOpt[] }) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(updateOrder, {});
  const { open, setOpen } = useDialog(state);
  return (
    <>
      <button onClick={() => setOpen(true)} className="qd-text-action">고치기</button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title={`주문 ${order.customer_po_no} 고치기`}>
        <form action={action}>
          <input type="hidden" name="id" value={order.id} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label" htmlFor={`${uid}-po`}>고객 발주번호</label>
              <input id={`${uid}-po`} name="customer_po_no" required defaultValue={order.customer_po_no}
                     className="input font-mono" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-on`}>발주일</label>
              <input id={`${uid}-on`} name="ordered_on" type="date" required defaultValue={order.ordered_on}
                     className="input tnum" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-st`}>납품처</label>
              <input id={`${uid}-st`} name="ship_to" defaultValue={order.ship_to ?? ''} className="input" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-due`}>납품요청일</label>
              <input id={`${uid}-due`} name="due_on" type="date" defaultValue={order.due_on ?? ''} className="input tnum" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <label className="label" htmlFor={`${uid}-note`}>메모</label>
              <input id={`${uid}-note`} name="note" defaultValue={order.note} className="input" />
            </div>
          </div>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">형명 줄 수량</h3>
          <div className="space-y-2">
            {lines.filter((l) => !l.cancelled).map((l) => (
              <div key={l.id} className="grid items-center gap-2 sm:grid-cols-[1fr_7rem]">
                <label htmlFor={`${uid}-${l.id}`} className="text-sm">
                  <span className="font-mono">{l.code}</span> · {l.name}
                  {l.shipped > 0 && <span className="ml-2 text-xs text-muted">출고 {num(l.shipped)}</span>}
                </label>
                {/* 넘게 나간 줄은 지금 수량이 하한이다 - 늘리는 것만 받는다 (DB 도 같다) */}
                <input id={`${uid}-${l.id}`} name={`qty_${l.id}`} type="number"
                       min={Math.min(l.qty, Math.max(1, l.shipped))} step="1"
                       required defaultValue={l.qty} className="input tnum" />
              </div>
            ))}
          </div>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">줄 더하기</h3>
          <LinesEditor models={models} start={0} />
          <p className="mt-3 text-xs leading-relaxed text-muted">이미 나간 양보다 적게 줄일 수 없습니다.</p>
          <Msg state={state} />
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary">저장</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* ---------------------------------------------------------------------------
   취소 (사유 필수 · 되돌리지 않는다)
--------------------------------------------------------------------------- */
function CancelDialog({ title, what, id, act, label }: {
  title: string; what: string; id: string; label: string;
  act: (p: FormState, f: FormData) => Promise<FormState>;
}) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(act, {});
  const { open, setOpen } = useDialog(state);
  return (
    <>
      <button onClick={() => setOpen(true)} className="qd-text-action qd-text-action--danger">{label}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <label className="label" htmlFor={`${uid}-r`}>취소 사유</label>
          <textarea id={`${uid}-r`} name="reason" required rows={2} className="input" />
          <p className="mt-2 text-xs leading-relaxed text-muted">{what}</p>
          <Msg state={state} />
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={pending} className="btn-danger">취소한다</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function CancelOrderButton({ id, po }: { id: string; po: string }) {
  return (
    <CancelDialog id={id} act={cancelOrder} label="취소" title={`주문 ${po} 취소`}
                  what="남은 수량이 0 이 되고, 취소는 되돌릴 수 없습니다. 이미 나간 출고는 그대로 남습니다." />
  );
}

export function CancelLineButton({ id, code }: { id: string; code: string }) {
  return (
    <CancelDialog id={id} act={cancelLine} label="줄 취소" title={`형명 줄 ${code} 취소`}
                  what="이 줄의 남은 수량이 0 이 되고, 취소는 되돌릴 수 없습니다." />
  );
}

/* ---------------------------------------------------------------------------
   거래처 등록 · 고치기
--------------------------------------------------------------------------- */
export function CustomerButton({ customer, label }: { customer?: CustomerOpt; label: string }) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(saveCustomer, {});
  const { open, setOpen } = useDialog(state);
  const c = customer;
  return (
    <>
      <button onClick={() => setOpen(true)} className={c ? 'qd-text-action' : 'btn-ghost'}>{label}</button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title={c ? `거래처 ${c.name}` : '거래처 등록'}>
        <form action={action}>
          {c && <input type="hidden" name="id" value={c.id} />}
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['name', '상호', c?.name, true], ['biz_no', '사업자등록번호', c?.biz_no, false],
              ['contact_name', '담당자', c?.contact_name, false], ['contact_phone', '연락처', c?.contact_phone, false],
              ['contact_email', '이메일', c?.contact_email, false], ['address', '주소', c?.address, false],
            ] as const).map(([n, l, v, req]) => (
              <div key={n}>
                <label className="label" htmlFor={`${uid}-${n}`}>{l}</label>
                <input id={`${uid}-${n}`} name={n} required={req} defaultValue={v ?? ''} autoComplete="off"
                       className={n === 'biz_no' ? 'input font-mono' : 'input'} />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className="label" htmlFor={`${uid}-note`}>메모</label>
              <input id={`${uid}-note`} name="note" defaultValue={c?.note ?? ''} className="input" />
            </div>
            {c && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={c.is_active} /> 쓰는 거래처
              </label>
            )}
          </div>
          <Msg state={state} />
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary">저장</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
