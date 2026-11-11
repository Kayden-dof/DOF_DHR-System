'use client';

/* ---------------------------------------------------------------------------
   작업요청 옮겨 적기 (F705-01 Rev.02 · 사용자 2026-11-11)

   종이 작업요청 및 지시서의 1 · 2 · 3 을 그 칸 차례대로 옮겨 적는다. 서명과
   수신확인은 종이에 한다. 처음 열 때는 시스템이 아는 제품명을 첫 줄에 미리 둔다.
--------------------------------------------------------------------------- */
import { useActionState, useId, useState } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import { saveWorkRequest } from './request-actions';

export interface ReqValue {
  request_dept: string | null; requester: string | null;
  purpose: string | null; purpose_note: string | null; urgent: boolean;
  lines: { product?: string; model?: string; qty?: string; due?: string; note?: string }[];
  notes: string | null; complete_by: string | null; instruction: string | null;
}

const PURPOSES = [
  { code: 'SALES', label: '영업/주문' },
  { code: 'PLAN', label: '재고/생산 계획' },
  { code: 'RND', label: '연구/개발' },
  { code: 'OTHER', label: '기타' },
];

export default function WorkRequestForm({ woId, woNo, value, productName }: {
  woId: string; woNo: string; value: ReqValue | null;
  /** 처음 열 때 첫 줄 제품명에 미리 둔다 */
  productName: string;
}) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(saveWorkRequest, {});
  const { open, setOpen } = useDialog(state);
  const [purpose, setPurpose] = useState(value?.purpose ?? '');
  const [urgent, setUrgent] = useState(!!value?.urgent);
  const lines = Array.from({ length: 5 }, (_, i) =>
    value?.lines?.[i] ?? (i === 0 && !value ? { product: productName } : {}));

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-quiet">
        {value ? '작업요청 고치기' : '작업요청 옮겨 적기'}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} wide
              title="작업요청 옮겨 적기"
              note={<>F705-01 작업요청 및 지시서 · 지시서 <span className="font-mono">{woNo}</span></>}>
        <form action={action} className="space-y-4">
          <input type="hidden" name="work_order_id" value={woId} />
          <input type="hidden" name="purpose" value={purpose} />
          <input type="hidden" name="urgent" value={urgent ? '1' : '0'} />

          <p className="text-xs leading-relaxed text-muted">
            종이 작업요청 및 지시서에 요청자가 적은 것을 그대로 옮겨 적습니다. 작업 지시서 인쇄 첫 장에
            파란 글씨로 나갑니다. 서명 · 수신확인은 종이에 합니다. 고친 사실은 감사추적에 남습니다.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`${uid}-dept`}>요청부서</label>
              <input id={`${uid}-dept`} name="request_dept" defaultValue={value?.request_dept ?? ''}
                     autoComplete="off" placeholder="예: 품질팀" className="input" />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-who`}>담당자 (요청자)</label>
              <input id={`${uid}-who`} name="requester" defaultValue={value?.requester ?? ''}
                     autoComplete="off" className="input" />
            </div>
          </div>

          <div>
            <span className="label">작업목적</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {PURPOSES.map((p) => (
                <button key={p.code} type="button" onClick={() => setPurpose(purpose === p.code ? '' : p.code)}
                        className={`chip ${purpose === p.code ? 'bg-brand text-white' : 'bg-surface text-muted'}`}>
                  {purpose === p.code ? '■' : '□'} {p.label}
                </button>
              ))}
              {purpose === 'OTHER' && (
                <input name="purpose_note" defaultValue={value?.purpose_note ?? ''} autoComplete="off"
                       aria-label="기타 내용" placeholder="기타 ( ) 안의 말" className="input min-w-0 flex-1" />
              )}
            </div>
          </div>

          <div>
            <span className="label">작업구분</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setUrgent(false)}
                      className={`chip ${!urgent ? 'bg-brand text-white' : 'bg-surface text-muted'}`}>
                {!urgent ? '■' : '□'} 일반 생산
              </button>
              <button type="button" onClick={() => setUrgent(true)}
                      className={`chip ${urgent ? 'bg-brand text-white' : 'bg-surface text-muted'}`}>
                {urgent ? '■' : '□'} 긴급 생산
              </button>
            </div>
          </div>

          <div>
            <span className="label">요청 품목 (양식 다섯 줄)</span>
            <div className="space-y-1.5">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                  <input name={`product_${i}`} defaultValue={l.product ?? ''} autoComplete="off"
                         aria-label={`${i + 1}줄 제품명`} placeholder={`${i + 1} 제품명`} className="input" />
                  <input name={`model_${i}`} defaultValue={l.model ?? ''} autoComplete="off"
                         aria-label={`${i + 1}줄 모델명`} placeholder="PD10182025" className="input font-mono" />
                  <input name={`qty_${i}`} defaultValue={l.qty ?? ''} autoComplete="off"
                         aria-label={`${i + 1}줄 요청수량`} placeholder="요청수량 (예: 20 EA)" className="input" />
                  <input name={`due_${i}`} defaultValue={l.due ?? ''} autoComplete="off"
                         aria-label={`${i + 1}줄 요청기한`} placeholder="요청기한" className="input" />
                  <input name={`note_${i}`} defaultValue={l.note ?? ''} autoComplete="off"
                         aria-label={`${i + 1}줄 비고`} placeholder="비고" className="input" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor={`${uid}-notes`}>2 특이사항 및 요구사항</label>
            <textarea id={`${uid}-notes`} name="notes" defaultValue={value?.notes ?? ''} rows={3}
                      className="input min-h-20 w-full py-2" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor={`${uid}-due`}>3 완료예정일</label>
              <input id={`${uid}-due`} name="complete_by" type="date" defaultValue={value?.complete_by ?? ''}
                     className="input tnum" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor={`${uid}-ins`}>3 생산팀 검토 &amp; 지시사항</label>
              <textarea id={`${uid}-ins`} name="instruction" defaultValue={value?.instruction ?? ''} rows={2}
                        className="input min-h-16 w-full py-2" />
            </div>
          </div>

          <Msg state={state} />
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? '저장하는 중' : '저장'}
          </button>
        </form>
      </Dialog>
    </>
  );
}
