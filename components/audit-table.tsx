'use client';

import { useState } from 'react';
import Entry, { type AuditEntry } from '@/app/(admin)/settings/audit/entry';

/* ---------------------------------------------------------------------------
   감사추적 표 (사용자 요청 2026-09-01)

   현황 화면의 "최근 활동" 과 감사추적 화면이 같은 표를 쓴다. 전에는 현황이
   꼬리표 · 표 이름 · 시각만 한 줄로 냈다 - 무엇이 바뀌었는지는 감사추적으로
   건너가야 보였다.

   두 화면이 각자 그리지 않는다 (§10). 감사추적에 열이 하나 늘면 현황에도
   같이 늘어야 하고, 그렇지 않으면 같은 기록이 화면마다 다르게 보인다.

   ── 접는 것은 현황에서만 ──────────────────────────────────────────────────
   감사추적 화면은 그것을 보러 온 자리라 다 편다. 현황은 지나가며 보는
   자리이므로 열 줄만 두고, 더 볼 사람이 펴서 스무 줄까지 본다.
--------------------------------------------------------------------------- */

export default function AuditTable({ entries, collapseTo }: {
  entries: AuditEntry[];
  /** 이 수만큼만 먼저 보이고 나머지는 접는다. 없으면 다 편다 */
  collapseTo?: number;
}) {
  const [open, setOpen] = useState(false);
  const folded = collapseTo != null && entries.length > collapseTo && !open;
  const shown = folded ? entries.slice(0, collapseTo) : entries;

  if (entries.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-faint">기록이 없습니다.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">일시</th>
              <th className="th">표</th>
              <th className="th">작업</th>
              <th className="th">대상</th>
              <th className="th">수행자</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => <Entry key={e.id} e={e} />)}
          </tbody>
        </table>
      </div>

      {/*
        * 접었으면 몇 줄이 더 있는지 적는다. 수를 적지 않으면 눌러 봐야 얼마나
        * 나오는지 알 수 있고, 눌러서 두 줄이 나오면 누른 것이 아깝다.
        */}
      {collapseTo != null && entries.length > collapseTo && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full border-t border-line-soft px-4 py-2.5 text-xs font-bold
                     text-muted transition-colors hover:bg-surface-sub hover:text-ink"
        >
          {folded ? `${entries.length - collapseTo}건 더 보기` : '접기'}
        </button>
      )}
    </>
  );
}
