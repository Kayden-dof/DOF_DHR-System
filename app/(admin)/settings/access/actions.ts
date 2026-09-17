'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, hasRole } from '@/lib/session';
import { withActor, dbMessage } from '@/lib/db';
import { ACCESS_ROWS } from '@/lib/access';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   계정별 화면 배정 (사용자 요청 2026-09-17 · 0116)

   ── 시스템관리자만 한다 ──────────────────────────────────────────────────
   화면 자체는 생산관리자도 열어 본다 (권한 매트릭스를 읽는 자리다). 그런데
   **배정하는 것**은 다른 일이다 - 그것을 생산관리자에게 열면 스스로 여는 길이
   생긴다. 5차 감사가 "생산관리자 하나가 화면만으로 완주했다" 를 짚은 것과
   같은 종류다.

   ── 스스로를 잠그지 못한다 ───────────────────────────────────────────────
   자기 배정은 DB 가 막는다 (set_user_screen · 0116). 여기서도 한 번 거르지만
   진짜 문은 거기다 - 응용에만 두면 검증이 아니다 (§1-2).
--------------------------------------------------------------------------- */

export async function setScreen(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await requireUser();
    if (!hasRole(me, 'SYS_ADMIN')) {
      return { error: '화면 배정은 시스템관리자만 할 수 있습니다' };
    }

    const userId = String(form.get('user_id') ?? '');
    const path = String(form.get('path') ?? '');
    const state = String(form.get('state') ?? '');

    if (!userId || !path) return { error: '대상이 없습니다' };

    /*
     * 아는 주소만 받는다. 주소를 손으로 지어 보내면 표에 없는 칸이 쌓이고,
     * 그것은 아무 화면도 가리키지 않으면서 배정표를 어지럽힌다.
     */
    if (!ACCESS_ROWS.some((r) => r.path === path)) {
      return { error: '알 수 없는 화면입니다' };
    }

    /* 열림 · 닫힘 · 역할 기본값(null). 셋 말고는 없다 */
    const open = state === 'open' ? true : state === 'closed' ? false : null;

    await withActor(me.id, (db) =>
      db.rows(`select set_user_screen($1::uuid, $2::text, $3::boolean, null)`,
              [userId, path, open]));

    revalidatePath('/settings/access');
    return {
      ok: true,
      message: open === null ? '역할 기본값으로 되돌렸습니다.'
        : open ? '이 화면을 열었습니다.' : '이 화면을 닫았습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
