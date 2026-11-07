'use client';

import { useActionState } from 'react';
import { Msg } from '@/components/ui';
import type { FormState } from '@/lib/forms';
import { purgeLogs } from './actions';

/* 시스템관리자에게만 그린다 (page.tsx). 확인란은 잘못 누르는 일을 막는다 */
export default function PurgeForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(purgeLogs, {});

  return (
    <div className="card p-4">
      <h2 className="text-sm font-semibold text-ink">감사추적 비우기</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        지금까지 쌓인 감사추적과 로그인 실패 기록을 모두 지웁니다. 누가 언제 몇 건을 비웠는지
        한 줄만 남고, 되돌릴 수 없습니다.
      </p>
      <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="purge-confirm" className="text-xs text-muted">
          확인란에 <b className="text-ink">비우기</b> 를 적습니다
        </label>
        <input id="purge-confirm" name="confirm" autoComplete="off"
               className="input h-8 w-28 text-xs" />
        <button type="submit" disabled={pending} className="btn-danger h-8 px-3 text-xs">
          비우기
        </button>
      </form>
      <Msg state={state} />
    </div>
  );
}
