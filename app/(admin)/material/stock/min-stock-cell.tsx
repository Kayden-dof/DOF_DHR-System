'use client';

import { useActionState, useId } from 'react';
import type { FormState } from '@/lib/forms';
import { Dialog, useDialog } from '@/components/dialog';
import { Msg, Tag } from '@/components/ui';
import Toasts from '@/components/toast';
import { num } from '@/lib/fmt';
import { bomGoverned } from '@/lib/min-stock';
import { setMinStock, resetMinStock } from '../actions';

/* ---------------------------------------------------------------------------
   재고 표의 최소 재고선 칸 (0175 · 사용자 2026-11-27 «재고에서 최소 재고선을 바로 고칠 수 있도록,
   자동으로 다시 세는 위치에서 정정»)

   숫자를 누르면 팝업에서 고친다. 직접 정한 선은 «직접» 이 붙고 다시 셈이 덮지 않는다. 다시 셈이
   선을 정하는 품목이면 같은 팝업에서 자동값으로 되돌린다.
--------------------------------------------------------------------------- */
export interface MinStockItem {
  id: string; code: string; name: string; uom: string;
  value: string | null; auto: string | null; basis: string | null; manual: boolean;
}

export default function MinStockCell({ item, readOnly = false }: { item: MinStockItem; readOnly?: boolean }) {
  const [s1, save, saving] = useActionState<FormState, FormData>(setMinStock, {});
  const [s2, reset, resetting] = useActionState<FormState, FormData>(resetMinStock, {});
  const { open, setOpen } = useDialog(s1, s2);
  const uid = useId();

  const governed = bomGoverned(item.basis);
  const direct = governed && item.manual;
  const shown = item.value === null ? '' : num(item.value);

  if (readOnly) return <>{shown}</>;

  return (
    <>
      <span className="inline-flex items-center justify-end gap-1.5">
        {direct && <Tag tone="info">직접</Tag>}
        <button type="button" onClick={() => setOpen(true)} className="qd-text-action tnum"
                aria-label={`${item.code} 최소 재고선 고치기`}>
          {shown || '정하기'}
        </button>
      </span>

      <Dialog open={open} onClose={() => setOpen(false)} title="최소 재고선"
              note={<><span className="font-mono">{item.code}</span> · {item.name}</>}>
        <form action={save} className="space-y-3">
          <input type="hidden" name="id" value={item.id} />
          <div>
            <label className="label" htmlFor={`${uid}-v`}>최소 재고선 ({item.uom})</label>
            <input id={`${uid}-v`} name="min_stock" type="number" step="any" min={0}
                   defaultValue={item.value === null ? '' : Number(item.value)}
                   placeholder="비우면 선을 두지 않음" className="input tnum" />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-r`}>사유 (선택)</label>
            <input id={`${uid}-r`} name="reason" autoComplete="off" className="input"
                   placeholder="예: 다음 달 생산을 늘림" />
          </div>

          <p className="rounded-md bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
            {governed ? (
              <>
                <b className="text-ink">자동값 {num(item.auto)} {item.uom}</b>
                {item.basis ? ` · ${item.basis}` : ''}
                <br />
                {direct
                  ? '지금 선은 직접 정한 값이라 «최소 재고선 다시 셈» 이 덮지 않습니다.'
                  : '여기서 저장하면 직접 정한 값으로 남아 «최소 재고선 다시 셈» 이 덮지 않습니다.'}
              </>
            ) : (
              <>
                {item.auto !== null && (
                  <><b className="text-ink">사용량 제안 {num(item.auto)} {item.uom}</b>
                    {item.basis ? ` · ${item.basis}` : ''}<br /></>
                )}
                자재 구성표에 없는 품목이라 «최소 재고선 다시 셈» 이 선을 바꾸지 않습니다.
              </>
            )}
          </p>

          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving} className="btn-primary">저장</button>
          </div>
          <Msg state={s1} />
        </form>

        {direct && item.auto !== null && (
          <form action={reset} className="mt-4 space-y-2 border-t border-line-soft pt-4">
            <input type="hidden" name="id" value={item.id} />
            <button type="submit" disabled={resetting} className="btn-ghost">
              자동값 {num(item.auto)} {item.uom} 로 되돌리기
            </button>
            <p className="text-xs leading-relaxed text-muted">
              되돌리면 «최소 재고선 다시 셈» 이 다시 이 품목의 선을 잡습니다.
            </p>
            <Msg state={s2} />
          </form>
        )}
      </Dialog>
      <Toasts states={[s1, s2]} />
    </>
  );
}
