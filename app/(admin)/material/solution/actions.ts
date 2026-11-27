'use server';

import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import { solutionSheet, type BrSheet } from '@/lib/br-sheet';

/* ---------------------------------------------------------------------------
   원액 로트의 PBS 제조기록서 (0145 · 사용자 2026-11-20 «원액 제조 때»)

   원액을 만드는 사람(작업자 · 생산관리자 · 시스템관리자 · makeSolutionLot 와 같다)이 적는다.
   현장 작업자도 알칼리 처리 준비에서 20X PBS 를 만들고 이 기록서를 적는다 (사용자 2026-11-25).
   칸은 solution_br_entry 에 적고, 누가 · 언제는 DB 가 정한다. 서명 칸을 고칠 때의 사유는
   현장 기록서와 같이 받아 감사추적에 남긴다.
--------------------------------------------------------------------------- */

async function writer() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR', 'WORKER')) {
    throw new Error('원액 제조기록서는 작업자 · 생산관리자 · 시스템관리자가 적습니다');
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
      /*
       * 이 원액을 쓴 배치 일차가 이미 잠겼으면(인쇄 · 마감) 사유를 받는다 (정밀 점검 C · 사용자
       * 2026-11-27 «알리고 사유 받기»). 별첨은 원액 칸을 그대로 그리므로, 고치면 다시 뽑는 종이가
       * 처음 종이와 달라진다. 막지 않고 사유를 감사추적과 그 칸에 남긴다.
       */
      const printed = before.printed ?? [];
      if (printed.length > 0 && !reason) {
        throw new Error(`이 원액을 쓴 ${printed.join(' · ')}는 이미 인쇄 · 마감됐습니다. 고치는 사유를 적으십시오`);
      }
      const why = signKind ? `서명 고침 · ${reason}` : printed.length > 0 ? `인쇄 뒤 고침 · ${reason}` : '';
      if (reason && why) {
        await db.rows(`select set_config('app.change_reason', $1, true)`, [why]);
      }
      await db.rows(
        `insert into solution_br_entry (material_lot_id, doc_id, field, value, entered_by, sign, why)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (material_lot_id, doc_id, field)
           do update set value = excluded.value, sign = excluded.sign, why = excluded.why`,
        [lotId, docId, field, v, me.id, signKind, (signKind || printed.length > 0) ? reason || null : null]);
      return solutionSheet(db, lotId, docId);
    }, { reason: v ? '원액 제조기록서 칸 적음' : '원액 제조기록서 칸 비움' });
    return sheet ?? { error: '제조기록서를 다시 읽지 못했습니다' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
