'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrSheetView, type SheetCtx } from '@/app/(work)/work/[id]/br-sheet';
import type { BrSheet } from '@/lib/br-sheet';
import { loadRecordSheet, saveRecordEntry } from '../../../record-actions';

/* 정정 사유 - 고르거나 적는다. 칸을 고칠 때마다 이 사유가 정정 내역에 남는다 */
const WHY = ['종이 기록서에 맞춤', '입력 착오 정정', '날짜 · 시각 바로잡음'];

export default function RecordSheetClient({ initial, recordId, woId, title, locked }: {
  initial: BrSheet; recordId: string; woId: string; title: string; locked: boolean;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState(initial);
  const [why, setWhy] = useState('');
  const ctx: SheetCtx = {
    woId, linked: [], allEquipment: [], bom: [], lots: [], issues: [],
    expiryWarnDays: 30, sheets: 0, loadUnit: null,
  };
  return (
    <div className="space-y-3">
      <section className="card space-y-3 py-4">
        <div>
          <p className="text-sm text-muted">관리자 기록서 정정</p>
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
        </div>
        <p className="rounded-md border border-warn/40 bg-warn-bg px-3 py-2.5 text-sm leading-relaxed text-ink">
          {locked ? <>이 일차는 <b>마감(인쇄)되었습니다.</b> </> : null}
          칸을 누르고 고치면 그 칸 하나가 바뀝니다. 고친 칸은 아래 사유와 함께 정정 내역 · 감사추적에 남고,
          그 줄의 작업(검사)자 · 일자는 처음 적은 사람 · 날 그대로입니다.
          {locked ? ' 이미 나간 종이는 회수하고 다시 발행하십시오.' : ''}
        </p>
        <div>
          <span className="label">정정 사유</span>
          <div className="flex flex-wrap gap-2">
            {WHY.map((w) => (
              <button key={w} type="button" onClick={() => setWhy(w)} data-on={why === w} className="tile">
                <span className="text-sm font-semibold">{w}</span>
              </button>
            ))}
          </div>
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="사유를 고르거나 적으십시오"
                 className="input mt-2 w-full" />
        </div>
      </section>
      <BrSheetView
        sheet={sheet}
        onSheet={setSheet}
        onClose={() => router.push(`/production/${woId}`)}
        busy={false}
        ctx={ctx}
        api={{
          /* 서명 칸은 칸 편집기가 사유를 따로 받는다. 그 밖의 칸은 위 사유로 */
          save: (docId, field, value, cellWhy) => saveRecordEntry(recordId, docId, field, value, cellWhy || why),
          load: (docId) => loadRecordSheet(recordId, docId),
        }}
      />
    </div>
  );
}
