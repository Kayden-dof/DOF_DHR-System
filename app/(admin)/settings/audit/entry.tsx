'use client';

import { useState } from 'react';
import { tableLabel, fieldLabel, valueLabel } from '@/lib/forms';
import { fmtDateTime, shortId } from '@/lib/fmt';
import ActionChip from '@/components/action-chip';

export interface AuditEntry {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  acted_at: Date;
  actor_name: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  /** 남겨 둔 값에서 꺼낸 사람이 아는 번호. 없으면 null */
  label: string | null;
  /** 왜 바꿨는가 (0061). 변경에만 있고 비어 있을 수 있다 */
  reason: string | null;
}

/* 해시·비밀 값은 화면에 올리지 않는다. 감사추적은 "무엇이 바뀌었는가"를 보여주는
   것이지 저장된 비밀을 열람하는 창구가 아니다. */
const REDACTED = new Set(['pin_hash']);


/**
 * 값 하나를 사람 말로.
 *
 * 열 이름만 옮기고 값을 그대로 두면 `ISSUED` `SHEET_TIER` 가 뜬다. 읽는 사람은
 * 여전히 코드를 알아야 한다 (사용자 요청 2026-09-01).
 *
 * 옮길 말이 없으면 값을 그대로 낸다 - 지어내지 않는다. 로트번호 · 성적서 번호
 * 처럼 옮길 것이 아닌 값이 대부분이다.
 */
function show(table: string, key: string, v: unknown): string {
  if (REDACTED.has(key)) return v == null ? '없음' : '●●●●●●';
  if (v === null || v === undefined) return '-';
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  return valueLabel(table, key, v) ?? String(v);
}

function diff(
  oldV: Record<string, unknown> | null,
  newV: Record<string, unknown> | null,
): { key: string; from: unknown; to: unknown }[] {
  const keys = new Set([...Object.keys(oldV ?? {}), ...Object.keys(newV ?? {})]);
  const out: { key: string; from: unknown; to: unknown }[] = [];
  for (const k of keys) {
    const a = oldV?.[k];
    const b = newV?.[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ key: k, from: a, to: b });
  }
  return out;
}

export default function Entry({ e }: { e: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const changes = diff(e.old_value, e.new_value);

  return (
    <>
      <tr>
        <td className="td tnum text-muted whitespace-nowrap">{fmtDateTime(e.acted_at)}</td>
        <td className="td">
          <span className="text-sm text-ink">{tableLabel(e.table_name)}</span>
        </td>
        <td className="td"><ActionChip action={e.action} /></td>
        <td className="td whitespace-nowrap font-mono text-xs">
          {e.label
            ? <span className="text-ink">{e.label}</span>
            : <span className="text-faint">{shortId(e.record_id)}</span>}
        </td>
        <td className="td">
          {e.actor_name ?? <span className="text-faint">-</span>}
          {/* 왜 바꿨는가. 있는 줄에만 나온다 - 없는 것이 정상인 줄이 대부분이다 */}
          {e.reason && (
            <div className="mt-0.5 text-xs leading-snug text-muted">{e.reason}</div>
          )}
        </td>
        <td className="td text-right">
          {/*
            * 스무 줄에 같은 단추가 스무 개 서 있었다. 평소에는 눌러 놓고 줄에
            * 손이 갔을 때만 또렷해지게 둔다.
            */}
          <button onClick={() => setOpen((v) => !v)}
                  className="btn-quiet h-7 px-2 text-xs">
            {open ? '접기' : <>변경 <span className="tnum">{changes.length}</span></>}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="border-b border-line bg-canvas px-4 py-3">
            {changes.length === 0 ? (
              <p className="text-xs text-faint">값 변화가 없습니다.</p>
            ) : (
              <table className="w-full max-w-3xl">
                <tbody>
                  {changes.map((c) => (
                    <tr key={c.key}>
                      <td className="w-40 py-1 pr-3 align-top text-xs font-semibold text-muted">
                        {fieldLabel(c.key)}
                      </td>
                      <td className="py-1 pr-3 align-top text-xs text-danger line-through">
                        {e.action === 'INSERT' ? '' : show(e.table_name, c.key, c.from)}
                      </td>
                      <td className="w-6 py-1 text-center align-top text-xs text-faint">→</td>
                      <td className="py-1 align-top text-xs font-semibold text-ink">
                        {e.action === 'DELETE' ? '삭제됨' : show(e.table_name, c.key, c.to)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 font-mono text-xs text-faint">
              audit_log #{e.id} · record_id {e.record_id}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
