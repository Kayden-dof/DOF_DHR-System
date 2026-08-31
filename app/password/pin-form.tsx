'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { changeMyPin } from './actions';
import { PIN_MIN_LENGTH } from '@/lib/auth-const';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   비밀번호 바꾸기 판

   로그인 화면과 같은 몸짓이다. 칸을 짚고 번호판을 눌러 채운다. 현장 패드에는
   키보드가 없으므로 키보드를 전제하지 않되, 사무 화면에서는 숫자키가 그대로
   먹는다.

   ── 먹지 않고 있었다 ──────────────────────────────────────────────────────
   주석에는 "숫자키가 그대로 먹는다" 고 적혀 있었는데 받는 코드가 없었다
   (사용자 지적 2026-08-31). 칸이 <button> 이고 값은 숨은 칸에 들어가므로
   키보드가 닿을 곳이 아예 없었다. 로그인 화면에는 있는 규칙이 여기만 빠져
   있었다 - 같은 몸짓이라고 적어 놓고 한쪽만 구현한 것이다.

   세 칸을 한 번에 보여 준다. 지금 비밀번호를 먼저 묻는 이유는, 자리를 비운
   사이 남이 화면을 잡으면 비밀번호를 바꿔 계정을 가져갈 수 있기 때문이다.
--------------------------------------------------------------------------- */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

type Slot = 'current' | 'next' | 'again';

const LABEL: Record<Slot, string> = {
  current: '지금',
  next: '새 비밀번호',
  again: '한 번 더',
};

export default function PinForm({ first }: { first: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changeMyPin, {});
  const [v, setV] = useState<Record<Slot, string>>({ current: '', next: '', again: '' });
  const [at, setAtState] = useState<Slot>('current');

  /*
   * 지금 어느 칸을 받고 있는지는 ref 로도 들고 있는다.
   *
   * 상태만 두면 칸을 짚은 직후의 숫자가 앞 칸으로 들어간다 - 짚는 것과 누르는
   * 것이 같은 프레임에 들어오면 press 가 다시 그려지기 전의 값을 본다.
   * 사람 손으로는 드물지만, 드물다는 이유로 비밀번호가 엉뚱한 칸에 들어가는
   * 것을 남겨 둘 이유가 없다.
   */
  const atRef = useRef<Slot>('current');
  const setAt = (s: Slot) => { atRef.current = s; setAtState(s); };

  function press(k: string) {
    const at = atRef.current;
    setV((prev) => {
      const cur = prev[at];
      const next =
        k === 'back' ? cur.slice(0, -1)
        : k === 'clear' ? ''
        : cur.length >= 12 ? cur
        : cur + k;
      return { ...prev, [at]: next };
    });
  }

  const ready = v.current.length > 0 && v.next.length > 0 && v.again.length > 0;

  /*
   * 키보드. 로그인 화면과 같은 규칙이다 (app/login/login-form.tsx).
   *
   *   숫자       지금 고른 칸에 들어간다
   *   Backspace  한 자 지움
   *   Escape     그 칸 전체 지움
   *   Enter      다음 칸으로, 마지막 칸에서 셋 다 찼으면 보낸다
   *
   * Enter 의 기본 동작을 끊는 이유는 로그인 화면과 같다. 번호판을 마우스로
   * 누르면 초점이 그 숫자 단추에 남고, 그대로 두면 Enter 가 마지막 숫자를 한
   * 번 더 누른다.
   */
  const SLOTS: Slot[] = ['current', 'next', 'again'];
  const pressRef = useRef(press);
  pressRef.current = press;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      /* 글자 입력칸에 초점이 있으면 비켜선다. 거기서 치는 숫자는 그 칸의 것이다 */
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pressRef.current(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        pressRef.current('back');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        pressRef.current('clear');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const i = SLOTS.indexOf(atRef.current);
        if (i < SLOTS.length - 1) setAt(SLOTS[i + 1]);
        else if (readyRef.current && !pending) formRef.current?.requestSubmit();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  return (
    <form ref={formRef} action={action} className="w-full">
      <input type="hidden" name="current" value={v.current} />
      <input type="hidden" name="next" value={v.next} />
      <input type="hidden" name="again" value={v.again} />

      <div className="card-raised relative overflow-hidden">
        <div aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-brand" />

        <div className="divide-y divide-line-soft pt-[3px]">
          {(['current', 'next', 'again'] as Slot[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setAt(s)}
              /* Tab 으로 옮겨 와도 그 칸이 받는다. 초점과 받는 칸이 갈리면
                 어디에 치고 있는지 알 수 없다 */
              onFocus={() => setAt(s)}
              aria-label={`${LABEL[s]} 입력`}
              aria-current={at === s}
              className={`no-select relative flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors duration-150 ${
                at === s ? 'bg-brand-soft' : 'bg-surface hover:bg-surface-sub'
              }`}
            >
              <span aria-hidden
                    className={`absolute inset-y-0 left-0 w-[3px] transition-colors ${
                      at === s ? 'bg-brand' : 'bg-transparent'}`} />
              <span className={`w-[5.5rem] shrink-0 text-[0.6875rem] font-bold tracking-[0.06em] transition-colors ${
                      at === s ? 'text-brand' : 'text-muted'}`}>
                {LABEL[s]}
              </span>
              <span className="flex h-7 min-w-0 flex-1 items-center">
                <span className="truncate text-[1.5rem] font-semibold leading-none tnum tracking-[0.2em] text-ink">
                  {'•'.repeat(v[s].length)}
                </span>
                {at === s && (
                  <span aria-hidden
                        className="ml-0.5 inline-block h-6 w-[2px] shrink-0 animate-[blink_1.1s_steps(1,end)_infinite] rounded-full bg-brand" />
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-line bg-canvas p-3.5">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              aria-label={k === 'clear' ? '전체 지움' : k === 'back' ? '한 자 지움' : k}
              className="no-select h-14 rounded-lg border border-line bg-surface text-xl font-semibold text-ink transition-colors hover:bg-surface-sub active:bg-brand-soft"
            >
              {k === 'clear' ? <span className="text-xs font-bold">전체지움</span>
               : k === 'back' ? '⌫' : k}
            </button>
          ))}
        </div>
      </div>

      {state.error && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted">
        {PIN_MIN_LENGTH}자리 이상의 숫자입니다. 같은 숫자만 쓰거나 이어지는 숫자는
        정할 수 없습니다.
      </p>

      <button type="submit" disabled={!ready || pending}
              className="btn-primary mt-4 h-12 w-full text-base">
        {pending ? '바꾸는 중' : first ? '정하고 시작하기' : '비밀번호 바꾸기'}
      </button>
    </form>
  );
}
