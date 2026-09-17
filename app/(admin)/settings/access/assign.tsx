'use client';

import { useActionState } from 'react';
import { setScreen } from './actions';
import { Msg } from '@/components/ui';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   한 칸을 정하는 단추 세 개 (0116)

   행마다 폼 하나다. 서른 칸을 한 폼에 묶으면 한 칸을 고치는데 서른 칸이 함께
   저장되고, 그 사이에 다른 사람이 고친 것이 지워진다.

   ── 되돌리는 자리를 함께 낸다 ────────────────────────────────────────────
   열림 · 닫힘 말고 **기본값**이 있다. 그것이 없으면 한 번 손댄 칸은 영원히
   손댄 칸으로 남아, 나중에 역할을 바꿔도 따라오지 않는다 (§2.1 "막기만 하고
   푸는 자리를 안 내면 덫이다").
--------------------------------------------------------------------------- */
export default function AssignCell({ userId, path, state, roleOpen }: {
  userId: string;
  path: string;
  /** 지금 배정. 'default' 면 역할 기본값을 따르는 중이다 */
  state: 'open' | 'closed' | 'default';
  /** 역할 기본값이 열림인가. 기본값 단추에 무엇이 되는지 적는다 */
  roleOpen: boolean;
}) {
  const [msg, action, pending] = useActionState<FormState, FormData>(setScreen, {});

  const btn = (want: 'open' | 'closed' | 'default', label: string, title: string) => (
    <button type="submit" name="state" value={want} disabled={pending}
            title={title}
            aria-pressed={state === want}
            className={`h-7 rounded-md px-2 text-[0.6875rem] font-semibold transition-colors
              ${state === want
                ? want === 'open' ? 'bg-brand text-white'
                  : want === 'closed' ? 'bg-danger text-white'
                  : 'bg-surface-sub text-ink ring-1 ring-line'
                : 'text-muted hover:bg-surface-sub'}`}>
      {label}
    </button>
  );

  return (
    <form action={action} className="flex items-center justify-center gap-0.5">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="path" value={path} />
      {btn('open', '열림', '이 사람에게 이 화면을 연다')}
      {btn('closed', '닫힘', '이 사람에게 이 화면을 닫는다')}
      {btn('default', '기본', `역할 기본값을 따른다 (지금 ${roleOpen ? '열림' : '닫힘'})`)}
      {msg.error && <Msg state={msg} />}
    </form>
  );
}
