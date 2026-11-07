'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

/*
 * 개정 제안은 생산을 맡은 사람이 낸다 (시스템관리자 · 생산관리자).
 * 품질책임자는 읽기 전용 세션이라 DB 가 쓰기를 받지 않는다 - 제안을 받는 쪽이다.
 */
async function writer() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    throw new Error('시스템관리자 또는 생산관리자가 개정 제안을 낼 수 있습니다');
  }
  return user;
}

const txt = (v: FormDataEntryValue | null) => String(v ?? '').trim();

const TARGETS = new Set(['WS', 'BR', 'BOTH']);
const KINDS = new Set(['VALUE', 'FIELD', 'FLOW', 'CRITERIA', 'DOC', 'OTHER']);
const STATUSES = new Set(['OPEN', 'SENT', 'DONE', 'DROPPED']);

export async function requestRevision(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await writer();
    const product = txt(form.get('product_code'));
    const op = txt(form.get('op_code')) || null;
    const checkId = txt(form.get('check_id')) || null;
    const target = txt(form.get('target'));
    const docNos = txt(form.get('doc_nos'));
    const kind = txt(form.get('kind'));
    const current = txt(form.get('current_text'));
    const proposed = txt(form.get('proposed_text'));
    const reason = txt(form.get('reason'));

    if (!product) return { error: '제품을 고르십시오' };
    if (!TARGETS.has(target)) return { error: '고칠 문서를 고르십시오' };
    if (!KINDS.has(kind)) return { error: '제안 종류를 고르십시오' };
    if (!docNos) return { error: '대상 문서번호를 적으십시오' };
    if (!proposed) return { error: '어떻게 바꾸자는지 적으십시오' };
    if (!reason) return { error: '왜 바꾸자는지 적으십시오' };

    const no = await withActor(me.id, async (db) => {
      const n = await db.val<string>(`select next_revision_request_no($1)`, [product]);
      await db.rows(
        `insert into mfg_revision_request
           (req_no, product_code, op_code, check_id, target, doc_nos, kind,
            current_text, proposed_text, reason, requested_by)
         values ($1,$2,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11)`,
        [n, product, op, checkId, target, docNos, kind, current, proposed, reason, me.id]);
      return n;
    });

    revalidatePath('/settings/docs');
    return { ok: true, message: `${no} 개정 제안을 적었습니다. 제안서 인쇄에 함께 나옵니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function setRequestStatus(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await writer();
    const id = txt(form.get('id'));
    const status = txt(form.get('status'));
    const note = txt(form.get('status_note'));
    if (!STATUSES.has(status)) return { error: '상태를 고르십시오' };
    if ((status === 'DONE' || status === 'DROPPED') && !note) {
      return { error: '반영 결과를 적으십시오 (개정 번호나 반영하지 않는 까닭)' };
    }
    await withActor(me.id, (db) =>
      db.rows(
        `update mfg_revision_request
            set status = $2, status_note = $3, status_at = now()
          where id = $1`, [id, status, note]));
    revalidatePath('/settings/docs');
    return { ok: true, message: '상태를 바꿨습니다. 이전 상태는 감사추적에 남습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
