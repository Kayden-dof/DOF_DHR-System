'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { unlock, type LoginState } from '@/app/lock-action';
import { logout } from '@/app/(admin)/actions';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

/* ---------------------------------------------------------------------------
   자리 비움 잠금

   현장 패드는 한 대를 여러 사람이 번갈아 쓴다. 앞사람이 로그아웃을 잊으면 다음
   사람의 작업이 앞사람 이름으로 기록된다. 기록은 지울 수 없어 정정 기록으로만
   바로잡을 수 있고, 이미 인쇄된 묶음은 고칠 방법이 없다.

   사무 화면에도 건다 (감사 지적 12). 여기서 하는 일이 더 되돌리기 어렵다 -
   작업 지시 발행, 기준정보 변경, 인쇄. 세션이 여덟 시간이므로 자리를 비운
   사이가 짧지 않다. 다만 손이 늦게 움직이는 화면이라 시간은 길게 준다.

   로그아웃이 아니라 잠금이다. 세션은 8시간 그대로 두고 화면만 덮는다.
   비밀번호를 다시 누르면 하던 자리로 돌아오고 쓰던 입력도 그대로 남는다.
   공정을 끝내고 손을 씻고 오면 처음부터 다시 쳐야 하는 일이 없어야 한다.

   본인 확인이므로 사번은 묻지 않는다. 다른 사람이라면 로그아웃하고 자기
   계정으로 들어와야 한다. 그 길도 같이 열어 둔다.
--------------------------------------------------------------------------- */

export default function IdleLock({
  minutes, name, initial,
}: { minutes: number; name: string; initial: string }) {
  const [locked, setLocked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActive = useRef(Date.now());

  const ms = minutes * 60_000;

  useEffect(() => {
    if (locked) return;

    /*
     * 남은 시간을 마지막 조작 시각에서 계산한다.
     *
     * 타이머만 다시 걸면 화면이 잠들었다 깨어날 때마다 시간이 새로 시작된다.
     * 패드를 덮어 두고 자리를 비운 경우가 정확히 그 상황이라, 그렇게 두면
     * 가장 잠겨야 할 때 잠기지 않는다. 브라우저도 배경에서는 타이머를 늦춘다.
     */
    const tick = () => {
      const left = ms - (Date.now() - lastActive.current);
      if (left <= 0) { setLocked(true); return; }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(tick, Math.min(left, 30_000));
    };

    const touch = () => { lastActive.current = Date.now(); };

    // 손이 닿는 모든 것을 센다. passive 로 붙여 스크롤을 늦추지 않는다.
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of evs) window.addEventListener(e, touch, { passive: true });
    document.addEventListener('visibilitychange', tick);

    tick();

    return () => {
      for (const e of evs) window.removeEventListener(e, touch);
      document.removeEventListener('visibilitychange', tick);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [locked, ms]);

  if (!locked) return null;
  return (
    <LockScreen
      name={name}
      initial={initial}
      onOpen={() => { lastActive.current = Date.now(); setLocked(false); }}
    />
  );
}

/* -------------------------------------------------------------------------- */

function LockScreen({
  name, initial, onOpen,
}: { name: string; initial: string; onOpen: () => void }) {
  const pin = useRef('');
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [state, setState] = useState<LoginState>({});
  const [busy, setBusy] = useState(false);

  function press(k: string) {
    if (busy) return;
    if (k === 'clear') { pin.current = ''; setState({}); redraw(); return; }
    pin.current = k === 'back'
      ? pin.current.slice(0, -1)
      : pin.current.length >= 12 ? pin.current : pin.current + k;
    setState({});
    redraw();
  }

  /*
   * 실물 키보드. 로그인 화면과 같은 규칙이다. 현장 패드에 키보드가 없어도
   * 관리 장비에서 같은 화면이 뜨는 일이 있고, 손해 볼 것이 없다.
   */
  // 등록은 한 번, 실행은 늘 최신 렌더의 함수로. press 와 submit 이 busy 상태를
  // 닫아 두므로, 최초 클로저를 그대로 부르면 낡은 busy 를 보고 판단한다.
  const keysRef = useRef({ press, submit });
  keysRef.current = { press, submit };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); keysRef.current.press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); keysRef.current.press('back'); }
      else if (e.key === 'Escape') { e.preventDefault(); keysRef.current.press('clear'); }
      else if (e.key === 'Enter') {
        // 번호판을 마우스로 누른 뒤의 Enter 도 잠금 해제여야 한다. 단추 기본
        // 동작(마지막 숫자 재입력)을 끊는다. 로그아웃 단추는 Space 로 눌린다.
        e.preventDefault();
        void keysRef.current.submit();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function submit() {
    if (busy || !pin.current) return;
    setBusy(true);
    const r = await unlock(pin.current);
    setBusy(false);
    if (r.error) {
      pin.current = '';
      setState(r);
      redraw();
      return;
    }
    pin.current = '';
    onOpen();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="자리 비움 잠금"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-indigo-deep/95 p-5 backdrop-blur-sm"
    >
      <div className="w-full max-w-[22rem] py-6">
        <div className="text-center">
          <span
            aria-hidden
            className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/15 text-xl font-bold text-white"
          >
            {initial}
          </span>
          <h2 className="mt-4 text-xl font-bold text-white">{name} 님</h2>
          <p className="mt-1.5 text-sm text-on-dark-mute">
            자리를 비운 사이 화면을 잠갔습니다. 비밀번호를 누르면 하던 자리로 돌아갑니다.
          </p>
        </div>

        <div className="card-raised mt-6 p-4">
          <div className="flex h-[3.25rem] items-center justify-center rounded-md border border-line-strong bg-surface">
            <span className="text-2xl font-semibold tnum tracking-[0.3em] text-ink">
              {'•'.repeat(pin.current.length) || (
                <span className="text-faint">&middot;</span>
              )}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
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
            <p role="alert"
               className="rise mt-3 rounded-md border border-danger-line bg-danger-bg px-3.5 py-2.5 text-sm leading-relaxed text-danger">
              {state.error}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={busy || !pin.current}
            className="btn-primary mt-3 h-[3.25rem] w-full text-base"
          >
            {busy ? '확인 중' : '잠금 해제'}
          </button>
        </div>

        {/* 다른 사람이면 자기 계정으로 들어가야 한다 */}
        <form action={logout} className="mt-5 text-center">
          <button type="submit"
                  className="rounded px-2 py-1 text-xs font-semibold text-on-dark-mute transition-colors hover:text-white">
            다른 사람이 쓰려면 로그아웃
          </button>
        </form>
      </div>
    </div>
  );
}
