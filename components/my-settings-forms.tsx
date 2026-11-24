'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { setIdleLock, setLockMinutes } from '@/app/me-actions';
import { Msg } from '@/components/ui';
import type { FormState } from '@/lib/forms';
import {
  LOCK_CHOICES, LOCK_DEFAULT, LOCK_PLACE_LABEL, minutesLabel, type LockPlace,
} from '@/lib/idle-lock';

/* ---------------------------------------------------------------------------
   내 설정 입력 (0153 · 0157)

   고르면 곧바로 저장한다. 저장 단추를 따로 두면 고르고 잊은 채 나가는 일이 생긴다.
   저장이 막히면 칸을 서버의 값으로 되돌린다 - 칸이 말하는 것과 실제가 갈리지 않게.
--------------------------------------------------------------------------- */

/** 잠금 시간 고르기. 빈 값은 기본값이다 */
export function LockMinutesForm({ place, value, unused }: {
  place: LockPlace; value: number | null;
  /** 자동 잠금을 꺼 두어 지금은 쓰이지 않는다 */
  unused?: boolean;
}) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(setLockMinutes, {});
  const saved = value == null ? '' : String(value);
  const [v, setV] = useState(saved);

  useEffect(() => { setV(saved); }, [saved]);
  useEffect(() => { if (state.error) setV(saved); }, [state, saved]);

  return (
    <form action={action} className="px-4 py-3">
      <input type="hidden" name="place" value={place} />
      <label className="label" htmlFor={`${uid}-min`}>{LOCK_PLACE_LABEL[place]} 잠금 시간</label>
      <select
        id={`${uid}-min`}
        name="minutes"
        value={v}
        disabled={pending}
        onChange={(e) => {
          setV(e.target.value);
          e.currentTarget.form?.requestSubmit();
        }}
        className="input max-w-xs"
      >
        <option value="">기본 ({minutesLabel(LOCK_DEFAULT[place])})</option>
        {LOCK_CHOICES[place].map((m) => (
          <option key={m} value={m}>{minutesLabel(m)}</option>
        ))}
      </select>
      <p className="mt-1 text-xs leading-relaxed text-faint">
        {unused
          ? '자동 잠금을 꺼 두는 동안은 쓰이지 않습니다.'
          : place === 'pad'
          ? '손이 닿지 않고 이 시간이 지나면 잠급니다. 현장 패드는 여러 사람이 번갈아 쓰므로 30분까지 고릅니다.'
          : '손이 닿지 않고 이 시간이 지나면 잠급니다.'}
      </p>
      <Msg state={state} />
    </form>
  );
}

/** 자동 잠금 끄기 (0153). 관리자로 앉은 세션에만 그린다 */
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
