'use client';

import { useActionState, useState } from 'react';
import { login, type LoginState } from './actions';

type Field = 'code' | 'pin';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

export default function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [field, setField] = useState<Field>('code');

  const value = field === 'code' ? code : pin;
  const setValue = field === 'code' ? setCode : setPin;

  function press(k: string) {
    if (k === 'clear') return setValue('');
    if (k === 'back') return setValue(value.slice(0, -1));
    if (value.length >= 12) return;
    setValue(value + k);
  }

  return (
    <form action={formAction} className="w-full max-w-sm">
      <input type="hidden" name="login_code" value={code} />
      <input type="hidden" name="pin" value={pin} />

      <div className="card p-6">
        <div className="space-y-3">
          <Slot
            label="로그인 번호"
            display={code}
            active={field === 'code'}
            onSelect={() => setField('code')}
          />
          <Slot
            label="비밀번호"
            display={'•'.repeat(pin.length)}
            active={field === 'pin'}
            onSelect={() => setField('pin')}
          />
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className={
                k === 'clear' || k === 'back'
                  ? 'h-14 rounded-md border border-line-strong text-sm font-semibold text-muted hover:bg-canvas active:bg-line'
                  : 'h-14 rounded-md border border-line-strong bg-surface text-xl font-semibold tnum hover:bg-canvas active:bg-line'
              }
            >
              {k === 'clear' ? '전체지움' : k === 'back' ? '←' : k}
            </button>
          ))}
        </div>

        {state.error && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger"
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || !code || !pin}
          className="btn-primary mt-4 h-12 w-full text-base"
        >
          {pending ? '확인 중…' : '로그인'}
        </button>
      </div>

      <p className="mt-4 text-center text-xs leading-relaxed text-faint">
        세션은 8시간 유지됩니다. 자리를 비울 때는 로그아웃하십시오.
      </p>
    </form>
  );
}

function Slot({
  label, display, active, onSelect,
}: { label: string; display: string; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        active ? 'border-brand ring-2 ring-brand/20 bg-brand-soft' : 'border-line-strong bg-surface'
      }`}
    >
      <span className="block text-xs font-semibold text-muted">{label}</span>
      <span className="block h-7 text-xl tnum tracking-widest text-ink">
        {display || <span className="text-faint">—</span>}
      </span>
    </button>
  );
}
