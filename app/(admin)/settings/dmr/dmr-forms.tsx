'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg, Tag } from '@/components/ui';
import {
  createDeviceMaster, verifyDeviceMaster, addOperation, addBom, addTier,
} from './actions';

export interface OperationRow {
  id: string; seq: number; code: string; name: string; after_cutting: boolean;
  bom: BomRow[];
}
export interface BomRow {
  id: string; component_item_id: string; item_code: string; item_name: string;
  usage_uom: string; basis: string; qty_per_unit: string | null;
  tiers: { id: string; min_sheets: number; max_sheets: number | null; qty: string }[];
}
export interface ItemOption { id: string; code: string; name: string; usage_uom: string; type: string }

/* -------------------------------------------------------------------------- */

export function NewDeviceMaster({ items }: { items: ItemOption[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createDeviceMaster, {});
  const [open, setOpen] = useState(false);
  const fin = items.filter((i) => i.type === 'FIN');

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary" disabled={fin.length === 0}>
        제품표준서 개정 추가
      </button>
    );
  }

  return (
    <form action={action} className="card p-4">
      <h3 className="mb-3 text-sm font-bold text-ink">새 개정</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">대상 형명</label>
          <select name="item_id" required className="input">
            {fin.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">개정 표기</label>
          <input name="revision" required placeholder="Rev.02" autoComplete="off"
                 className="input font-mono" />
        </div>
        <div>
          <label className="label">시행일</label>
          <input name="effective_from" type="date" className="input tnum" />
        </div>
      </div>
      <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
        서면 제품표준서가 정본입니다. 여기에는 개정 표기와 공정 · 자재 구성표만 옮겨 적습니다.
        파일은 올리지 않습니다.
      </p>
      <Msg state={state} />
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">추가</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
    </form>
  );
}

