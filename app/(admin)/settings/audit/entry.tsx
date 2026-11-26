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
  /** 값 칸의 uuid 를 이름으로 (lib/audit-refs.ts). 못 푼 번호는 없다 */
  refs?: Record<string, string>;
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
function show(table: string, key: string, v: unknown, refs?: Record<string, string>): string {
  if (REDACTED.has(key)) return v == null ? '없음' : '●●●●●●';
  if (v === null || v === undefined) return '-';
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  /* 다른 표를 가리키는 번호는 그 대상의 이름으로 (사용자 2026-11-26) */
  if (typeof v === 'string' && refs?.[v]) return refs[v];
  /*
   * 2026-11-26 감사추적 전수 점검. 값이 꼴 그대로 뜨던 자리들.
   *   하루 안의 분(480)은 시각으로, 요일 번호({1,2,3})는 요일로, 기록 시각(ISO)은 한국 시각으로,
   *   목록은 한 줄로 잇고, 묶음 자료(양식 · 시간표 단계 · 요청 줄)는 몇 개인지만 말한다 -
   *   통째로 찍으면 [object Object] 나 한 화면을 덮는 글이 된다.
   */
  if (typeof v === 'number' && MINUTE_KEYS.has(key)) {
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '없음';
    if (key === 'workdays') return v.map((d) => WEEKDAY[Number(d)] ?? String(d)).join(' · ');
    if (v.every((x) => x === null || typeof x !== 'object')) {
      return v.map((x) => (typeof x === 'string' && refs?.[x]) || show(table, key, x)).join(' · ');
    }
    return `${v.length}개 항목`;
  }
  if (typeof v === 'object') return `${Object.keys(v as object).length}개 항목`;
  if (typeof v === 'string' && ISO_TIME.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return fmtDateTime(d);
  }
  return valueLabel(table, key, v) ?? String(v);
}

/* 하루 안의 분으로 적는 열 (근무 달력 · 배치 계획) */
const MINUTE_KEYS = new Set(['day_start', 'day_end', 'start_min']);
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/*
 * 펼침에 올리지 않는 열. 그 줄 자신의 식별자는 아래 꼬리(record_id)에 이미 있고,
 * one 은 «한 줄뿐» 을 지키는 표시다 (근무 달력). 읽는 사람에게 말하는 것이 없다.
 */
const HIDDEN = new Set(['id', 'one']);

/* 대상 칸은 번호(로트 · 배치)면 고정폭, 이름이면 본문 글꼴. 고정폭 글꼴에는 한글이 없다 */
const ascii = (s: string) => /^[ -~]+$/.test(s);

function diff(
  oldV: Record<string, unknown> | null,
  newV: Record<string, unknown> | null,
): { key: string; from: unknown; to: unknown }[] {
  const keys = new Set([...Object.keys(oldV ?? {}), ...Object.keys(newV ?? {})]);
  const out: { key: string; from: unknown; to: unknown }[] = [];
  for (const k of keys) {
    if (HIDDEN.has(k)) continue;
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
        <td className="td whitespace-nowrap">
          {e.label
            ? <span className={`text-ink ${ascii(e.label) ? 'font-mono' : ''}`}>{e.label}</span>
            : <span className="font-mono text-faint">{shortId(e.record_id)}</span>}
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
                  className="qd-text-action">
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
              <table className="qd-table qd-table--hangul max-w-3xl">
                <tbody>
                  {changes.map((c) => (
                    <tr key={c.key}>
                      <td className="py-1 pr-3 align-top font-semibold text-muted">
                        {fieldLabel(c.key)}
                      </td>
                      <td className="qd-col-grow py-1 pr-3 align-top text-danger line-through">
                        {e.action === 'INSERT' ? '' : show(e.table_name, c.key, c.from, e.refs)}
                      </td>
                      <td className="py-1 text-center align-top text-faint">→</td>
                      <td className="qd-col-grow py-1 align-top font-semibold text-ink">
                        {e.action === 'DELETE' ? '삭제됨' : show(e.table_name, c.key, c.to, e.refs)}
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
