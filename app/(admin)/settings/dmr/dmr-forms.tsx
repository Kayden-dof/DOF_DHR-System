'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg, Tag } from '@/components/ui';
import { Dialog, useDialog } from '@/components/dialog';
import {
  createDeviceMaster, verifyDeviceMaster, addOperation, addBom, addTier, setExpectedUnits, setProductCode,
  addOperationsBulk, copyDmr, createProduct, addSampleTier, setSampleBasis,
  setTypicalDay, setDmrNote, setDmrLimits,
} from './actions';
import { linkOperation } from '../../equipment/actions';

export interface OperationRow {
  id: string; seq: number; code: string; name: string; after_cutting: boolean;
  typical_day: number | null;
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
  const { open, setOpen } = useDialog(state);
  const fin = items.filter((i) => i.type === 'FIN');

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary" disabled={fin.length === 0}> 제품표준서 개정 추가 </button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="제품표준서 개정 추가">
        <form action={action}>
      <h3 className="mb-3 text-sm font-bold text-ink">새 개정</h3>

      {/*
        * 제품이 먼저다.
        *
        * 전에는 "대상 형명"(PD05050510)만 묻고 제품 코드는 만든 뒤 따로 넣게
        * 되어 있었다. 그런데 제품은 DX2401 이고 형명은 그 아래 규격이다
        * (62종). 묻는 순서가 뒤집혀 있었다 (사용자 지적 2026-09-01).
        */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">제품 코드</label>
          <input name="product_code" required placeholder="DX2401" autoComplete="off"
                 className="input font-mono" />
        </div>
        <div>
          <label className="label">제품명</label>
          <input name="product_name" placeholder="돈피 진피" autoComplete="off"
                 className="input" />
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">개정 표기</label>
          <input name="revision" required placeholder="Rev.02" autoComplete="off"
                 className="input font-mono" />
        </div>
        <div>
          <label className="label">시행일</label>
          <input name="effective_from" type="date" className="input tnum" />
        </div>
        <div>
          <label className="label">
            대표 형명 <span className="text-faint">(채번 · 소요량 기준)</span>
          </label>
          <select name="item_id" required className="input">
            {fin.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label className="label">
          개정 사유 <span className="text-faint">(비고)</span>
        </label>
        <input name="note" autoComplete="off" maxLength={300} className="input"
               placeholder="서면 제품표준서에 적힌 개정 사유를 그대로 옮깁니다" />
      </div>

      <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
        서면 제품표준서가 정본입니다. 여기에는 개정 표기와 공정 · 자재 구성표,
        그리고 서면에 적힌 개정 사유만 옮겨 기재합니다. 서면 원본은 담지 않고 개정번호로 가리킵니다.
        <br />
        <b className="text-ink">대표 형명</b>은 채번과 소요량 계산이 매이는 자리입니다.
        제품 하나에 형명이 여럿이어도 제품표준서는 제품 코드로 관리합니다.
      </p>
      <Msg state={state} />
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">추가</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
        </form>
      </Dialog>
    </>
  );
}

export function VerifyForm({
  id, verified, sheet,
}: {
  id: string;
  verified: boolean;
  /** 대조할 항목. 화면에 옮겨 적힌 값 그대로 */
  sheet?: VerifySheet;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyDeviceMaster, {});
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});

  if (verified) return null;

  const rows = sheet ? verifyRows(sheet) : [];
  const left = rows.filter((r) => !done[r.key]).length;
  const all = rows.length > 0 && left === 0;

  return (
    <div className="rounded-md border border-warn/30 bg-warn-bg p-3">
      <p className="text-sm leading-relaxed text-ink">
        <b>아직 서면 대조 확인 전입니다.</b> 확인 전에는 작업 지시 발행에서 선택할 수 없습니다.
        공정과 자재 구성표를 모두 넣은 뒤, 서면 제품표준서와 한 항목씩 대조하고 확인하십시오.
      </p>
      <button onClick={() => setOpen(true)} className="btn-ghost mt-3 h-9 px-3 text-xs">
        서면 대조 확인
      </button>
      <Msg state={state} />

      {/*
        * 대조는 제품당 한 번뿐이다. 그 한 번에 옮겨 적은 값을 항목별로 짚게
        * 한다 (사용자 요청). 한 판에 몰아서 "확인했습니다" 를 누르면 실제로는
        * 아무것도 대조하지 않고 누르게 된다.
        *
        * 마지막 항목까지 짚어야 확인 단추가 열린다. 남은 개수를 계속 보여 주어
        * 어디까지 왔는지 알게 한다.
        */}
      {open && (
        <div role="dialog" aria-modal="true" aria-label="서면 대조 확인"
             className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm">
          <div className="card-raised my-6 w-full max-w-3xl">
            <header className="section-head">
              <div>
                <h3 className="text-[0.9375rem] font-bold text-ink">서면 제품표준서와 대조</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  아래는 이 화면에 기재된 값입니다. 서면과 한 항목씩 견주고 같으면
                  확인하십시오. 다르면 닫고 수정한 뒤 다시 확인하십시오.
                </p>
              </div>
              <span className={`ml-auto shrink-0 tnum text-xs font-bold ${
                all ? 'text-ok' : 'text-warn'}`}>
                {all ? '전부 대조함' : `남은 ${left}`}
              </span>
            </header>

            <ul className="max-h-[55vh] divide-y divide-line-soft overflow-y-auto">
              {rows.map((r) => (
                <li key={r.key}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-canvas">
                    <input
                      type="checkbox"
                      checked={!!done[r.key]}
                      onChange={(e) =>
                        setDone((d) => ({ ...d, [r.key]: e.target.checked }))}
                      className="mt-0.5 size-4 shrink-0 accent-brand"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-[0.6875rem] font-bold tracking-wide text-muted">
                        {r.group}
                      </span>
                      <span className="block text-sm leading-relaxed text-ink">{r.label}</span>
                      {r.value && (
                        <span className="mt-0.5 block font-mono text-xs text-body">{r.value}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <form action={action}
                  className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-3">
              <input type="hidden" name="id" value={id} />
              <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
                {all
                  ? '전부 대조했습니다. 확인자로 기록되며 되돌릴 수 없습니다.'
                  : '남은 항목을 모두 확인해야 확인할 수 있습니다.'}
              </span>
              <button type="submit" disabled={!all || pending}
                      className="btn-primary h-9 px-4 text-xs">
                {pending ? '기록 중' : '서면 확인 완료했습니다'}
              </button>
              <button type="button" onClick={() => setOpen(false)}
                      className="btn-ghost h-9 px-3 text-xs">닫기</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   대조 목록 만들기

   화면에 옮겨 적힌 값을 그대로 줄로 편다. 사람이 서면을 보며 하나씩 견주는
   단위와 같아야 하므로, 공정은 공정마다 · 자재는 자재마다 한 줄이다.
--------------------------------------------------------------------------- */

export interface VerifySheet {
  productCode: string | null; productName: string | null;
  itemCode: string; revision: string; effectiveFrom: string | null;
  expectedUnits: number | null;
  operations: OperationRow[];
  equipmentByOp: Record<string, string[]>;
}

function verifyRows(s: VerifySheet) {
  const rows: { key: string; group: string; label: string; value?: string }[] = [];

  rows.push({ key: 'product', group: '제품',
    label: '제품 코드와 제품명이 서면과 같습니까?',
    value: `${s.productCode ?? '(비어 있음)'} · ${s.productName ?? '(비어 있음)'}` });
  rows.push({ key: 'item', group: '제품',
    label: '대표 형명(규격)이 서면과 같습니까?', value: s.itemCode });
  rows.push({ key: 'rev', group: '제품',
    label: '개정 표기와 시행일이 서면과 같습니까?',
    value: `${s.revision} · ${s.effectiveFrom || '시행일 없음'}` });
  rows.push({ key: 'units', group: '제품',
    label: '배치당 예상 생산수량이 서면과 같습니까?',
    value: s.expectedUnits === null ? '(비어 있음)' : `${s.expectedUnits}개` });

  rows.push({ key: 'op-count', group: '공정',
    label: `공정 수가 서면과 같습니까? 빠진 공정이 없습니까?`,
    value: `${s.operations.length}개` });

  for (const op of s.operations) {
    const eq = s.equipmentByOp[op.id] ?? [];
    rows.push({
      key: `op-${op.id}`, group: `공정 ${op.seq}`,
      label: `${op.name} — 순서 · 코드 · 재단 전후 · 설비가 서면과 같습니까?`,
      value: [op.code, op.after_cutting ? '재단 이후' : '재단 이전',
              eq.length ? eq.join(' · ') : '설비 없음'].join(' · '),
    });
    for (const b of op.bom) {
      rows.push({
        key: `bom-${b.id}`, group: `공정 ${op.seq} 자재`,
        label: `${b.item_name} — 소요량 기준과 수량이 서면과 같습니까?`,
        value: b.basis === 'PER_UNIT'
          ? `제품 1개당 ${Number(b.qty_per_unit)} ${b.usage_uom}`
          : b.tiers.length
            ? b.tiers.map((t) =>
                `${t.min_sheets}~${t.max_sheets ?? ''}장 ${Number(t.qty)} ${b.usage_uom}`).join(' / ')
            : '장입 구간 미등록',
      });
    }
  }

  return rows;
}

/* -------------------------------------------------------------------------- */

export function AddOperationForm({ dm, nextSeq }: { dm: string; nextSeq: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addOperation, {});
  return (
    <form action={action} className="border-t border-line bg-canvas p-4">
      <input type="hidden" name="device_master_id" value={dm} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div>
          <label className="label">순번</label>
          <input name="seq" type="number" min="1" defaultValue={nextSeq} required className="input tnum" />
        </div>
        <div>
          <label className="label">보통 일차</label>
          <input name="typical_day" type="number" min="1" placeholder="비워도 됨"
                 className="input tnum" />
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
        보통 일차는 참고값이며 실제 기록 일차를 제약하지 않습니다.
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

export function OperationCard({ dm, op, items, editable, equipment = [] }: {
  dm: string; op: OperationRow; items: ItemOption[]; editable: boolean;
  /** 걸 수 있는 설비 전체와 이 공정에 걸렸는지. 셋업 화면에서 칩으로 켠다 */
  equipment?: { id: string; code: string; name: string; linked: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const [linkState, linkAction] = useActionState<FormState, FormData>(linkOperation, {});

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
        {/* 참고값이라 조용히 둔다. 적히지 않았으면 아무것도 나오지 않는다 */}
        {op.typical_day !== null && (
          <span className="tnum text-xs text-faint">보통 {op.typical_day}일차</span>
        )}
        <span className="ml-auto text-xs text-muted">
          자재 {op.bom.length}종
          {equipment.some((e) => e.linked) &&
            ` · 설비 ${equipment.filter((e) => e.linked).length}대`}
          {' '}{open ? '접기' : '펼치기'}
        </span>
      </button>

      {open && (
        <div className="bg-canvas/50">
          {/*
            * 보통 몇 일차. 실제 일차는 현장이 정하므로 여기 값은 계획을 돕는
            * 참고값이고, 어긋나도 검토 지원에 올리지 않는다.
            */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-4 py-3">
            <span className="label mb-0">보통 일차</span>
            <TypicalDayForm id={op.id} dm={dm} value={op.typical_day} />
            <span className="text-xs leading-relaxed text-faint">
              공정 목록과 작업 지시서에 함께 나옵니다. 실제 기록 일차를 막지 않습니다.
            </span>
          </div>

          {/*
            * 이 공정에서 쓰는 설비. 칩을 누르면 걸리고 다시 누르면 내려간다.
            * 내려도 지워지지 않는다 (§10) - 현장 타일에서 빠질 뿐이다.
            * 발행 여부와 무관하게 고칠 수 있다. 화면이 무엇을 보여 줄지에 대한
            * 설정이지 기록이 아니다.
            */}
          {equipment.length > 0 && (
            <div className="border-b border-line-soft px-4 py-3">
              <p className="label mb-2">이 공정에서 쓰는 설비</p>
              <div className="flex flex-wrap gap-1.5">
                {equipment.map((e) => (
                  <form key={e.id} action={linkAction}>
                    <input type="hidden" name="equipment_id" value={e.id} />
                    <input type="hidden" name="operation_id" value={op.id} />
                    <input type="hidden" name="on" value={e.linked ? '0' : '1'} />
                    <button type="submit"
                            className={`chip transition-colors ${
                              e.linked ? 'bg-brand text-white'
                                       : 'bg-canvas text-muted hover:text-ink'}`}>
                      {e.code} {e.name}
                    </button>
                  </form>
                ))}
              </div>
              {linkState.error && (
                <p role="alert" className="mt-2 text-xs text-danger">{linkState.error}</p>
              )}
            </div>
          )}
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

/* ---------------------------------------------------------------------------
   배치당 예상 생산수량

   계획 참고값이다. 실제 수량은 재단에서 정해지고, 배치별 계획은 예정 형명이
   맡는다. 이 값은 그 계획을 세울 때의 출발점이라 발행 후에도 고칠 수 있다.
--------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
   배치 장입 범위 · 멸균 발송 박스 (M5-1 · §2.0)

   전에는 `check (sheet_count between 1 and 30)` 으로 표 정의에 박혀 있었다.
   30 은 DX2401 의 값이지 프로그램의 성질이 아니다.

   DDL 에는 "0장이나 음수는 자료가 될 수 없다" 는 바깥 울타리만 남기고, 실제
   범위는 여기서 정한다. 상한을 비우면 상한이 없다.
--------------------------------------------------------------------------- */
export function DmrLimitsForm({
  id, sheetMin, sheetMax, boxQty,
}: { id: string; sheetMin: number | null; sheetMax: number | null; boxQty: number | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setDmrLimits, {});

  return (
    <form action={action}
          className="flex flex-wrap items-end gap-2 border-t border-line-soft px-4 py-3">
      <input type="hidden" name="id" value={id} />
      <div className="w-28">
        <label className="label">장입 하한</label>
        <input name="sheet_min" type="number" min={1} defaultValue={sheetMin ?? ''}
               placeholder="1" className="input h-9 tnum text-xs" />
      </div>
      <div className="w-28">
        <label className="label">장입 상한</label>
        <input name="sheet_max" type="number" min={1} defaultValue={sheetMax ?? ''}
               placeholder="없음" className="input h-9 tnum text-xs" />
      </div>
      <div className="w-40">
        <label className="label">멸균 박스 한 개 수량</label>
        <input name="steril_box_qty" type="number" min={1} defaultValue={boxQty ?? ''}
               placeholder="없음" className="input h-9 tnum text-xs" />
      </div>
      <button type="submit" disabled={pending} className="btn-ghost h-9 px-3 text-xs">
        저장
      </button>
      <span className="pb-2 text-xs leading-relaxed text-faint">
        범위를 벗어난 장수로는 발행되지 않습니다. 상한을 비우면 상한이 없습니다.
      </span>
      <Msg state={state} className="w-full" />
    </form>
  );
}

export function ExpectedUnitsForm({ id, value }: { id: string; value: number | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setExpectedUnits, {});

  return (
    <form action={action}
          className="flex flex-wrap items-end gap-2 border-t border-line-soft px-4 py-3">
      <input type="hidden" name="id" value={id} />
      <div className="w-52">
        <label className="label">배치당 예상 생산수량 (계획 참고값)</label>
        <input name="expected_units" type="number" min={1}
               defaultValue={value ?? ''} placeholder="예: 204"
               className="input h-9 tnum text-xs" />
      </div>
      <button type="submit" disabled={pending} className="btn-ghost h-9 px-3 text-xs">
        저장
      </button>
      <span className="pb-2 text-xs leading-relaxed text-faint">
        실제 수량은 재단에서 정해집니다. 발행을 제약하지 않습니다.
      </span>
      <Msg state={state} className="w-full" />
    </form>
  );
}

/* ---------------------------------------------------------------------------
   보통 몇 일차

   공정을 늘어놓는 자리마다 작게 함께 나온다. 실제 일차를 제약하지 않는
   참고값이라 폼도 작게 둔다.
--------------------------------------------------------------------------- */
export function TypicalDayForm({ id, dm, value }: {
  id: string; dm: string; value: number | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(setTypicalDay, {});
  return (
    <form action={action} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="device_master_id" value={dm} />
      <input name="typical_day" type="number" min="1" defaultValue={value ?? ''}
             placeholder="일차" aria-label="보통 일차"
             className="input h-8 w-16 tnum text-xs" />
      <button type="submit" disabled={pending} className="btn-quiet h-8 px-2 text-xs">
        저장
      </button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}

/* ---------------------------------------------------------------------------
   완제품검사 시료 채취 기준

   생산 수량 구간별 시료 수다. 시약의 장입 구간(SHEET_TIER)과 같은 모양이며,
   같은 이유로 비례하지 않는다. 근거 문구를 함께 받아 화면과 현장에 같이 내보낸다
   - 숫자만 있으면 검토자가 그 숫자를 확인할 방법이 없다 (§6).
--------------------------------------------------------------------------- */
export interface SampleTier {
  id: string; min_qty: number; max_qty: number | null; sample_qty: number;
}

export function SamplePlanForm({ id, tiers, basis }: {
  id: string; tiers: SampleTier[]; basis: string | null;
}) {
  const [tState, tAction, tPending] = useActionState<FormState, FormData>(addSampleTier, {});
  const [bState, bAction, bPending] = useActionState<FormState, FormData>(setSampleBasis, {});

  return (
    <div className="border-t border-line-soft px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="label mb-0">완제품검사 시료 채취 기준</span>
        <span className="text-xs leading-relaxed text-faint">
          생산 수량 구간별 시료 수입니다. 현장 재단 화면이 이 표를 보고 안내합니다.
        </span>
      </div>

      {tiers.length > 0 && (
        <table className="mt-2 w-full max-w-md">
          <thead>
            <tr>
              <th className="th">생산 수량</th>
              <th className="th text-right">시료 수</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.id}>
                <td className="td tnum">
                  {t.min_qty} ~ {t.max_qty ?? ''}
                  {t.max_qty === null && <span className="text-faint"> (상한 없음)</span>}
                </td>
                <td className="td tnum text-right font-bold">{t.sample_qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form action={tAction} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={id} />
        <div className="w-24">
          <label className="label">구간 시작</label>
          <input name="min_qty" type="number" min={1} required placeholder="1"
                 className="input h-9 tnum text-xs" />
        </div>
        <div className="w-24">
          <label className="label">구간 끝</label>
          <input name="max_qty" type="number" min={1} placeholder="비우면 무제한"
                 className="input h-9 tnum text-xs" />
        </div>
        <div className="w-24">
          <label className="label">시료 수</label>
          <input name="sample_qty" type="number" min={0} required placeholder="예: 3"
                 className="input h-9 tnum text-xs" />
        </div>
        <button type="submit" disabled={tPending} className="btn-ghost h-9 px-3 text-xs">
          구간 추가
        </button>
        <span className="pb-2 text-xs leading-relaxed text-faint">
          같은 시작값을 다시 입력하면 그 구간이 갱신됩니다.
        </span>
        <Msg state={tState} className="w-full" />
      </form>

      <form action={bAction} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={id} />
        <div className="min-w-0 flex-1">
          <label className="label">근거</label>
          <input name="sample_basis" defaultValue={basis ?? ''}
                 placeholder="예: 검사기준서 QC-DX2401-01 표3"
                 className="input h-9 text-xs" />
        </div>
        <button type="submit" disabled={bPending} className="btn-ghost h-9 px-3 text-xs">
          저장
        </button>
        <Msg state={bState} className="w-full" />
      </form>

      {tiers.length === 0 && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          등록된 구간이 없으면 현장에 아무것도 안내하지 않습니다.
          잘못된 수를 안내하는 것보다 안내하지 않는 편이 낫습니다.
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   제품 코드 · 제품명

   최상위 관리 코드다 (DX2401). 완제품 형명(PD05050510)은 그 아래의 규격이므로
   화면과 인쇄물의 "제품" 자리에는 이 값이 나가야 한다.
--------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
   개정 사유 (비고)

   개정 표기(Rev.03)만으로는 무엇이 왜 바뀌었는지 알 수 없다. 나중에 이력을
   훑어도 번호만 나란히 있을 뿐이라, 서면 제품표준서 두 벌을 꺼내 견줘야 한다.

   서면에 적힌 개정 사유를 한 줄로 옮긴다. 시스템이 무엇이 바뀌었는지 계산하지
   않는다 (§1). 서명이 든 값이 아니므로 나중에 고칠 수 있고, 고친 사실은
   감사추적에 남는다.
--------------------------------------------------------------------------- */
export function DmrNoteForm({ id, note }: { id: string; note: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setDmrNote, {});

  return (
    <form action={action}
          className="flex flex-wrap items-end gap-2 border-t border-line-soft px-4 py-3">
      <input type="hidden" name="id" value={id} />
      <div className="min-w-[18rem] flex-1">
        <label className="label">개정 사유 (비고)</label>
        <input name="note" defaultValue={note ?? ''} autoComplete="off" maxLength={300}
               placeholder="예: WS-05 세척 시간 변경 · 형명 12종 추가"
               className="input h-9 text-xs" />
      </div>
      <button type="submit" disabled={pending} className="btn-ghost h-9 px-3 text-xs">
        저장
      </button>
      <span className="pb-2 text-xs leading-relaxed text-faint">
        서면 제품표준서에 적힌 사유를 그대로 옮깁니다.
      </span>
      <Msg state={state} className="w-full" />
    </form>
  );
}

export function ProductCodeForm({
  id, code, name, itemCode,
}: { id: string; code: string | null; name: string | null; itemCode: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setProductCode, {});

  return (
    <form action={action}
          className="flex flex-wrap items-end gap-2 border-t border-line-soft px-4 py-3">
      <input type="hidden" name="id" value={id} />
      <div className="w-40">
        <label className="label">제품 코드 (관리 코드)</label>
        <input name="product_code" defaultValue={code ?? ''} placeholder="DX2401"
               autoComplete="off" className="input h-9 font-mono text-xs" />
      </div>
      <div className="w-56">
        <label className="label">제품명</label>
        <input name="product_name" defaultValue={name ?? ''} placeholder="돈피 진피"
               autoComplete="off" className="input h-9 text-xs" />
      </div>
      <button type="submit" disabled={pending} className="btn-ghost h-9 px-3 text-xs">
        저장
      </button>
      <span className="pb-2 text-xs leading-relaxed text-faint">
        최상위 관리 코드입니다. 형명 <span className="font-mono">{itemCode}</span> 은
        그 아래의 규격이며, 비우면 형명이 대신 나옵니다.
      </span>
      <Msg state={state} className="w-full" />
    </form>
  );
}

/* ---------------------------------------------------------------------------
   공정 흐름 세트 넣기

   새 제품을 처음부터 등록할 때 쓴다. 공정을 하나씩 폼으로 넣으면 열두 번을
   눌러야 하고, 그러다 순번이나 재단 이후 여부를 빠뜨린다.

   두 길을 둔다.
     흐름 적기   한 줄에 공정 하나. 엑셀에서 붙여 넣어도 된다
     복사        이미 만들어 둔 표준서의 구조를 통째로 가져온다
--------------------------------------------------------------------------- */
export function OperationSetForm({
  dm, sources,
}: {
  dm: string;
  /** 복사해 올 수 있는 다른 표준서 */
  sources: { id: string; label: string; op_count: number }[];
}) {
  const [mode, setMode] = useState<'flow' | 'copy' | null>(null);
  const [bulkState, bulkAction, bulkPending] =
    useActionState<FormState, FormData>(addOperationsBulk, {});
  const [copyState, copyAction, copyPending] =
    useActionState<FormState, FormData>(copyDmr, {});

  if (mode === null) {
    return (
      <div className="border-t border-line bg-canvas px-4 py-3">
        <p className="text-sm font-semibold text-ink">공정이 없습니다. 흐름부터 입력하십시오.</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          공정 흐름을 한 번에 적거나, 이미 만들어 둔 제품표준서에서 가져옵니다.
          가져오면 자재 구성표와 설비 연결까지 함께 옵니다.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setMode('flow')} className="btn-primary h-9 px-4 text-xs">
            공정 흐름 적기
          </button>
          {sources.length > 0 && (
            <button onClick={() => setMode('copy')} className="btn-ghost h-9 px-4 text-xs">
              다른 표준서에서 가져오기
            </button>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'copy') {
    return (
      <form action={copyAction} className="border-t border-line bg-canvas px-4 py-3">
        <input type="hidden" name="device_master_id" value={dm} />
        <p className="text-sm font-semibold text-ink">다른 제품표준서에서 가져오기</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          공정 · 자재 구성표 · 장입 구간 · 설비 연결이 함께 옵니다.
          <b className="text-ink"> 대조 확인은 오지 않습니다</b> - 가져온 표준서는
          서면과 다시 대조해야 합니다.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="w-72">
            <label className="label">가져올 표준서</label>
            <select name="source_id" required className="input h-9 text-xs">
              <option value="">선택하십시오</option>
              {sources.map((x) => (
                <option key={x.id} value={x.id}>{x.label} · 공정 {x.op_count}</option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={copyPending} className="btn-primary h-9 px-4 text-xs">
            {copyPending ? '가져오는 중' : '가져오기'}
          </button>
          <button type="button" onClick={() => setMode(null)}
                  className="btn-ghost h-9 px-3 text-xs">취소</button>
        </div>
        <Msg state={copyState} />
      </form>
    );
  }

  return (
    <form action={bulkAction} className="border-t border-line bg-canvas px-4 py-3">
      <input type="hidden" name="device_master_id" value={dm} />
      <p className="text-sm font-semibold text-ink">공정 흐름 적기</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        한 줄에 공정 하나입니다. <code className="font-mono">공정코드 | 공정명</code> 이고,
        재단 이후 공정이면 뒤에 <code className="font-mono">| 재단이후</code> 를 붙입니다.
        적은 차례가 곧 공정 순서입니다. 엑셀에서 붙여 넣어도 됩니다.
      </p>
      <textarea
        name="flow"
        required
        rows={10}
        spellCheck={false}
        defaultValue={`WS-DX2402-01 | NaCl 처리·세척 |      | 1
WS-DX2402-02 | 초임계 가공     |      | 1
PI-DX2402-01 | 1차 반제품 검사 |      | 2
WS-DX2402-07 | 재단           |      | 3
WS-DX2402-08 | 포장(1·2차)     | 재단이후 | 3
FI-DX2402-01 | 완제품 검사     | 재단이후 | 4`}
        className="input mt-3 h-auto font-mono text-xs leading-relaxed"
      />
      <p className="mt-2 text-xs leading-relaxed text-muted">
        칸은 <b className="text-ink">공정 코드 | 공정명 | 재단이후 | 보통 일차</b> 순입니다.
        뒤 두 칸은 비워도 됩니다. 재단 이후 공정은 기록이
        <b className="text-ink"> 제품 로트</b>에 붙고 그 이전은
        <b className="text-ink"> 배치</b>에 붙으며, 재단 자체는 이전 공정입니다.
        보통 일차는 참고값입니다. 한 줄이라도 어긋나면 아무것도 넣지 않습니다.
      </p>
      <Msg state={bulkState} />
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={bulkPending} className="btn-primary h-9 px-4 text-xs">
          {bulkPending ? '넣는 중' : '공정 넣기'}
        </button>
        <button type="button" onClick={() => setMode(null)}
                className="btn-ghost h-9 px-3 text-xs">취소</button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------------
   제품 등록

   만드는 것(제품)과 사들이는 것(자재 품목)은 다른 물건이다. 여기는 제품이다.
   제품 코드 · 제품명 · 대표 형명 · 개정을 한 번에 받아 형명과 제품표준서를
   함께 만든다. 그다음이 공정 흐름이다.
--------------------------------------------------------------------------- */
export function NewProduct({
  finished, today,
}: {
  /** 이미 있는 완제품 형명. 새 규격이면 직접 적는다 */
  finished: { id: string; code: string; name: string }[];
  today: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createProduct, {});
  const { open, setOpen } = useDialog(state);
  const [useExisting, setUseExisting] = useState(finished.length > 0);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary">제품 등록</button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="제품 등록">
    <form action={action}>
      <p className="text-xs leading-relaxed text-muted">
        만드는 제품입니다. 사들이는 자재는 <b className="text-ink">자재 &gt; 품목</b>에서
        등록합니다.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">제품 코드 (관리 코드)</label>
          <input name="product_code" required autoComplete="off" placeholder="DX2402"
                 className="input font-mono" />
        </div>
        <div>
          <label className="label">제품명</label>
          <input name="product_name" autoComplete="off" placeholder="우피 진피"
                 className="input" />
        </div>
        <div>
          <label className="label">제품표준서 개정</label>
          <input name="revision" required autoComplete="off" placeholder="Rev.01"
                 className="input font-mono" />
        </div>
        <div>
          <label className="label">시행일</label>
          <input name="effective_from" type="date" defaultValue={today} className="input tnum" />
        </div>
      </div>

      {/*
        * 대표 형명. 형명은 규격이다 (PD + 가로 + 세로 + 두께). 제품 하나에
        * 규격이 여럿이고 실제로 어느 규격이 나오는지는 재단에서 정해진다.
        * 여기서는 그 제품을 대표하는 하나만 정하고, 나머지는 완제품 형명
        * 생성으로 만든다.
        */}
      <div className="mt-3 rounded-md border border-line bg-canvas p-3">
        <p className="label mb-2">대표 형명 (규격)</p>
        <div className="flex flex-wrap gap-1.5">
          {finished.length > 0 && (
            <button type="button" onClick={() => setUseExisting(true)}
                    className={`chip ${useExisting ? 'bg-brand text-white' : 'bg-surface text-muted'}`}>
              이미 있는 형명에서
            </button>
          )}
          <button type="button" onClick={() => setUseExisting(false)}
                  className={`chip ${!useExisting ? 'bg-brand text-white' : 'bg-surface text-muted'}`}>
            새 형명 만들기
          </button>
        </div>

        {useExisting ? (
          <select name="item_id" required className="input mt-2.5">
            <option value="">선택하십시오</option>
            {finished.map((f) => (
              <option key={f.id} value={f.id}>{f.code} · {f.name}</option>
            ))}
          </select>
        ) : (
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">형명 코드</label>
              <input name="new_item_code" autoComplete="off" placeholder="PD05050510"
                     className="input font-mono" />
            </div>
            <div>
              <label className="label">형명 이름</label>
              <input name="new_item_name" autoComplete="off"
                     placeholder="DX2402 0.5x0.5 0.5~1.0mm" className="input" />
            </div>
          </div>
        )}
        <p className="mt-2 text-xs leading-relaxed text-faint">
          형명은 규격입니다. 제품 하나에 규격이 여럿이고, 실제로 어느 규격이 나오는지는
          재단에서 정해집니다. 나머지 규격은 등록 후 <b className="text-ink">완제품 형명
          생성</b>으로 한꺼번에 만듭니다.
        </p>
      </div>

      <Msg state={state} />
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary h-9 px-4 text-xs">
          {pending ? '등록 중' : '등록'}
        </button>
      </div>
    </form>
      </Dialog>
    </>
  );
}
