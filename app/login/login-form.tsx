'use client';

import { useActionState, useReducer, useRef, useState } from 'react';
import { LOGIN_CODE_LENGTH } from '@/lib/auth-const';
import { login, type LoginState } from './actions';

type Field = 'code' | 'pin';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

export default function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});
  const [field, setField] = useState<Field>('code');

  // 값과 입력 대상을 모두 ref로 들고 화면만 다시 그린다.
  //
  // 상태로 두면 값이 갱신되는 시점이 다음 렌더로 밀린다. 한 번에 두 번 이상
  // 눌리면 그 사이 눌린 키가 아직 옛 값을 보고 판단해 자릿수를 세지 못하고,
  // 비밀번호가 로그인 번호 칸에 그대로 이어 붙는다. 장갑 낀 손으로 빠르게
  // 누르면 실제로 재현된다. ref는 누르는 즉시 반영되므로 연타에 영향받지 않는다.
  const codeRef = useRef('');
  const pinRef = useRef('');
  const target = useRef<Field>('code');

  // 자동 이동은 한 번만. 사용자가 로그인 번호 칸을 다시 누르면 그때부터 끈다.
  // 자릿수가 다른 번호를 쓰는 현장에서 계속 튕겨 나가면 입력을 못 한다.
  const autoJump = useRef(true);

  const [, redraw] = useReducer((n: number) => n + 1, 0);

  function select(f: Field) {
    if (f === 'code') autoJump.current = false;
    target.current = f;
    setField(f);
  }

  function press(k: string) {
    if (k === 'clear') {
      // 전체 지움은 처음부터 다시 치겠다는 뜻이다. 자동 이동도 되살린다.
      codeRef.current = '';
      pinRef.current = '';
      autoJump.current = true;
      target.current = 'code';
      setField('code');
      redraw();
      return;
    }

    const slot = target.current === 'code' ? codeRef : pinRef;
    slot.current =
      k === 'back'
        ? slot.current.slice(0, -1)
        : slot.current.length >= 12
          ? slot.current
          : slot.current + k;

    // 자릿수를 채우면 비밀번호 칸으로 알아서 넘어간다. 장갑 낀 손으로 칸을
    // 다시 짚는 동작을 없앤다. 판정도 ref라 다음 키 입력에 바로 반영된다.
    if (
      target.current === 'code' &&
      autoJump.current &&
      codeRef.current.length === LOGIN_CODE_LENGTH
    ) {
      autoJump.current = false;
      target.current = 'pin';
      setField('pin');
    }

    redraw();
  }

  const code = codeRef.current;
  const pin = pinRef.current;

  return (
    <form action={formAction} className="mt-7 w-full">
      <input type="hidden" name="login_code" value={code} />
      <input type="hidden" name="pin" value={pin} />

      <div className="card-raised overflow-hidden p-5">
        <div className="grid grid-cols-2 gap-2.5">
          <Slot
            label="로그인 번호"
            display={code}
            active={field === 'code'}
            filled={code.length >= LOGIN_CODE_LENGTH}
            onSelect={() => select('code')}
          />
          <Slot
            label="비밀번호"
            display={'•'.repeat(pin.length)}
            active={field === 'pin'}
            filled={pin.length >= 6}
            onSelect={() => select('pin')}
          />
        </div>

        <div className="mt-3.5 grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              aria-label={k === 'clear' ? '전체 지움' : k === 'back' ? '한 자 지움' : k}
              className={k === 'clear' || k === 'back' ? 'padkey padkey-alt' : 'padkey'}
            >
              {k === 'clear' ? '전체지움' : k === 'back' ? '⌫' : k}
            </button>
          ))}
        </div>

        {state.error && (
          <p
            role="alert"
            className="rise mt-3.5 flex items-start gap-2 rounded-md border border-danger-line bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger"
          >
            <span aria-hidden className="mt-px font-bold">!</span>
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || !code || !pin}
          className="btn-primary mt-3.5 h-12 w-full text-[0.9375rem]"
        >
          {pending ? '확인 중' : '로그인'}
        </button>
      </div>

      <p className="mt-5 text-center text-xs leading-relaxed text-faint">
        로그인 번호 {LOGIN_CODE_LENGTH}자리를 누르면 비밀번호 칸으로 넘어갑니다.
        <br />세션은 8시간 유지됩니다. 자리를 비울 때는 로그아웃하십시오.
      </p>
    </form>
  );
}

function Slot({
  label, display, active, filled, onSelect,
}: {
  label: string; display: string; active: boolean; filled: boolean; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={`no-select relative w-full rounded-md border px-3 pb-2 pt-2.5 text-left transition-all duration-150 ${
        active
          ? 'border-brand bg-brand-soft shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_16%,transparent)]'
          : 'border-line-strong bg-surface hover:border-faint'
      }`}
    >
      <span className={`block text-[0.6875rem] font-bold tracking-wide ${
        active ? 'text-brand' : 'text-muted'}`}>
        {label}
      </span>
      <span className="mt-0.5 block h-7 truncate text-xl font-semibold tnum tracking-[0.14em] text-ink">
        {display || <span className="text-faint">&middot;</span>}
      </span>
      {filled && (
        <span aria-hidden className="absolute right-2.5 top-2.5 text-xs font-bold text-brand">
          &#10003;
        </span>
      )}
    </button>
  );
}
