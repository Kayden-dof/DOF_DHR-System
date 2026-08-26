'use client';

import { useRef, useState } from 'react';

/* ---------------------------------------------------------------------------
   숫자 패드

   현장은 장갑을 낀 손이다. 키보드를 쓰지 않는다.
   값은 항상 함수형으로 갱신한다. 이전 렌더의 값을 더하면 빠르게 연타할 때
   자릿수가 조용히 사라진다.
--------------------------------------------------------------------------- */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

export default function NumPad({
  name, label, unit, initial = '', max, allowDecimal = true, hint, onChange,
}: {
  name: string;
  label: string;
  unit?: string;
  initial?: string;
  max?: number;
  allowDecimal?: boolean;
  hint?: React.ReactNode;
  onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

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
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label mb-0">{label}</span>
        {max !== undefined && (
          <span className="text-xs text-muted tnum">최대 {max}{unit ? ` ${unit}` : ''}</span>
        )}
      </div>

      <input ref={ref} type="hidden" name={name} value={value} readOnly />

      <div
        className={`mt-1.5 flex h-14 items-center justify-end rounded-md border px-4 ${
          over ? 'border-danger bg-danger-bg' : 'border-line-strong bg-surface'
        }`}
      >
        <span className="text-2xl font-bold tnum text-ink">
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
                className="btn-ghost h-11 flex-1 text-sm">
          전체 지움
        </button>
        {max !== undefined && (
          <button type="button" onClick={() => set(() => String(max))}
                  className="btn-ghost h-11 flex-1 text-sm">
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
