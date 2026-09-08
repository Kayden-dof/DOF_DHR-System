'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/forms';
import { Tag } from '@/components/ui';
import Toasts from '@/components/toast';
import { suggestMinStock, runExpiry } from '../actions';

export default function StockTools({ alerts }: { alerts: number }) {
  const [s1, a1, p1] = useActionState<FormState, FormData>(() => suggestMinStock(), {});
  const [s2, a2, p2] = useActionState<FormState, FormData>(() => runExpiry(), {});

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {alerts > 0 && <Tag tone="warn">최소 재고선 아래 {alerts}종</Tag>}
        <form action={a2}>
          <button type="submit" disabled={p2} className="btn-ghost h-9 px-3 text-xs">
            유효기한 확인
          </button>
        </form>
        <form action={a1}>
          <button type="submit" disabled={p1} className="btn-ghost h-9 px-3 text-xs">
            최소 재고선 제안
          </button>
        </form>
      </div>
      {/*
        * 결과는 화면 오른쪽 위에 띄운다. 여기 아래에 붙이면 표가 밀린다
        * (사용자 지적 2026-09-08).
        */}
      <Toasts states={[s1, s2]} />
    </div>
  );
}
