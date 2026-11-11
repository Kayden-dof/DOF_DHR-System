'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   작업요청 옮겨 적기 (F705-01 · 0136 · 사용자 2026-11-11)

   종이 작업요청 및 지시서에 요청자가 적은 것을 그대로 옮긴다. 작업 지시서 인쇄
   첫 장이 이 값으로 채워진다. 고칠 수 있고, 고친 사실은 감사추적에 이전 값과
   함께 남는다. 판정하지 않는다 - 요청 수량과 실제 생산을 견주지 않는다.
--------------------------------------------------------------------------- */
const PURPOSES = new Set(['SALES', 'PLAN', 'RND', 'OTHER']);
const txt = (v: FormDataEntryValue | null) => String(v ?? '').trim() || null;

export async function saveWorkRequest(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await requireUser();
    if (!hasRole(me, 'SYS_ADMIN', 'PROD_MGR')) {
      return { error: '생산관리자 또는 시스템관리자만 작업요청을 옮겨 적을 수 있습니다' };
    }
    const id = String(form.get('work_order_id') ?? '');
    const purpose = txt(form.get('purpose'));
    if (purpose && !PURPOSES.has(purpose)) return { error: '작업목적이 올바르지 않습니다' };

    /* 양식의 품목 다섯 줄. 다 빈 줄은 싣지 않는다 */
    const lines = [0, 1, 2, 3, 4].map((i) => ({
      product: txt(form.get(`product_${i}`)) ?? undefined,
      model: txt(form.get(`model_${i}`)) ?? undefined,
      qty: txt(form.get(`qty_${i}`)) ?? undefined,
      due: txt(form.get(`due_${i}`)) ?? undefined,
      note: txt(form.get(`note_${i}`)) ?? undefined,
    })).filter((l) => Object.values(l).some(Boolean));

    await withActor(me.id, (db) =>
      db.rows(
        `insert into work_request (work_order_id, request_dept, requester, purpose, purpose_note,
                                   urgent, lines, notes, complete_by, instruction, registered_by)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::date,$10, current_user_id())
         on conflict (work_order_id) do update set
           request_dept = excluded.request_dept, requester = excluded.requester,
           purpose = excluded.purpose, purpose_note = excluded.purpose_note,
           urgent = excluded.urgent, lines = excluded.lines, notes = excluded.notes,
           complete_by = excluded.complete_by, instruction = excluded.instruction`,
        [id, txt(form.get('request_dept')), txt(form.get('requester')), purpose,
         purpose === 'OTHER' ? txt(form.get('purpose_note')) : null,
         form.get('urgent') === '1', JSON.stringify(lines), txt(form.get('notes')),
         txt(form.get('complete_by')), txt(form.get('instruction'))]),
      { reason: '작업요청 옮겨 적기 (F705-01)' });

    revalidatePath(`/production/${id}`);
    return { ok: true, message: '작업요청을 옮겨 적었습니다. 작업 지시서 인쇄 첫 장에 나갑니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
