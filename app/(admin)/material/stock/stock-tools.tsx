'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/forms';
import { Tag } from '@/components/ui';
import Toasts from '@/components/toast';
import { suggestMinStock, runExpiry } from '../actions';

export default function StockTools({ alerts, expirable }: {
  alerts: number;
  /** 유효기한 확인이 기한 경과로 넘길 로트 수. 화면을 연 시점에 센 값 */
  expirable: number;
}) {
  const [s1, a1, p1] = useActionState<FormState, FormData>(() => suggestMinStock(), {});
  const [s2, a2, p2] = useActionState<FormState, FormData>(() => runExpiry(), {});

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {alerts > 0 && <Tag tone="warn">최소 재고선 아래 {alerts}종</Tag>}
        <form action={a2}>
          <button type="submit" disabled={p2} className="btn-ghost">
            유효기한 확인
          </button>
        </form>
        <form action={a1}>
          <button type="submit" disabled={p1} className="btn-ghost">
            최소 재고선 제안
          </button>
        </form>
      </div>
      {/*
        * «유효기한 확인» 은 한 번에 여러 로트의 상태를 바꾼다 (UI/UX 검수 2026-11-11).
        * 전에는 이름만 «확인» 이라 보기만 하는 단추로 읽혔다. 몇 건이 무엇으로
        * 바뀌는지를 단추 옆에 적는다.
        */}
      <p className="text-right text-xs leading-relaxed text-muted">
        {expirable > 0 ? (
          <>유효기한 확인을 누르면 기한이 지난 사용 가능 로트{' '}
            <b className="tnum text-ink">{expirable}</b>건이 한 번에 <b className="text-ink">기한 경과</b>로
            넘어갑니다. 수량은 그대로이고, 되돌리는 자리는 없습니다.</>
        ) : (
          <>유효기한 확인으로 넘길 로트가 지금은 없습니다.</>
        )}
      </p>
      {/*
        * 결과는 화면 오른쪽 위에 띄운다. 여기 아래에 붙이면 표가 밀린다
        * (사용자 지적 2026-09-08).
        */}
      <Toasts states={[s1, s2]} />
    </div>
  );
}
