'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { isAdmin } from '@/lib/roles';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   자동 잠금 끄기 · 켜기 (0153 · 사용자 2026-11-20)

   자기 계정만 바꾼다. 끄는 것은 관리자로 앉은 세션에서만 - 작업자로 앉아 현장
   패드를 쓰는 세션은 늘 잠그므로(lib/session.ts idleLockOff) 거기서 끌 까닭이
   없다. DB 트리거가 본인 · 관리 역할을 한 번 더 본다 (trg_idle_lock_off).

   바꾼 사람 · 시각 · 앞뒤 값은 app_user 감사 트리거가 남긴다.
--------------------------------------------------------------------------- */
export async function setIdleLock(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await requireUser();
    const off = form.get('off') === '1';
    if (off && !isAdmin(me.seat)) {
      return { error: '자동 잠금은 시스템관리자 · 생산관리자만 끌 수 있습니다' };
    }

    await withActor(me.id, (db) =>
      db.rows(`update app_user set idle_lock_off = $2 where id = $1`, [me.id, off]));

    /* 잠금은 두 레이아웃이 붙인다. 지금 화면부터 바로 따르게 한다 */
    revalidatePath('/', 'layout');
    return {
      ok: true,
      message: off
        ? '자동 잠금을 껐습니다. 자리를 비워도 화면이 잠기지 않습니다.'
        : '자동 잠금을 켰습니다. 자리를 비우면 화면을 잠급니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
