'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { setIdleLock } from './actions';
import { Msg } from '@/components/ui';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   자동 잠금 끄기 (0153)

   고르면 곧바로 저장한다. 저장 단추를 따로 두면 고르고 잊은 채 나가는 일이 생긴다.
   저장이 막히면 칸을 서버의 값으로 되돌린다 - 칸이 말하는 것과 실제가 갈리지 않게.
--------------------------------------------------------------------------- */
export function IdleLockForm({ off, worker }: { off: boolean; worker: boolean }) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(setIdleLock, {});
  const [on, setOn] = useState(off);

  useEffect(() => { setOn(off); }, [off]);
  useEffect(() => { if (state.error) setOn(off); }, [state, off]);

  return (
    <form action={action} className="px-4 py-3">
      <label htmlFor={`${uid}-off`} className="flex cursor-pointer items-start gap-3">
        <input
          id={`${uid}-off`}
          type="checkbox"
          name="off"
          value="1"
          checked={on}
          disabled={pending}
          onChange={(e) => {
            setOn(e.target.checked);
            e.currentTarget.form?.requestSubmit();
          }}
          className="mt-0.5 size-4 accent-brand"
        />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">자동 잠금 끄기</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted">
            표시해 두면 자리를 비워도 이 계정의 화면이 잠기지 않습니다. 어느 기기에서 로그인해도 같습니다.
            {worker && ' 작업자로 들어온 현장 화면은 그대로 잠깁니다.'}
          </span>
        </span>
      </label>
      <Msg state={state} />
    </form>
  );
}
