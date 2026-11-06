'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   감사추적 비우기 (0122 · 사용자 지시 2026-11-06)

   판정은 DB 함수 purge_logs() 안에 있다. 여기서는 시스템관리자인지와 확인란만
   먼저 본다 - 단추를 잘못 누르는 일을 막는 것이지 권한 판정이 아니다.
--------------------------------------------------------------------------- */
const PURGE_WORD = '비우기';

export async function purgeLogs(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await requireUser();
    if (!hasRole(me, 'SYS_ADMIN')) {
      return { error: '감사추적 비우기는 시스템관리자만 할 수 있습니다' };
    }
    if (String(form.get('confirm') ?? '').trim() !== PURGE_WORD) {
      return { error: `확인란에 '${PURGE_WORD}' 를 적어 주십시오` };
    }

    const n = await withActor(me.id, (db) => db.val<string>(`select purge_logs()`));
    revalidatePath('/settings/audit');
    revalidatePath('/');
    return { ok: true, message: `감사추적 ${Number(n ?? 0)}건을 비웠습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
