'use server';

import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import { solutionSheet, type BrSheet } from '@/lib/br-sheet';

/* ---------------------------------------------------------------------------
   원액 로트의 PBS 제조기록서 (0145 · 사용자 2026-11-20 «원액 제조 때»)

   원액을 만드는 사람(생산관리자 · 시스템관리자 · makeSolutionLot 와 같다)이 적는다.
   칸은 solution_br_entry 에 적고, 누가 · 언제는 DB 가 정한다. 서명 칸을 고칠 때의 사유는
   현장 기록서와 같이 받아 감사추적에 남긴다.
--------------------------------------------------------------------------- */

async function writer() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    throw new Error('원액 제조기록서는 생산관리자 또는 시스템관리자가 적습니다');
  }
  return user;
}

export async function loadSolutionSheet(lotId: string, docId?: string | null): Promise<BrSheet | { error: string }> {
  try {
    const user = await requireUser();
    const sheet = await withActor(user.id, (db) => solutionSheet(db, lotId, docId));
    return sheet ?? { error: '이 원액 품목에 등록된 제조기록서 양식이 없습니다' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function saveSolutionEntry(
  lotId: string, docId: string, field: string, value: string, why?: string,
): Promise<BrSheet | { error: string }> {
  try {
    const me = await writer();
    if (!/^p\d+t\d+r\d+c\d+$/.test(field)) return { error: '칸 자리가 올바르지 않습니다' };
    const v = String(value ?? '').slice(0, 2000);
    const reason = String(why ?? '').trim().slice(0, 500);
    const sheet = await withActor(me.id, async (db) => {
      /* 그 원액 로트의 양식 칸에만 적는다. 서명 칸인지는 화면이 보낸 것을 믿지 않고 채워 가린다 */
      const before = await solutionSheet(db, lotId, docId);
      if (!before || before.docId !== docId) throw new Error('이 원액 로트의 제조기록서 양식이 아닙니다');
      let signKind: 'worker' | 'date' | null = null;
      for (const p of before.pages) for (const t of p.tables) for (const r of t.rows)
        for (const c of r.cells) if (c.id === field && c.sg && !c.ck) signKind = c.sg;
      if (signKind && reason) {
        await db.rows(`select set_config('app.change_reason', $1, true)`, [`서명 고침 · ${reason}`]);
      }
      await db.rows(
        `insert into solution_br_entry (material_lot_id, doc_id, field, value, entered_by, sign, why)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (material_lot_id, doc_id, field)
           do update set value = excluded.value, sign = excluded.sign, why = excluded.why`,
        [lotId, docId, field, v, me.id, signKind, signKind ? reason || null : null]);
      return solutionSheet(db, lotId, docId);
    }, { reason: v ? '원액 제조기록서 칸 적음' : '원액 제조기록서 칸 비움' });
    return sheet ?? { error: '제조기록서를 다시 읽지 못했습니다' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
