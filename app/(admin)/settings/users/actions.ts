'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import { hashPin } from '@/lib/auth';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   사용자 · 역할 관리 (§4.1)

   개발 계정 QP 금지는 DB 트리거가 양방향으로 막는다. 여기서 다시 검사하지 않고
   예외 메시지를 그대로 올린다. 두 곳에서 판정하면 어긋난다.

   자기 자신을 잠그는 조작만 응용에서 막는다. GMP 판정이 아니라 운영 안전이다.
   마지막 시스템관리자가 스스로를 내리면 DB에 직접 붙지 않고는 복구할 수 없다.
--------------------------------------------------------------------------- */

async function admin() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) throw new Error('시스템관리자만 계정을 관리할 수 있습니다');
  return user;
}

export async function createUser(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const loginCode = String(form.get('login_code') ?? '').trim();
    const fullName = String(form.get('full_name') ?? '').trim();
    const canLogin = form.get('can_login') === 'on';
    const isDeveloper = form.get('is_developer') === 'on';
    const pin = String(form.get('pin') ?? '');

    if (canLogin && !pin) return { error: '로그인을 사용하는 계정은 비밀번호가 필요합니다' };

    const pinHash = canLogin ? await hashPin(pin) : null;

    /*
     * 만든 사람이 비밀번호를 아는 상태로 남겨 두지 않는다. 그 상태에서 적힌
     * 기록은 누가 적었는지 성립하지 않는다 - 전자서명이 없으므로 귀속은 오직
     * 로그인에 달려 있고, 로그인을 둘이 알면 귀속이 없다. 본인이 처음 들어올
     * 때 스스로 바꾸게 한다 (0052).
     */
    await withActor(me.id, (db) =>
      db.rows(
        `insert into app_user (login_code, full_name, pin_hash, can_login, is_developer,
                               must_change_pin)
         values ($1, $2, $3, $4, $5, $4)`,
        [loginCode, fullName, pinHash, canLogin, isDeveloper],
      ),
    );

    revalidatePath('/settings/users');
    revalidatePath('/');
    return {
      ok: true,
      message: canLogin
        ? `${fullName} 계정을 등록했습니다.`
        : `${fullName} 계정을 등록했습니다. 로그인은 사용하지 않으며 인쇄물에 이름만 나옵니다.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 비밀번호 초기화.
 *
 * 남의 비밀번호를 바꾸면 그 사람 이름으로 기록을 남길 수 있게 된다. 기록은
 * 지울 수 없어 사후 복구가 안 되므로 개발 계정만 할 수 있다. DB 트리거가
 * 같은 것을 막고 있고, 여기서는 화면에 단추를 내주기 전에 한 번 거른다.
 * 자기 비밀번호는 누구나 바꾼다.
 */
export async function setPin(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = String(form.get('id') ?? '');
    const pin = String(form.get('pin') ?? '');
    if (!pin) return { error: '새 비밀번호를 입력하십시오' };
    if (id !== me.id && !me.is_developer) {
      return { error: '다른 사람의 비밀번호는 개발 계정만 초기화할 수 있습니다' };
    }

    /*
     * 남의 것을 초기화하면 그 사람이 처음 들어올 때 스스로 다시 바꾸게 한다.
     * 초기화한 사람이 값을 알고 있는 동안은 그 계정의 기록이 누구 것인지
     * 성립하지 않는다. 자기 것을 바꾸는 경우는 아는 사람이 본인뿐이므로
     * 표시를 내린다.
     */
    const mine = id === me.id;
    const pinHash = await hashPin(pin);
    await withActor(me.id, (db) =>
      db.rows(`update app_user set pin_hash = $2, must_change_pin = $3 where id = $1`,
              [id, pinHash, !mine]),
    );
    revalidatePath('/settings/users');
    return {
      ok: true,
      message: mine
        ? '비밀번호를 변경했습니다.'
        : '비밀번호를 초기화했습니다. 본인이 처음 로그인할 때 새 비밀번호를 정하게 됩니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function setActive(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = String(form.get('id') ?? '');
    const next = form.get('next') === 'true';

    if (id === me.id && !next) {
      return { error: '자기 계정은 비활성화할 수 없습니다. 다른 관리자에게 요청하십시오' };
    }

    await withActor(me.id, (db) =>
      db.rows(`update app_user set is_active = $2 where id = $1`, [id, next]),
    );
    revalidatePath('/settings/users');
    revalidatePath('/');
    return { ok: true, message: next ? '계정을 활성화했습니다.' : '계정을 비활성화했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function setDeveloper(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = String(form.get('id') ?? '');
    const next = form.get('next') === 'true';

    // QP를 가진 계정을 개발 계정으로 돌리는 건 DB 트리거가 막는다. 그 메시지를
    // 그대로 보여주는 편이 화면에서 미리 거르는 것보다 정확하다.
    await withActor(me.id, (db) =>
      db.rows(`update app_user set is_developer = $2 where id = $1`, [id, next]),
    );
    revalidatePath('/settings/users');
    revalidatePath('/');
    return {
      ok: true,
      message: next ? '개발 계정으로 표시했습니다.' : '개발 계정 표시를 해제했습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function grantRole(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = String(form.get('id') ?? '');
    const role = String(form.get('role') ?? '');

    await withActor(me.id, (db) =>
      db.rows(
        `insert into user_role (user_id, role) values ($1, $2::role_code)
         on conflict do nothing`,
        [id, role],
      ),
    );
    revalidatePath('/settings/users');
    revalidatePath('/');
    return { ok: true, message: '역할을 부여했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function revokeRole(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = String(form.get('id') ?? '');
    const role = String(form.get('role') ?? '');

    if (id === me.id && role === 'SYS_ADMIN') {
      return { error: '자기 계정의 시스템관리자 역할은 회수할 수 없습니다' };
    }

    const remaining = await withActor(me.id, async (db) => {
      await db.rows(`delete from user_role where user_id = $1 and role = $2::role_code`, [id, role]);
      return db.val<number>(
        `select count(*)::int from user_role r
           join app_user u on u.id = r.user_id
          where r.role = 'SYS_ADMIN' and u.is_active and u.can_login`,
      );
    });

    revalidatePath('/settings/users');
    revalidatePath('/');
    return {
      ok: true,
      message:
        role === 'SYS_ADMIN' && remaining === 1
          ? '역할을 회수했습니다. 남은 시스템관리자가 1명입니다.'
          : '역할을 회수했습니다. 회수 이력은 감사추적에 남습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
