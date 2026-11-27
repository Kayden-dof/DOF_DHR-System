'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrSheetView, type SheetCtx, type SheetLot } from '@/app/(work)/work/[id]/br-sheet';
import type { BrSheet } from '@/lib/br-sheet';
import { loadSolutionSheet, saveSolutionEntry } from '../actions';

/* 자주 쓰는 사유는 눌러서 고른다 (현장에는 키보드가 없다 · 서명 고침과 같은 꼴) */
const AFTER_PRINT_WHY = ['종이 기록서에 맞춤', '입력 착오 정정'];

/*
 * 현장 기록서 화면을 그대로 쓴다 - 칸을 누르면 아래에 적는 칸, 파란 글씨가 적은 값.
 * 저장 · 불러오기만 원액 로트로 간다 (SheetApi). 공정 기록이 아니므로 설비 · 투입은 없다.
 *
 * 이 원액을 쓴 배치 일차가 이미 인쇄 · 마감됐으면 위에 알리고 고치는 사유를 받는다 (정밀 점검 C ·
 * 사용자 2026-11-27 «알리고 사유 받기»). 사유는 한 번 적으면 이어서 고치는 칸에도 함께 간다.
 * 서명 칸 편집기가 따로 사유를 받으면 그것이 먼저다.
 */
export default function SolutionSheetClient({ initial, lotId, lots, canWrite, back = '/material/movement' }: {
  initial: BrSheet; lotId: string; lots: SheetLot[]; canWrite: boolean;
  /** 닫으면 돌아갈 곳. 현장에서 열었으면 그 배치 화면 */
  back?: string;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState(initial);
  const [why, setWhy] = useState('');
  const ctx: SheetCtx = {
    woId: '', linked: [], allEquipment: [], bom: [], lots, issues: [],
    expiryWarnDays: 30, sheets: 0, loadUnit: null,
  };
  const printed = sheet.printed ?? [];
  const notice = canWrite && printed.length > 0 ? (
    <div className="qd-notice block" data-tone="warning" role="note">
      <p className="text-sm font-semibold text-ink">
        이 원액을 쓴 {printed.join(' · ')}는 이미 인쇄 · 마감됐습니다.
      </p>
      <p className="mt-1 text-sm text-body">
        여기서 고치면 다시 뽑는 종이가 처음 종이와 달라집니다. 고치는 사유를 적은 뒤 칸을 고치십시오.
        사유는 감사추적에 남습니다.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {AFTER_PRINT_WHY.map((w) => (
          <button key={w} type="button" onClick={() => setWhy(w)} data-on={why === w} className="tile">{w}</button>
        ))}
        <input value={why} onChange={(ev) => setWhy(ev.target.value)} placeholder="고치는 사유"
               aria-label="고치는 사유" className="input min-w-56 flex-1" />
      </div>
    </div>
  ) : null;
  return (
    <BrSheetView
      sheet={sheet}
      onSheet={setSheet}
      onClose={() => router.push(back)}
      busy={false}
      ctx={ctx}
      readOnly={!canWrite}
      notice={notice}
      api={{
        save: (docId, field, value, w) => saveSolutionEntry(lotId, docId, field, value, w || why.trim()),
        load: (docId) => loadSolutionSheet(lotId, docId),
      }}
    />
  );
}
