'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireRole } from '@/lib/session';
import { brSheet, type BrSheet } from '@/lib/br-sheet';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   관리자 기록서 정정 (0155 · 사용자 2026-11-20 «관리자는 수정 기록할수있게 열어줘»)

   생산관리자 · 시스템관리자가 기록서 칸을 사유와 함께 고친다. 일차가 잠겼어도 그 칸 하나만 DB 가
   연다 (force_br_entry). 정정은 정정 내역 · 감사추적에 남고, 그 줄의 작업자 · 일자는 바꾸지 않는다.
--------------------------------------------------------------------------- */

const mgr = () => requireRole(['SYS_ADMIN', 'PROD_MGR'], '기록서 정정은 생산관리자 또는 시스템관리자가 합니다');

/** 정정 화면은 잠긴 일차여도 칸을 연다 - 막는 것은 DB 가 사유와 역할로 한다 */
const open = (s: BrSheet | null): BrSheet | { error: string } =>
  s ? { ...s, locked: false } : { error: '이 공정에 등록된 제조기록서 양식이 없습니다' };

export async function loadRecordSheet(recordId: string, docId?: string | null): Promise<BrSheet | { error: string }> {
  try {
    const me = await mgr();
    return open(await withActor(me.id, (db) => brSheet(db, recordId, docId)));
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function saveRecordEntry(
  recordId: string, docId: string, field: string, value: string, why?: string,
): Promise<BrSheet | { error: string }> {
  try {
    const me = await mgr();
    const reason = String(why ?? '').trim().slice(0, 500);
    if (!reason) return { error: '정정 사유를 먼저 고르십시오' };
    if (!/^p\d+t\d+r\d+c\d+$/.test(field)) return { error: '칸 자리가 올바르지 않습니다' };
    const v = String(value ?? '').slice(0, 2000);
    const sheet = await withActor(me.id, async (db) => {
      /* 그 기록서 양식의 칸인지 채워 보고, 정정 내역에 남길 칸 이름을 얻는다 */
      const before = await brSheet(db, recordId, docId);
      if (!before || before.docId !== docId) throw new Error('이 기록의 제조기록서 양식이 아닙니다');
      let label: string | null = null;
      for (const p of before.pages) for (const t of p.tables) for (const r of t.rows)
        for (const c of r.cells) if (c.id === field) label = c.lb ?? null;
      if (label === null) throw new Error('이 양식에 없는 칸입니다');
      await db.rows(`select force_br_entry($1, $2, $3, $4, $5, $6)`, [recordId, docId, field, v, reason, label]);
      const wo = await db.val<string>(`select work_order_id from process_record where id = $1`, [recordId]);
      if (wo) revalidatePath(`/production/${wo}`);
      return brSheet(db, recordId, docId);
    }, { reason: `기록서 정정 · ${reason}` });
    return open(sheet);
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   관리자 강제 투입 (0165 · 사용자 2026-11-25 «강제로 투입을 더하는 형태로»)

   종이를 옮겨 적을 때 기록서 칸에만 로트가 들어가고 투입이 없으면 재고가 줄지 않는다. 잠긴 일차여도
   투입 한 줄을 사유와 함께 더한다 (force_material_issue). 재고에서 빠지고 정정 내역에 남는다.
   인쇄 자료에는 들지 않는다. reason(감사추적 사유)은 DB 함수가 세운다.
--------------------------------------------------------------------------- */
export async function addForcedIssue(
  recordId: string, woId: string, _p: FormState, form: FormData,
): Promise<FormState> {
  try {
    const me = await requireRole(['SYS_ADMIN', 'PROD_MGR'], '생산관리자 또는 시스템관리자만 투입을 정정할 수 있습니다');
    const lot = String(form.get('material_lot_id') ?? '');
    const qty = Number(form.get('qty') ?? 0);
    const why = String(form.get('why') ?? '').trim().slice(0, 500);
    if (!lot) return { error: '자재 로트를 고르십시오' };
    if (!Number.isFinite(qty) || qty <= 0) return { error: '수량은 0 보다 커야 합니다' };
    if (!why) return { error: '왜 더하는지 적으십시오' };
    await withActor(me.id, (db) =>
      db.rows(`select force_material_issue($1,$2,$3,$4)`, [recordId, lot, qty, why]));
    revalidatePath(`/production/${woId}`);
    revalidatePath(`/production/${woId}/record/${recordId}`);
    return { ok: true, message: '투입을 더했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