export function VerifyForm({ id, verified }: { id: string; verified: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyDeviceMaster, {});
  const [confirm, setConfirm] = useState(false);

  if (verified) return null;

  return (
    <div className="rounded-md border border-warn/30 bg-warn-bg p-3">
      <p className="text-sm leading-relaxed text-ink">
        <b>아직 서면 대조 확인 전입니다.</b> 확인 전에는 작업 지시 발행에서 고를 수 없습니다.
        공정과 자재 구성표를 모두 넣은 뒤, 서면 제품표준서와 한 항목씩 대조하고 확인하십시오.
      </p>
      {!confirm ? (
        <button onClick={() => setConfirm(true)} className="btn-ghost mt-3 h-9 px-3 text-xs">
          서면 대조 확인
        </button>
      ) : (
        <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <span className="text-xs text-ink">
            서면과 대조했고 옮겨 적은 내용이 일치합니까? 확인자로 기록됩니다.
          </span>
          <button type="submit" disabled={pending} className="btn-primary h-9 px-3 text-xs">
            확인했습니다
          </button>
          <button type="button" onClick={() => setConfirm(false)} className="btn-quiet h-9 px-3 text-xs">
            취소
          </button>
        </form>
      )}
      <Msg state={state} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function AddOperationForm({ dm, nextSeq }: { dm: string; nextSeq: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addOperation, {});
  return (
    <form action={action} className="border-t border-line bg-canvas p-4">
      <input type="hidden" name="device_master_id" value={dm} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="label">순번</label>
          <input name="seq" type="number" min="1" defaultValue={nextSeq} required className="input tnum" />
        </div>
        <div>
          <label className="label">공정 코드</label>
          <input name="code" required placeholder="WS-DX2401-01" autoComplete="off"
                 className="input font-mono" />
        </div>
        <div className="lg:col-span-2">
          <label className="label">공정명</label>
          <input name="name" required autoComplete="off" className="input" />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input type="checkbox" name="after_cutting" className="size-4 accent-brand" />
          재단 이후 공정
        </label>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        재단 이후 공정은 기록이 <b className="text-ink">제품 로트</b>에 붙고, 그 이전은
        <b className="text-ink"> 배치</b>에 붙습니다. 재단(WS-07) 자체는 이전 공정입니다.
      </p>
      <Msg state={state} />
      <div className="mt-3">
        <button type="submit" disabled={pending} className="btn-ghost">공정 추가</button>
      </div>
    </form>
  );
}

export function AddBomForm({ dm, op, items }: {
  dm: string; op: OperationRow; items: ItemOption[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(addBom, {});
  const [basis, setBasis] = useState('SHEET_TIER');
  const used = new Set(op.bom.map((b) => b.component_item_id));
  const pool = items.filter((i) => i.type !== 'FIN' && i.type !== 'RAW' && !used.has(i.id));

  return (
    <form action={action} className="grid gap-3 border-t border-line bg-canvas p-3 sm:grid-cols-4">
      <input type="hidden" name="device_master_id" value={dm} />
      <input type="hidden" name="operation_id" value={op.id} />
      <div className="sm:col-span-2">
        <label className="label">자재</label>
        <select name="component_item_id" required className="input h-9 text-xs">
          {pool.map((i) => (
            <option key={i.id} value={i.id}>{i.code} · {i.name} ({i.usage_uom})</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">소요량 기준</label>
        <select name="basis" value={basis} onChange={(e) => setBasis(e.target.value)}
                className="input h-9 text-xs">
          <option value="SHEET_TIER">장입 구간 기준</option>
          <option value="PER_UNIT">제품 개수 기준</option>
        </select>
      </div>
      <div>
        <label className="label">
          {basis === 'PER_UNIT' ? '제품 1개당' : '구간별로 따로 입력'}
        </label>
        <input name="qty_per_unit" type="number" step="any" min="0"
               disabled={basis !== 'PER_UNIT'}
               className="input h-9 tnum text-xs" />
      </div>
      <div className="sm:col-span-4">
        <Msg state={state} />
        <button type="submit" disabled={pending || pool.length === 0}
                className="btn-ghost mt-2 h-9 px-3 text-xs">
          자재 추가
        </button>
        {pool.length === 0 && (
          <span className="ml-2 text-xs text-faint">추가할 수 있는 자재가 없습니다.</span>
        )}
      </div>
    </form>
  );
}

export function AddTierForm({ dm, bom }: { dm: string; bom: BomRow }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addTier, {});
  const last = bom.tiers.at(-1);
  const nextMin = last?.max_sheets ? last.max_sheets + 1 : 1;

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 px-3 pb-3">
      <input type="hidden" name="device_master_id" value={dm} />
      <input type="hidden" name="dmr_bom_id" value={bom.id} />
      <div className="w-24">
        <label className="label">장입 하한</label>
        <input name="min_sheets" type="number" min="1" defaultValue={nextMin} required
               className="input h-9 tnum text-xs" />
      </div>
      <div className="w-24">
        <label className="label">상한</label>
        <input name="max_sheets" type="number" min="1" placeholder="없음"
               className="input h-9 tnum text-xs" />
      </div>
      <div className="w-28">
        <label className="label">소요량</label>
        <input name="qty" type="number" step="any" min="0.0001" required
               className="input h-9 tnum text-xs" />
      </div>
      <button type="submit" disabled={pending} className="btn-quiet h-9 px-3 text-xs">
        구간 추가
      </button>
      <div className="w-full"><Msg state={state} /></div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

export function OperationCard({ dm, op, items, editable }: {
  dm: string; op: OperationRow; items: ItemOption[]; editable: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-line last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas"
      >
        <span className="w-7 shrink-0 text-center text-xs font-bold tnum text-faint">{op.seq}</span>
        <code className="font-mono text-xs text-muted">{op.code}</code>
        <span className="text-sm font-semibold text-ink">{op.name}</span>
        <Tag tone={op.after_cutting ? 'brand' : 'quiet'}>
          {op.after_cutting ? '재단 이후' : '재단 이전'}
        </Tag>
        <span className="ml-auto text-xs text-muted">
          자재 {op.bom.length}종 {open ? '접기' : '펼치기'}
        </span>
      </button>

      {open && (
        <div className="bg-canvas/50">
          {op.bom.length === 0 ? (
            <p className="px-4 py-3 text-xs text-faint">등록된 자재가 없습니다.</p>
          ) : (
            <div className="space-y-2 px-4 py-3">
              {op.bom.map((b) => (
                <div key={b.id} className="rounded-md border border-line bg-surface">
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <code className="font-mono text-xs font-semibold">{b.item_code}</code>
                    <span className="text-sm text-ink">{b.item_name}</span>
                    <Tag tone={b.basis === 'PER_UNIT' ? 'info' : 'quiet'}>
                      {b.basis === 'PER_UNIT'
                        ? `제품 1개당 ${Number(b.qty_per_unit)} ${b.usage_uom}`
                        : '장입 구간 기준'}
                    </Tag>
                  </div>
                  {b.basis === 'SHEET_TIER' && (
                    <>
                      {b.tiers.length > 0 && (
                        <table className="w-full">
                          <thead>
                            <tr>
                              <th className="th">장입 구간</th>
                              <th className="th text-right">소요량</th>
                            </tr>
                          </thead>
                          <tbody>
                            {b.tiers.map((tr) => (
                              <tr key={tr.id}>
                                <td className="td tnum text-xs">
                                  {tr.min_sheets} ~ {tr.max_sheets ?? '제한 없음'} 장
                                </td>
                                <td className="td tnum text-right text-xs">
                                  {Number(tr.qty)} {b.usage_uom}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {editable && <AddTierForm dm={dm} bom={b} />}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {editable && <AddBomForm dm={dm} op={op} items={items} />}
        </div>
      )}
    </div>
  );
}
