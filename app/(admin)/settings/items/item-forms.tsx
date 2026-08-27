'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/lib/forms';
import { ITEM_TYPES } from '@/lib/forms';
import { Msg, Tag } from '@/components/ui';
import { createItem, updateItem, generateFinished, type GenResult } from './actions';

export interface ItemRow {
  id: string;
  code: string;
  name: string;
  type: string;
  purchase_uom: string;
  usage_uom: string;
  conversion: string;
  min_stock: string | null;
  min_stock_auto: string | null;
  min_stock_basis: string | null;
  lead_days: number | null;
  shelf_life_months: number | null;
  is_active: boolean;
  lot_count: number;
}

const typeLabel = (t: string) => ITEM_TYPES.find((x) => x.code === t)?.label ?? t;

/* -------------------------------------------------------------------------- */

export function NewItemForm({ materialOnly = false }: { materialOnly?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createItem, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-primary">품목 등록</button>;
  }

  return (
    <form action={action} className="card p-4">
      <h3 className="mb-3 text-sm font-bold text-ink">새 품목</h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="code">품목 코드</label>
          <input id="code" name="code" required autoComplete="off"
                 placeholder="RM-006" className="input font-mono" />
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor="name">품목명</label>
          <input id="name" name="name" required autoComplete="off" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="type">유형</label>
          <select id="type" name="type" className="input" defaultValue="REAGENT">
            {(materialOnly ? ITEM_TYPES.filter((x) => x.code !== 'FIN') : ITEM_TYPES).map((x) => (
              <option key={x.code} value={x.code}>{x.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="purchase_uom">구매 단위</label>
          <input id="purchase_uom" name="purchase_uom" required defaultValue="EA"
                 autoComplete="off" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="usage_uom">사용 단위</label>
          <input id="usage_uom" name="usage_uom" required defaultValue="EA"
                 autoComplete="off" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="conversion">환산 계수</label>
          <input id="conversion" name="conversion" type="number" step="any" min="0.0001"
                 defaultValue={1} className="input tnum" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="min_stock">최소 재고선</label>
            <input id="min_stock" name="min_stock" type="number" step="any" className="input tnum" />
          </div>
          <div>
            <label className="label" htmlFor="lead_days">리드타임(일)</label>
            <input id="lead_days" name="lead_days" type="number" className="input tnum" />
          </div>
        </div>
      </div>

      <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
        재고 · 불출 · 단가는 전부 <b className="text-ink">사용 단위</b> 기준으로 다룹니다.
        구매 단위는 입고 등록에서만 받아 환산 계수로 바꿉니다.
        예를 들어 20L 통으로 사서 L 단위로 쓴다면 구매 단위 통, 사용 단위 L, 환산 계수 20입니다.
      </p>

      <Msg state={state} />

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? '등록 중' : '등록'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

export function ItemRowView({ it }: { it: ItemRow }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(updateItem, {});

  return (
    <>
      <tr className={it.is_active ? '' : 'opacity-55'}>
        <td className="td font-mono text-xs font-semibold">{it.code}</td>
        <td className="td">{it.name}</td>
        <td className="td"><Tag tone={it.type === 'FIN' ? 'brand' : 'quiet'}>{typeLabel(it.type)}</Tag></td>
        <td className="td text-xs text-muted">
          {it.purchase_uom === it.usage_uom
            ? it.usage_uom
            : `${it.purchase_uom} → ${it.usage_uom} (x${Number(it.conversion)})`}
        </td>
        <td className="td tnum text-right">{it.min_stock ? Number(it.min_stock) : ''}</td>
        <td className="td tnum text-right text-muted">{it.lot_count || ''}</td>
        <td className="td text-right">
          <button onClick={() => setOpen((v) => !v)} className="btn-quiet h-8 px-2 text-xs">
            {open ? '닫기' : '수정'}
          </button>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={7} className="border-b border-line bg-canvas p-4">
            <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <input type="hidden" name="id" value={it.id} />
              <div className="lg:col-span-2">
                <label className="label">품목명</label>
                <input name="name" defaultValue={it.name} required className="input" />
              </div>
              <div>
                <label className="label">최소 재고선</label>
                <input name="min_stock" type="number" step="any"
                       defaultValue={it.min_stock ?? ''} className="input tnum" />
              </div>
              <div>
                <label className="label">리드타임(일)</label>
                <input name="lead_days" type="number"
                       defaultValue={it.lead_days ?? ''} className="input tnum" />
              </div>
              <div>
                <label className="label">사용기간(개월)</label>
                <input name="shelf_life_months" type="number"
                       defaultValue={it.shelf_life_months ?? ''} className="input tnum" />
              </div>

              <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
                <input type="checkbox" name="is_active" defaultChecked={it.is_active}
                       className="size-4 accent-brand" />
                사용
              </label>

              <div className="flex items-end gap-2 lg:col-span-2">
                <button type="submit" disabled={pending} className="btn-primary">저장</button>
              </div>

              {it.min_stock_auto && (
                <p className="rounded-md bg-surface px-3 py-2 text-xs leading-relaxed text-muted lg:col-span-5">
                  <b className="text-ink">자동 산출값 {Number(it.min_stock_auto)}</b>
                  {it.min_stock_basis ? ` · ${it.min_stock_basis}` : ''}
                  <br />제안일 뿐이며 최소 재고선을 덮어쓰지 않습니다. 쓰려면 위 칸에 직접 넣으십시오.
                </p>
              )}
              <div className="lg:col-span-5"><Msg state={state} /></div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

export function GenerateFinished() {
  const [state, action, pending] = useActionState<GenResult, FormData>(generateFinished, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost">완제품 형명 생성</button>
    );
  }

  return (
    <form action={action} className="card p-4">
      <h3 className="text-sm font-bold text-ink">완제품 형명 생성</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        형명은 <code className="font-mono">PD + 가로2 + 세로2 + 두께하한2 + 두께상한2</code> 규칙입니다.
        크기와 두께 구간을 넣으면 조합으로 만듭니다. 손으로 한 줄씩 등록하지 마십시오.
        이미 있는 코드는 건드리지 않으므로 여러 번 눌러도 안전합니다.
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div>
          <label className="label" htmlFor="sizes">크기 (가로2+세로2)</label>
          <textarea id="sizes" name="sizes" rows={3} required
                    placeholder="0505 1015 1018 1215"
                    className="input font-mono text-xs" />
          <p className="mt-1 text-xs text-faint">공백이나 쉼표로 구분. 5x5 는 0505</p>
        </div>
        <div>
          <label className="label" htmlFor="bands">두께 구간 (하한2+상한2)</label>
          <textarea id="bands" name="bands" rows={3} required
                    placeholder="0510 1015 1520 2025 2530"
                    className="input font-mono text-xs" />
          <p className="mt-1 text-xs text-faint">0.5~1.0mm 는 0510</p>
        </div>
        <div>
          <label className="label" htmlFor="exclude">제외 조합 (8자리)</label>
          <textarea id="exclude" name="exclude" rows={3}
                    placeholder="10152530 10182530 12152530"
                    className="input font-mono text-xs" />
          <p className="mt-1 text-xs text-faint">만들지 않는 크기x두께 조합</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="prefix">이름 앞머리</label>
          <input id="prefix" name="prefix" defaultValue="DX2401" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="shelf_months">사용기간(개월)</label>
          <input id="shelf_months" name="shelf_months" type="number" defaultValue={12}
                 className="input tnum" />
        </div>
      </div>

      <Msg state={state} />

      {state.rows && state.rows.length > 0 && (
        <div className="mt-3 max-h-64 overflow-auto rounded-md border border-line">
          <table className="w-full">
            <thead><tr><th className="th">코드</th><th className="th">이름</th><th className="th">결과</th></tr></thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={r.item_code}>
                  <td className="td font-mono text-xs">{r.item_code}</td>
                  <td className="td text-xs">{r.item_name}</td>
                  <td className="td">
                    <Tag tone={r.was_created ? 'ok' : 'faint'}>
                      {r.was_created ? '새로 등록' : '이미 있음'}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? '생성 중' : '생성'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">닫기</button>
      </div>
    </form>
  );
}
