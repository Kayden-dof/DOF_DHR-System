'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { isAdmin, isWorker } from '@/lib/roles';
import { LOCK_CHOICES, type LockPlace } from '@/lib/idle-lock';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   내 설정 저장 (0153 · 0157)

   관리 화면(/me)과 현장 화면(/work/me)이 같이 쓴다. 자기 계정만 바꾼다 - DB 트리거가
   본인인지 한 번 더 본다 (trg_idle_lock_off). 바꾼 사람 · 시각 · 앞뒤 값은 app_user
   감사 트리거가 남긴다.

   잠금은 두 레이아웃이 붙이므로 저장하면 레이아웃째 다시 그린다. 지금 화면부터 따른다.
--------------------------------------------------------------------------- */

/**
 * 자동 잠금 끄기 · 켜기 (0153).
 *
 * 끄는 것은 관리자로 앉은 세션에서만 - 작업자로 앉아 현장 패드를 쓰는 세션은 늘
 * 잠그므로(lib/session.ts idleLockOff) 거기서 끌 까닭이 없다.
 */
export async function setIdleLock(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await requireUser();
    const off = form.get('off') === '1';
    if (off && !isAdmin(me.seat)) {
      return { error: '자동 잠금은 시스템관리자 · 생산관리자만 끌 수 있습니다' };
    }

    await withActor(me.id, (db) =>
      db.rows(`update app_user set idle_lock_off = $2 where id = $1`, [me.id, off]));

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

/**
 * 잠금 시간 (0157). place 는 desk(관리 화면) · pad(현장 화면). 빈 값이면 기본값으로.
 *
 * 현장 화면 시간은 작업자 역할이 있는 계정만 고른다 - 그 화면을 쓰는 사람이다.
 */
export async function setLockMinutes(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await requireUser();
    const place = String(form.get('place') ?? '') as LockPlace;
    if (place !== 'desk' && place !== 'pad') return { error: '어느 화면의 잠금 시간인지 알 수 없습니다' };
    if (place === 'pad' && !isWorker(me.roles)) {
      return { error: '현장 화면 잠금 시간은 작업자 역할이 있는 계정만 고릅니다' };
    }

    const raw = String(form.get('minutes') ?? '').trim();
    const minutes = raw === '' ? null : Number(raw);
    if (minutes !== null && !LOCK_CHOICES[place].includes(minutes)) {
      return { error: '고를 수 있는 시간이 아닙니다' };
    }

    const col = place === 'desk' ? 'idle_lock_desk_min' : 'idle_lock_pad_min';
    await withActor(me.id, (db) =>
      db.rows(`update app_user set ${col} = $2 where id = $1`, [me.id, minutes]));

    revalidatePath('/', 'layout');
    return { ok: true, message: '잠금 시간을 바꿨습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
