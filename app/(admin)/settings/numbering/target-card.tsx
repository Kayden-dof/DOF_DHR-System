'use client';

import { useActionState, useState } from 'react';
import { fmtDate, fmtDateTime, shortId } from '@/lib/fmt';
import { RESET_CYCLES, type FormState } from '@/lib/forms';
import { retireRule } from './actions';
import RuleForm, { type ItemOption } from './rule-form';

export interface RuleRow {
  id: string;
  target: string;
  item_id: string | null;
  pattern: string;
  reset: string;
  seq_width: number;
  is_active: boolean;
  effective_from: string;
  registered_at: Date;
  registered_by_name: string;
  sample: string;
  item_code: string | null;
  item_name: string | null;
}

const cycleLabel = (c: string) => RESET_CYCLES.find((r) => r.code === c)?.label ?? c;

export default function TargetCard({
  code, label, note, rules, items, today, writable = true,
}: {
  code: string;
  label: string;
  note: string;
  rules: RuleRow[];
  items: ItemOption[];
  today: string;
  /** 이 세션이 쓸 수 있는가. 못 쓰면 등록 · 교체 · 내림을 아예 그리지 않는다 */
  writable?: boolean;
}) {
  /*
   * 두 길을 갈라 둔다.
   *
   *   replace  공통 규칙을 내리고 새로 등록한다. 한 트랜잭션에서 끝난다
   *   item     품목별 규칙을 하나 더 얹는다. 내리는 것이 없다
   *
   * 하나로 두었더니 품목별 규칙을 얹으려고 연 폼이 교체 모드라, 등록하는 순간
   * 공통 규칙이 함께 내려갔다. 품목별 규칙은 공통 규칙과 나란히 사는 것이지
   * 대신하는 것이 아니다 (§4.10).
   */
  const [open, setOpen] = useState<'replace' | 'item' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [retireState, retireAction, retiring] = useActionState<FormState, FormData>(
    retireRule, {},
  );

  const active = rules.find((r) => r.is_active && !r.item_id) ?? null;
  /*
   * 품목별 활성 규칙. 공통 규칙보다 우선한다 (§4.10).
   *
   * 공통 규칙 하나만 보여 주고 있었더니, 품목별 규칙이 등록되어 있어도 화면은
   * 공통 규칙을 그대로 띄웠다. 실제 발행은 품목별 규칙을 쓰는데 화면은 다른
   * 형식을 보여 주는 셈이다.
   */
  const perItem = rules.filter((r) => r.is_active && r.item_id);
  const history = rules.filter((r) => r !== active && !perItem.includes(r));

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3">
        <h2 className="text-sm font-bold text-ink">{label}</h2>
        <code className="font-mono text-xs text-faint">{note}</code>
        {!active && (
          <span className="chip bg-warn-bg text-warn">규칙 없음 · 채번 불가</span>
        )}
        <div className="ml-auto flex gap-2">
          {writable && !open && items.length > 0 && active && (
            <button onClick={() => setOpen('item')} className="btn-ghost h-8 px-3 text-xs">
              품목별 규칙
            </button>
          )}
          {writable && !open && (
            <button onClick={() => setOpen('replace')} className="btn-ghost h-8 px-3 text-xs">
              {active ? '규칙 교체' : '규칙 등록'}
            </button>
          )}
          {writable && active && !open && !confirming && (
            <button
              onClick={() => setConfirming(true)}
              className="btn-ghost h-8 px-3 text-xs text-muted"
            >
              내리기
            </button>
          )}
        </div>
      </header>

      {active ? (
        <div className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="패턴">
            <code className="font-mono text-sm font-semibold text-ink">{active.pattern}</code>
          </Field>
          <Field label="형식 예시">
            <span className="font-mono text-sm tnum text-brand">{active.sample}</span>
          </Field>
          <Field label="초기화 주기">{cycleLabel(active.reset)}</Field>
          <Field label="순번 자릿수">
            <span className="tnum">{active.seq_width}</span>
          </Field>
          <Field label="시행일">
            <span className="tnum">{fmtDate(active.effective_from)}</span>
          </Field>
          <Field label="등록자">{active.registered_by_name}</Field>
          <Field label="등록 일시">
            <span className="tnum">{fmtDateTime(active.registered_at)}</span>
          </Field>
          <Field label="규칙 ID">
            <span className="font-mono text-xs text-faint">{shortId(active.id)}</span>
          </Field>
        </div>
      ) : (
        <p className="px-4 py-4 text-sm leading-relaxed text-muted">
          활성 규칙이 없습니다. 이 대상으로 <code className="font-mono">next_number()</code>를
          부르면 예외가 납니다.
        </p>
      )}

      {perItem.length > 0 && (
        <div className="border-t border-line-soft">
          <p className="bg-surface-low px-4 py-2 text-[0.6875rem] font-bold tracking-wide text-muted">
            품목별 규칙 {perItem.length}건 · 공통 규칙보다 우선합니다
          </p>
          <ul className="divide-y divide-line-soft">
            {perItem.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="font-mono text-[0.8125rem] font-bold text-ink">
                  {r.item_code}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{r.item_name}</span>
                <code className="font-mono text-xs text-body">{r.pattern}</code>
                <span className="font-mono text-xs tnum text-brand">{r.sample}</span>
                {writable && (
                  <form action={retireAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" disabled={retiring}
                            className="btn-quiet h-7 px-2 text-xs">
                      내리기
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {retireState.ok && retireState.message && (
        <p className="border-t border-line bg-ok-bg px-4 py-3 text-sm leading-relaxed text-ink">
          <span className="chip mr-2 bg-ok text-white">완료</span>
          {retireState.message}
        </p>
      )}

      {confirming && active && (
        <form action={retireAction} className="border-t border-line bg-warn-bg px-4 py-3">
          <input type="hidden" name="id" value={active.id} />
          <p className="text-sm leading-relaxed text-ink">
            <b>{label}</b> 규칙을 내립니다. 내린 규칙은 <b>다시 활성화할 수 없습니다.</b>{' '}
            새 규칙을 등록하기 전까지 이 대상은 채번할 수 없습니다.
          </p>
          {retireState.error && (
            <p role="alert" className="mt-2 text-sm text-danger">{retireState.error}</p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={retiring} className="btn-danger h-9 px-3 text-xs">
              {retiring ? '처리 중…' : '내린다'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="btn-ghost h-9 px-3 text-xs"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {open === 'replace' && (
        <RuleForm
          target={code}
          targetLabel={label}
          existing={
            active
              ? { id: active.id, pattern: active.pattern, reset: active.reset,
                  seq_width: active.seq_width, item_id: null }
              : null
          }
          items={[]}
          today={today}
          onDone={() => setOpen(null)}
        />
      )}

      {open === 'item' && (
        <RuleForm
          target={code}
          targetLabel={label}
          existing={null}
          items={items.filter((i) => !perItem.some((r) => r.item_id === i.id))}
          today={today}
          onDone={() => setOpen(null)}
        />
      )}

      {history.length > 0 && (
        <details className="border-t border-line">
          <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-muted hover:bg-canvas">
            지난 규칙 {history.length}건
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">패턴</th>
                  <th className="th">주기</th>
                  <th className="th">자릿수</th>
                  <th className="th">품목</th>
                  <th className="th">시행일</th>
                  <th className="th">등록</th>
                  <th className="th">상태</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td className="td font-mono text-xs">{r.pattern}</td>
                    <td className="td text-xs">{cycleLabel(r.reset)}</td>
                    <td className="td tnum text-xs">{r.seq_width}</td>
                    <td className="td font-mono text-xs text-faint">
                      {r.item_code ?? (r.item_id ? shortId(r.item_id) : '공통')}
                    </td>
                    <td className="td tnum text-xs">{fmtDate(r.effective_from)}</td>
                    <td className="td text-xs text-muted">
                      {r.registered_by_name} · {fmtDateTime(r.registered_at)}
                    </td>
                    <td className="td">
                      <span
                        className={`chip ${
                          r.is_active ? 'bg-ok-bg text-ok' : 'bg-canvas text-faint'
                        }`}
                      >
                        {r.is_active ? '활성' : '내림'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  );
}
