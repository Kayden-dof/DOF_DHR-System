'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg, Tag } from '@/components/ui';
import { saveEquipment, linkOperation } from './actions';

export interface EquipRow {
  id: string; code: string; name: string; note: string | null; is_active: boolean;
  ops: { operation_id: string; code: string; name: string }[];
  used: number;
}

export interface OpOption { id: string; code: string; name: string; seq: number }

/* -------------------------------------------------------------------------- */

export function NewEquipment() {
  const [state, action, pending] = useActionState<FormState, FormData>(saveEquipment, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-primary">설비 등록</button>;
  }
  if (state.ok) {
    return (
      <div className="card w-full p-4">
        <Msg state={state} />
        <div className="mt-3 flex gap-2">
          <button onClick={() => setOpen(false)} className="btn-ghost h-9 px-3 text-xs">닫기</button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="card w-full p-4">
      <h3 className="text-sm font-bold text-ink">설비 등록</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">설비 코드</label>
          {/*
            * 기록에 적히는 값이다. 등록한 뒤에는 고칠 수 없다 - 이미 그 코드로
            * 적힌 기록이 있으면 그 기록이 가리키는 대상이 바뀌어 버린다.
            */}
          <input name="code" required autoComplete="off" placeholder="FD-01"
                 className="input font-mono" />
        </div>
        <div className="lg:col-span-2">
          <label className="label">설비명</label>
          <input name="name" required autoComplete="off" placeholder="동결건조기 1호"
                 className="input" />
        </div>
        <div>
          <label className="label">비고</label>
          <input name="note" autoComplete="off" className="input" />
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        코드는 등록 후 고칠 수 없습니다. 제조기록서에 이 값이 그대로 적힙니다.
      </p>
      <Msg state={state} />
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary h-9 px-4 text-xs">
          {pending ? '등록 중' : '등록'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost h-9 px-3 text-xs">
          그만두기
        </button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

export function EquipCard({ e, ops }: { e: EquipRow; ops: OpOption[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveEquipment, {});
  const [linkState, linkAction] = useActionState<FormState, FormData>(linkOperation, {});
  const [edit, setEdit] = useState(false);

  const linked = new Set(e.ops.map((o) => o.operation_id));

  return (
    <section className="card">
      <header className="section-head">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-sm font-bold text-ink">{e.code}</span>
          <span className="text-sm text-body">{e.name}</span>
          {!e.is_active && <Tag tone="quiet">내림</Tag>}
          {e.note && <span className="text-xs text-faint">{e.note}</span>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="tnum text-xs text-muted">기록 {e.used}건</span>
          {!edit && (
            <button onClick={() => setEdit(true)} className="btn-quiet h-8 px-2 text-xs">고치기</button>
          )}
        </div>
      </header>

      {edit && (
        <form action={action} className="border-b border-line-soft bg-surface-sub px-4 py-3">
          <input type="hidden" name="id" value={e.id} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <label className="label">설비명</label>
              <input name="name" defaultValue={e.name} required className="input" />
            </div>
            <div>
              <label className="label">비고</label>
              <input name="note" defaultValue={e.note ?? ''} className="input" />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="is_active" defaultChecked={e.is_active}
                       className="size-4 accent-brand" />
                쓰는 설비
              </label>
            </div>
          </div>
          <Msg state={state} />
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary h-9 px-4 text-xs">
              저장
            </button>
            <button type="button" onClick={() => setEdit(false)}
                    className="btn-ghost h-9 px-3 text-xs">
              그만두기
            </button>
          </div>
        </form>
      )}

      {/*
        * 어느 공정에서 쓰는가.
        *
        * 현장 화면은 여기 걸린 것만 타일로 보여 준다. 전부 늘어놓으면 장갑 낀
        * 손이 긴 목록에서 하나를 찾아야 한다.
        */}
      <div className="px-4 py-3">
        <p className="label mb-2">쓰는 공정</p>
        <div className="flex flex-wrap gap-1.5">
          {ops.map((o) => {
            const on = linked.has(o.id);
            return (
              <form key={o.id} action={linkAction}>
                <input type="hidden" name="equipment_id" value={e.id} />
                <input type="hidden" name="operation_id" value={o.id} />
                <input type="hidden" name="on" value={on ? '0' : '1'} />
                <button type="submit"
                        className={`chip transition-colors ${
                          on ? 'bg-brand text-white' : 'bg-canvas text-muted hover:text-ink'}`}>
                  {o.name}
                </button>
              </form>
            );
          })}
        </div>
        {linkState.error && (
          <p role="alert" className="mt-2 text-sm text-danger">{linkState.error}</p>
        )}
      </div>
    </section>
  );
}
