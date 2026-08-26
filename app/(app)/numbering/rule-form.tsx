'use client';

import { useActionState, useEffect, useState } from 'react';
import { RESET_CYCLES } from '@/lib/forms';
import type { FormState } from '@/lib/forms';
import { saveRule, previewPattern, type Preview } from './actions';

export interface ExistingRule {
  id: string;
  pattern: string;
  reset: string;
  seq_width: number;
}

const TOKENS = [
  { t: '{YYYY}', d: '연도 4자리' },
  { t: '{YY}', d: '연도 2자리' },
  { t: '{MM}', d: '월' },
  { t: '{DD}', d: '일' },
  { t: '{SEQ:4}', d: '순번' },
  { t: '{ITEM}', d: '품목 코드 (M1)' },
  { t: '{MODEL}', d: '형명 뒤 8자리 (M1)' },
];

const cycleLabel = (c: string) => RESET_CYCLES.find((r) => r.code === c)?.label ?? c;

export default function RuleForm({
  target,
  targetLabel,
  existing,
  today,
  onDone,
}: {
  target: string;
  targetLabel: string;
  existing: ExistingRule | null;
  today: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveRule, {});
  const [pattern, setPattern] = useState(existing?.pattern ?? '');
  const [reset, setReset] = useState(existing?.reset ?? 'YEARLY');
  const [seqWidth, setSeqWidth] = useState(existing?.seq_width ?? 4);
  const [preview, setPreview] = useState<Preview>({});

  useEffect(() => {
    const id = setTimeout(() => {
      previewPattern(pattern, seqWidth).then(setPreview);
    }, 250);
    return () => clearTimeout(id);
  }, [pattern, seqWidth]);

  const noSeqToken = !!preview.first && preview.first === preview.second;
  const cycleChanged = !!existing && existing.reset !== reset;
  const samePattern = !!existing && existing.pattern === pattern.trim();

  // 성공하면 폼을 접고 결과만 남긴다. 등록됐다는 확인이 화면에 없으면
  // 같은 규칙을 두 번 넣게 된다. 그러면 활성 규칙 중복으로 거부되거나,
  // 교체 경로에서는 이력만 지저분해진다.
  if (state.ok && state.message) {
    return (
      <div className="border-t border-line bg-ok-bg px-4 py-4">
        <p className="text-sm leading-relaxed text-ink">
          <span className="chip mr-2 bg-ok text-white">완료</span>
          {state.message}
        </p>
        <button type="button" onClick={onDone} className="btn-ghost mt-3 h-9 px-3 text-xs">
          닫기
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="border-t border-line bg-canvas px-4 py-4">
      <input type="hidden" name="target" value={target} />
      {existing && <input type="hidden" name="replacing" value={existing.id} />}

      <p className="mb-3 text-xs leading-relaxed text-muted">
        {existing ? (
          <>
            <b className="text-ink">규칙 교체</b> - 기존 규칙{' '}
            <code className="font-mono">{existing.pattern}</code>을 내리고 새 규칙을
            등록합니다. 한 번에 처리되므로 채번이 끊기는 순간은 없습니다.
          </>
        ) : (
          <>
            <b className="text-ink">{targetLabel}</b> 채번 규칙을 등록합니다.
          </>
        )}{' '}
        <b className="text-ink">등록한 규칙은 수정할 수 없습니다.</b> 바꾸려면 내리고 새로
        등록해야 하며, 그 이력이 남습니다.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`pattern-${target}`}>패턴</label>
          <input
            id={`pattern-${target}`}
            name="pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="DX-{YY}{MM}-{SEQ:4}"
            required
            className="input font-mono"
            autoComplete="off"
          />
        </div>

        <div>
          <label className="label" htmlFor={`reset-${target}`}>순번 초기화 주기</label>
          <select
            id={`reset-${target}`}
            name="reset"
            value={reset}
            onChange={(e) => setReset(e.target.value)}
            className="input"
          >
            {RESET_CYCLES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label} - {c.note}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor={`width-${target}`}>순번 자릿수</label>
            <input
              id={`width-${target}`}
              name="seq_width"
              type="number"
              min={1}
              max={10}
              value={seqWidth}
              onChange={(e) => setSeqWidth(Number(e.target.value))}
              className="input tnum"
            />
          </div>
          <div>
            <label className="label" htmlFor={`eff-${target}`}>시행일</label>
            <input
              id={`eff-${target}`}
              name="effective_from"
              type="date"
              defaultValue={today}
              required
              className="input tnum"
            />
          </div>
        </div>
      </div>

      {/* 토큰 도움말 -------------------------------------------------------- */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {TOKENS.map((k) => (
          <button
            key={k.t}
            type="button"
            onClick={() => setPattern((p) => p + k.t)}
            title={k.d}
            className="rounded border border-line-strong bg-surface px-2 py-1 font-mono text-xs
                       text-muted hover:border-brand hover:text-brand"
          >
            {k.t}
          </button>
        ))}
      </div>

      {/* 미리보기 ----------------------------------------------------------- */}
      <div className="mt-4 rounded-md border border-line bg-surface px-4 py-3">
        <p className="label mb-2">형식 미리보기</p>
        {preview.error ? (
          <p className="text-sm text-danger">{preview.error}</p>
        ) : preview.first ? (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="font-mono text-lg font-semibold tnum text-ink">{preview.first}</span>
            <span className="font-mono text-sm tnum text-muted">→ {preview.second}</span>
          </div>
        ) : (
          <p className="text-sm text-faint">패턴을 입력하면 형식이 표시됩니다.</p>
        )}
        <p className="mt-2 text-xs text-faint">
          순번 1·2회차의 형식입니다. 실제 다음 순번은 표시하지 않습니다 (§4.10 - 카운터는
          관리 화면에서도 노출하지 않습니다).
        </p>
      </div>

      {/* 경고 --------------------------------------------------------------- */}
      {noSeqToken && (
        <Alert tone="danger">
          패턴에 순번 토큰이 없습니다. 1회차와 2회차가 같은 번호로 나옵니다
          첫 발행 이후 전부 중복이 됩니다. <code className="font-mono">{'{SEQ:4}'}</code>를
          넣으십시오.
        </Alert>
      )}

      {cycleChanged && (
        <Alert tone={samePattern ? 'danger' : 'warn'}>
          <b>순번이 이어지지 않습니다.</b> 초기화 주기를 {cycleLabel(existing!.reset)}에서{' '}
          {cycleLabel(reset)}로 바꾸면 카운터의 주기 키가 달라져 승계가 일어나지 않고 1번부터
          시작합니다.
          {samePattern && (
            <>
              {' '}
              <b>패턴까지 기존과 같으므로 이미 발행된 번호가 그대로 다시 나옵니다.</b> 패턴을
              함께 바꾸십시오.
            </>
          )}
        </Alert>
      )}

      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? '처리 중…' : existing ? '규칙 교체' : '규칙 등록'}
        </button>
        <button type="button" onClick={onDone} className="btn-ghost">
          취소
        </button>
      </div>
    </form>
  );
}

function Alert({ tone, children }: { tone: 'danger' | 'warn'; children: React.ReactNode }) {
  const cls =
    tone === 'danger'
      ? 'bg-danger-bg text-danger border-danger/30'
      : 'bg-warn-bg text-warn border-warn/30';
  return (
    <p role="alert" className={`mt-3 rounded-md border px-3 py-2 text-sm leading-relaxed ${cls}`}>
      {children}
    </p>
  );
}
