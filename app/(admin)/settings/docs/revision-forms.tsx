'use client';

import { useActionState } from 'react';
import { Dialog, useDialog } from '@/components/dialog';
import { Msg } from '@/components/ui';
import { EMPTY_FORM_STATE } from '@/lib/forms';
import {
  REQ_KIND_LABEL, REQ_STATUS_LABEL, REQ_TARGET_LABEL,
  type ReqKind, type ReqStatus,
} from '@/lib/mfg-doc';
import { requestRevision, setRequestStatus } from './actions';

/* ---------------------------------------------------------------------------
   개정 제안 단추 (사용자 요청 2026-11-07)

   대조표 한 줄에서 누르면 그 줄의 두 문서 기재가 "지금 적힌 것" 으로 미리
   들어간다. 공정 머리에서 누르면 빈 칸으로 열려, 흐름을 다시 짜자는 것처럼
   한 줄에 매이지 않는 제안을 적는다.
--------------------------------------------------------------------------- */
export function RevisionButton({
  product, opCode, checkId, docNos, current, kind, label = '개정 제안', target = 'BOTH', compact = false,
}: {
  product: string;
  opCode?: string | null;
  checkId?: string | null;
  docNos: string;
  current?: string;
  kind: ReqKind;
  label?: string;
  target?: 'WS' | 'BR' | 'BOTH';
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState(requestRevision, EMPTY_FORM_STATE);
  const { open, setOpen } = useDialog(state);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
              className={compact ? 'btn-quiet btn-row' : 'btn-ghost'}>
        {label}
      </button>
      <Msg state={state.ok ? state : {}} />
      <Dialog open={open} onClose={() => setOpen(false)} title="개정 제안" wide
              note="품질이 문서관리 절차로 개정할 때 쓰는 입력입니다. 제안서 인쇄에 모여 나옵니다.">
        <form action={action} className="space-y-4">
          <input type="hidden" name="product_code" value={product} />
          <input type="hidden" name="op_code" value={opCode ?? ''} />
          <input type="hidden" name="check_id" value={checkId ?? ''} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="rr-target">고칠 문서</label>
              <select id="rr-target" name="target" defaultValue={target} className="input">
                {(['WS', 'BR', 'BOTH'] as const).map((t) => (
                  <option key={t} value={t}>{REQ_TARGET_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rr-kind">제안 종류</label>
              <select id="rr-kind" name="kind" defaultValue={kind} className="input">
                {(Object.keys(REQ_KIND_LABEL) as ReqKind[]).map((k) => (
                  <option key={k} value={k}>{REQ_KIND_LABEL[k]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="rr-docs">대상 문서번호</label>
            <input id="rr-docs" name="doc_nos" defaultValue={docNos} className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="rr-current">지금 적힌 것</label>
            <textarea id="rr-current" name="current_text" defaultValue={current ?? ''} rows={3} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="rr-proposed">이렇게 바꾸자</label>
            <textarea id="rr-proposed" name="proposed_text" rows={3} className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="rr-reason">까닭</label>
            <textarea id="rr-reason" name="reason" rows={2} className="input" required />
          </div>

          <Msg state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-quiet">닫기</button>
            <button type="submit" disabled={pending} className="btn-primary">제안 적기</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* 제안의 상태. 품질에 넘기고, 반영되면 그 결과를 적는다 */
export function StatusForm({ id, status }: { id: string; status: ReqStatus }) {
  const [state, action, pending] = useActionState(setRequestStatus, EMPTY_FORM_STATE);
  const { open, setOpen } = useDialog(state);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-quiet btn-row">상태</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="제안 상태"
              note="반영됨 · 반영 안 함으로 닫을 때는 개정 번호나 까닭을 적습니다.">
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <div>
            <label className="label" htmlFor={`st-${id}`}>상태</label>
            <select id={`st-${id}`} name="status" defaultValue={status} className="input">
              {(Object.keys(REQ_STATUS_LABEL) as ReqStatus[]).map((s) => (
                <option key={s} value={s}>{REQ_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`sn-${id}`}>결과 · 메모</label>
            <textarea id={`sn-${id}`} name="status_note" rows={2} className="input" />
          </div>
          <Msg state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-quiet">닫기</button>
            <button type="submit" disabled={pending} className="btn-primary">바꾸기</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
