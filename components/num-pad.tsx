'use client';

import { useEffect, useRef, useState } from 'react';

/* ---------------------------------------------------------------------------
   숫자 패드

   현장은 장갑을 낀 손이다. 누르는 판이 먼저다.
   값은 항상 함수형으로 갱신한다. 이전 렌더의 값을 더하면 빠르게 연타할 때
   자릿수가 조용히 사라진다.

   키보드도 받는다 (사용자 2026-11-20 «이 기능 키보드도 먹히도록 해줘»). 숫자 · 소수점(. ,) ·
   Backspace 한 자 지움 · Delete 전체 지움 · Enter 저장(onEnter, 없으면 이 판이 든 폼 제출).
   한 화면에 판이 둘 이상이면 가장 나중에 열리거나 누른 판 하나만 받는다. 글을 적는 칸
   (input · textarea · select)에 커서가 있으면 그 칸이 키를 받는다.
--------------------------------------------------------------------------- */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/* 키보드를 받는 판. 열린 차례대로 쌓고, 맨 위가 받는다. 누르면 그 판이 맨 위로 온다 */
const pads: symbol[] = [];
const toTop = (id: symbol) => {
  const at = pads.indexOf(id);
  if (at >= 0) pads.splice(at, 1);
  pads.push(id);
};

export default function NumPad({
  name, label, unit, initial = '', max, allowDecimal = true, hint, onChange, onEnter,
}: {
  name: string;
  label: string;
  unit?: string;
  initial?: string;
  max?: number;
  allowDecimal?: boolean;
  hint?: React.ReactNode;
  onChange?: (v: string) => void;
  /** 키보드 Enter. 없으면 이 판이 든 폼을 제출한다 */
  onEnter?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const me = useRef<symbol>(Symbol('numpad'));

  /* 열리면 키보드를 받는 판이 된다 */
  useEffect(() => {
    const id = me.current;
    toTop(id);
    return () => {
      const at = pads.indexOf(id);
      if (at >= 0) pads.splice(at, 1);
    };
  }, []);

  /* 키보드 - 매 렌더 새로 걸어 지금의 값 · onEnter 를 쓴다 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pads[pads.length - 1] !== me.current) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      const k = e.key;
      if (/^[0-9]$/.test(k)) { e.preventDefault(); press(k); }
      else if (k === '.' || k === ',' || k === 'Decimal') { e.preventDefault(); press('.'); }
      else if (k === 'Backspace') { e.preventDefault(); press('back'); }
      else if (k === 'Delete') { e.preventDefault(); set(() => ''); }
      else if (k === 'Enter') {
        e.preventDefault();
        if (onEnter) onEnter();
        else ref.current?.form?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const set = (fn: (v: string) => string) =>
    setValue((v) => {
      const next = fn(v);
      onChange?.(next);
      return next;
    });

  function press(k: string) {
    if (k === 'back') return set((v) => v.slice(0, -1));
    if (k === '.') {
      if (!allowDecimal) return;
      return set((v) => (v.includes('.') ? v : (v === '' ? '0.' : v + '.')));
    }
    set((v) => {
      const next = v === '0' ? k : v + k;
      if (next.replace('.', '').length > 9) return v;
      if (max !== undefined && Number(next) > max) return v;
      return next;
    });
  }

  const over = max !== undefined && Number(value || 0) > max;

  return (
    <div onPointerDown={() => toTop(me.current)}>
      <div className="flex items-baseline justify-between">
        <span className="label mb-0">{label}</span>
        {max !== undefined && (
          <span className="text-xs text-muted tnum">최대 {max}{unit ? ` ${unit}` : ''}</span>
        )}
      </div>

      <input ref={ref} type="hidden" name={name} value={value} readOnly />

      <div
        className={`input mt-1.5 flex items-center justify-end ${
          over ? 'border-danger bg-danger-bg' : ''
        }`}
      >
        <span className="text-2xl font-semibold tnum text-ink">
          {value || <span className="text-faint">0</span>}
        </span>
        {unit && <span className="ml-2 text-sm text-muted">{unit}</span>}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            disabled={k === '.' && !allowDecimal}
            className={k === 'back' || k === '.' ? 'padkey padkey-alt' : 'padkey'}
          >
            {k === 'back' ? '지움' : k}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => set(() => '')}
                className="btn-ghost flex-1">
          전체 지움
        </button>
        {max !== undefined && (
          <button type="button" onClick={() => set(() => String(max))}
                  className="btn-ghost flex-1">
            최대로
          </button>
        )}
      </div>

      {hint && <p className="mt-2 text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

/* 미리 정한 문구에서 고른다. 현장에서 문장을 타이핑하지 않는다. */
export function PresetPicker({
  name, label, presets, allowNone = true,
}: { name: string; label: string; presets: string[]; allowNone?: boolean }) {
  const [value, setValue] = useState('');

  return (
    <div>
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={value} readOnly />
      <div className="grid gap-2 sm:grid-cols-2">
        {allowNone && (
          <button type="button" onClick={() => setValue('')}
                  data-on={value === ''} className="tile">
            <span className="text-sm font-semibold">해당 없음</span>
          </button>
        )}
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => setValue(p)}
                  data-on={value === p} className="tile">
            <span className="text-sm font-semibold">{p}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
