'use client';

import { useActionState, useEffect, useReducer, useRef, useState } from 'react';
import { LOGIN_CODE_LENGTH } from '@/lib/auth-const';
import { login, type LoginState } from './actions';

type Field = 'code' | 'pin';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

/* ---------------------------------------------------------------------------
   로그인 입력

   번호판은 칸을 누르기 전까지 열지 않는다. 늘 펼쳐 두면 화면의 절반이 안 쓰는
   단추로 차 있고, 정작 어디에 값이 들어가는지가 묻힌다. 칸을 누르면 그 칸이
   켜지면서 번호판이 아래에서 열린다. 한 번 열리면 로그인 번호에서 비밀번호로
   넘어가는 동안 닫히지 않으므로, 더 누르는 횟수는 처음 한 번뿐이다.

   값과 입력 대상은 ref로 들고 화면만 다시 그린다. 상태로 두면 갱신이 다음
   렌더로 밀려서, 한 프레임에 두 번 이상 눌리면 그 사이 눌린 키가 옛 값을 보고
   판단한다. 그러면 비밀번호가 로그인 번호 칸에 그대로 이어 붙는다.
   장갑 낀 손으로 빠르게 누르면 실제로 재현된다.
--------------------------------------------------------------------------- */

export default function LoginForm({ owners }: { owners: string[] }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});

  // null 이면 번호판이 닫힌 상태다
  const [field, setField] = useState<Field | null>(null);
  const [askReset, setAskReset] = useState(false);

  const codeRef = useRef('');
  const pinRef = useRef('');
  const target = useRef<Field>('code');

  // 자동 이동은 한 번만. 사용자가 로그인 번호 칸을 다시 누르면 그때부터 끈다.
  // 자릿수가 다른 번호를 쓰는 현장에서 계속 튕겨 나가면 입력을 못 한다.
  const autoJump = useRef(true);

  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const formRef = useRef<HTMLFormElement>(null);

  function select(f: Field) {
    // 로그인 번호 칸을 다시 눌렀다면 자릿수가 다른 번호를 고쳐 넣겠다는 뜻이므로
    // 자동 이동을 끈다. 다만 비어 있는 칸을 눌러 번호판을 여는 것은 처음 시작하는
    // 동작이라 그대로 둔다. 이걸 구분하지 않으면 번호판을 여는 탭이 곧 자동 이동을
    // 꺼 버려서, 비밀번호가 로그인 번호 칸에 이어 붙는다.
    if (f === 'code' && codeRef.current.length > 0) autoJump.current = false;
    target.current = f;
    setField(f);
    setAskReset(false);
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

  /*
   * 실물 키보드.
   *
   * 사무 책상에서는 화면 단추보다 키보드가 빠르다. 숫자 · 백스페이스 · 엔터를
   * 화면 번호판의 같은 동작으로 잇는다. 값 처리 규칙(12자 상한 · 자동 이동)을
   * 두 벌로 만들지 않고 press() 하나를 같이 쓴다.
   *
   *   숫자       지금 칸에 들어간다. 칸을 고르기 전이면 사번부터 시작한다
   *   Backspace  한 자 지움
   *   Escape     전체 지움
   *   Enter      사번만 찼으면 비밀번호 칸으로, 둘 다 찼으면 로그인
   *
   * 비밀번호 초기화 패널의 글자 입력칸에 초점이 있을 때는 비켜선다. 거기서
   * 치는 숫자는 그 칸의 것이다.
   */
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        if (target.current === 'code' && field === null) setField('code');
        pressRef.current(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        pressRef.current('back');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        pressRef.current('clear');
      } else if (e.key === 'Tab') {
        /*
         * 키보드로 치면 초점이 <body> 에 남아, Tab 이 칸 사이가 아니라 문서
         * 전체를 돈다. 눌러도 아무 일이 없는 것처럼 보인다 (사용자 지적).
         *
         * 사번 ↔ 비밀번호 사이만 우리가 옮기고, 양 끝에서는 손을 뗀다 -
         * 끝에서도 붙잡으면 키보드만 쓰는 사람이 이 판을 빠져나갈 수 없다.
         */
        if (!e.shiftKey && target.current === 'code') {
          e.preventDefault();
          select('pin');
        } else if (e.shiftKey && target.current === 'pin') {
          e.preventDefault();
          select('code');
        }
      } else if (e.key === 'Enter') {
        /*
         * Enter 는 초점이 어디에 있든 "다음 칸 또는 로그인"이다.
         *
         * 번호판을 마우스로 누르면 초점이 그 숫자 단추에 남는다. 단추의 기본
         * 동작에 맡기면 Enter 가 마지막 숫자를 한 번 더 누르고, 실제로 웹에서
         * 비밀번호를 다 치고 Enter 를 쳤더니 사번 칸이 다시 열리는 일이 있었다.
         * 그래서 기본 동작을 끊고 우리 규칙 하나로 통일한다.
         * 단추를 키보드로만 다루는 경우에는 Space 가 기본 동작으로 남아 있다.
         */
        e.preventDefault();
        if (codeRef.current.length === 0) {
          select('code');
        } else if (pinRef.current.length === 0) {
          target.current = 'pin';
          setField('pin');
          redraw();
        } else if (!pending) {
          formRef.current?.requestSubmit();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [field, pending]);

  const code = codeRef.current;
  const pin = pinRef.current;
  const open = field !== null;
  const ready = code.length > 0 && pin.length > 0;

  return (
    <form ref={formRef} action={formAction} className="mt-6 w-full">
      <input type="hidden" name="login_code" value={code} />
      <input type="hidden" name="pin" value={pin} />

      <div className="card-raised relative overflow-hidden">
        {/* 카드 위쪽 브랜드 띠. 면에 무게를 준다 */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-brand" />

        <div className="divide-y divide-line-soft pt-[3px]">
          <Slot
            label="사번"
            value={code}
            active={field === 'code'}
            done={code.length >= LOGIN_CODE_LENGTH}
            onSelect={() => select('code')}
          />
          <Slot
            label="비밀번호"
            value={pin}
            mask
            active={field === 'pin'}
            done={pin.length >= 6}
            onSelect={() => select('pin')}
          />
        </div>

        {/* 번호판. 0fr 에서 1fr 로 늘려 높이를 부드럽게 연다 */}
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-out ${
            open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div
              aria-hidden={!open}
              inert={!open}
              className={`grid grid-cols-3 gap-2 border-t border-line bg-canvas p-3.5 transition-opacity duration-200 ${
                open ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  tabIndex={open ? 0 : -1}
                  onClick={() => press(k)}
                  aria-label={k === 'clear' ? '전체 지움' : k === 'back' ? '한 자 지움' : k}
                  className={k === 'clear' || k === 'back' ? 'padkey padkey-alt' : 'padkey'}
                >
                  {k === 'clear' ? '전체지움' : k === 'back' ? '⌫' : k}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {state.error && (
        <p
          role="alert"
          className="rise mt-3 flex items-start gap-2 rounded-lg border border-danger-line bg-danger-bg px-3.5 py-2.5 text-sm leading-relaxed text-danger"
        >
          <span aria-hidden className="mt-px font-bold">!</span>
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !ready}
        className="btn-primary mt-3.5 h-[3.5rem] w-full rounded-xl text-base tracking-tight"
      >
        {pending ? '확인 중' : '로그인'}
      </button>

      <div className="mt-3.5 text-center">
        <button
          type="button"
          onClick={() => setAskReset((v) => !v)}
          aria-expanded={askReset}
          className="rounded px-2 py-1 text-xs font-semibold text-muted transition-colors hover:text-brand"
        >
          비밀번호 초기화
        </button>
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-250 ease-out ${
          askReset ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="rounded-lg border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
            {owners.length > 0 ? (
              <>
                <b className="text-ink">{owners.join(' · ')}</b> 에게 요청하십시오.
                초기화한 뒤에는 본인이 바로 바꾸십시오.
              </>
            ) : (
              <>초기화할 수 있는 계정이 등록되어 있지 않습니다.</>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function Slot({
  label, value, active, done, mask = false, onSelect,
}: {
  label: string; value: string; active: boolean; done: boolean;
  mask?: boolean; onSelect: () => void;
}) {
  const shown = mask ? '•'.repeat(value.length) : value;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${label} 입력`}
      aria-current={active}
      className={`no-select relative flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors duration-150 ${
        active ? 'bg-brand-soft' : 'bg-surface hover:bg-surface-sub'
      }`}
    >
      {/* 지금 입력받는 칸을 왼쪽 띠로 먼저 말한다 */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[3px] transition-colors ${
          active ? 'bg-brand' : 'bg-transparent'
        }`}
      />

      <span
        className={`w-[3.5rem] shrink-0 text-[0.6875rem] font-bold tracking-[0.06em] transition-colors ${
          active ? 'text-brand' : 'text-muted'
        }`}
      >
        {label}
      </span>

      <span className="flex h-7 min-w-0 flex-1 items-center">
        <span className="truncate text-[1.5rem] font-semibold leading-none tnum tracking-[0.2em] text-ink">
          {shown}
        </span>
        {active && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-6 w-[2px] shrink-0 animate-[blink_1.1s_steps(1,end)_infinite] rounded-full bg-brand"
          />
        )}
      </span>

      <span
        aria-hidden
        className={`shrink-0 text-sm font-bold text-brand transition-opacity duration-150 ${
          done ? 'opacity-100' : 'opacity-0'
        }`}
      >
        &#10003;
      </span>
    </button>
  );
}
