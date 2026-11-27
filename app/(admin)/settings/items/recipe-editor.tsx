'use client';

import { useActionState, useId, useState } from 'react';
import type { FormState } from '@/lib/forms';
import type { RecipeInput } from '@/lib/solution-recipe';
import { Msg } from '@/components/ui';
import { num } from '@/lib/fmt';
import { saveRecipe } from './actions';

/* ---------------------------------------------------------------------------
   원액 처방 · 한 배치 사용량 (0176 · 사용자 2026-11-27 «화면도 만들어 줘»)

   원액 품목의 수정 창 아래에 둔다. 줄마다 원료와 원액 1 단위당 양을 적고, 한 배치 사용량을 적으면
   원료마다 «4배치 필요량» 을 바로 보여 준다 - 저장하면 그 값이 최소 재고선으로 잡힌다.
--------------------------------------------------------------------------- */
interface Line { key: number; item: string; qty: string }

export function RecipeEditor({ id, uom, batchUse, lines, inputs }: {
  id: string;
  /** 원액의 사용 단위 (L) */
  uom: string;
  batchUse: string | null;
  lines: { input_item_id: string; qty: string }[];
  inputs: RecipeInput[];
}) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(saveRecipe, {});
  const [use, setUse] = useState(batchUse === null ? '' : String(Number(batchUse)));
  const [rows, setRows] = useState<Line[]>(() =>
    lines.length
      ? lines.map((l, i) => ({ key: i, item: l.input_item_id, qty: String(Number(l.qty)) }))
      : [{ key: 0, item: '', qty: '' }]);
  const nextKey = () => Math.max(0, ...rows.map((r) => r.key)) + 1;
  const set = (key: number, patch: Partial<Line>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const byId = new Map(inputs.map((x) => [x.id, x]));
  const useN = Number(use);

  return (
    <form action={action} className="mt-5 space-y-3 border-t border-line-soft pt-4">
      <input type="hidden" name="id" value={id} />
      <div>
        <h3 className="text-sm font-semibold text-ink">원료 처방 · 한 배치 사용량</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          원료의 최소 재고선은 «1 {uom} 당 양 x 한 배치 사용량 x 4배치» 로 잡힙니다. 저장하면 최소 재고선을
          바로 다시 셉니다. 재고 화면에서 직접 정한 선은 그대로 둡니다.
        </p>
      </div>

      <div className="w-48">
        <label className="label" htmlFor={`${uid}-use`}>한 배치 사용량 ({uom})</label>
        <input id={`${uid}-use`} name="batch_use" type="number" step="any" min={0}
               value={use} onChange={(e) => setUse(e.target.value)}
               placeholder="예: 3.2" className="input tnum" />
      </div>

      <div className="qd-table-scroll">
        <table className="qd-table qd-table--hangul">
          <thead>
            <tr>
              <th className="th">원료</th>
              <th className="th text-right">1 {uom} 당</th>
              <th className="th text-right">4배치 필요량</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const inp = byId.get(r.item);
              const need = useN > 0 && Number(r.qty) > 0 ? Number(r.qty) * useN * 4 : null;
              return (
                <tr key={r.key}>
                  <td className="td">
                    <select name="input_item_id" value={r.item} aria-label={`${i + 1}번째 원료`}
                            onChange={(e) => set(r.key, { item: e.target.value })} className="input">
                      <option value="">원료 고르기</option>
                      {inputs.map((x) => (
                        <option key={x.id} value={x.id}>{x.code} · {x.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1.5">
                      <input name="qty" type="number" step="any" min={0} value={r.qty}
                             aria-label={`${i + 1}번째 원료 1 ${uom} 당 양`}
                             onChange={(e) => set(r.key, { qty: e.target.value })}
                             className="input tnum w-28 text-right" />
                      <span className="w-8 text-xs text-muted">{inp?.usage_uom ?? ''}</span>
                    </div>
                  </td>
                  <td className="td tnum text-right text-muted">
                    {need === null ? '' : `${num(Math.round(need * 1000) / 1000)} ${inp?.usage_uom ?? ''}`}
                  </td>
                  <td className="td text-right">
                    <button type="button" className="qd-text-action"
                            onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ key: nextKey(), item: '', qty: '' }])}>
                      빼기
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost"
                onClick={() => setRows((rs) => [...rs, { key: nextKey(), item: '', qty: '' }])}>
          원료 줄 더하기
        </button>
        <button type="submit" disabled={pending} className="btn-primary">처방 저장</button>
      </div>
      <Msg state={state} />
    </form>
  );
}
