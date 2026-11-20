'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrSheetView, type SheetCtx, type SheetLot } from '@/app/(work)/work/[id]/br-sheet';
import type { BrSheet } from '@/lib/br-sheet';
import { loadSolutionSheet, saveSolutionEntry } from '../actions';

/*
 * 현장 기록서 화면을 그대로 쓴다 - 칸을 누르면 아래에 적는 칸, 파란 글씨가 적은 값.
 * 저장 · 불러오기만 원액 로트로 간다 (SheetApi). 공정 기록이 아니므로 설비 · 투입은 없다.
 */
export default function SolutionSheetClient({ initial, lotId, lots, canWrite }: {
  initial: BrSheet; lotId: string; lots: SheetLot[]; canWrite: boolean;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState(initial);
  const ctx: SheetCtx = {
    woId: '', linked: [], allEquipment: [], bom: [], lots, issues: [],
    expiryWarnDays: 30, sheets: 0, loadUnit: null,
  };
  return (
    <BrSheetView
      sheet={sheet}
      onSheet={setSheet}
      onClose={() => router.push('/material/movement')}
      busy={false}
      ctx={ctx}
      readOnly={!canWrite}
      api={{
        save: (docId, field, value, why) => saveSolutionEntry(lotId, docId, field, value, why),
        load: (docId) => loadSolutionSheet(lotId, docId),
      }}
    />
  );
}
