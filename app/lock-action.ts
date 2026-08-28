'use server';

import { withActor } from '@/lib/db';
import { verifyPin } from '@/lib/auth';
import { requireUser } from '@/lib/session';

export interface LoginState { error?: string }

/* ---------------------------------------------------------------------------
   잠금 해제

   지금 세션의 본인 비밀번호만 받는다. 사번은 묻지 않는다 - 세션이 이미 누구인지
   알고 있고, 다른 사람이면 로그아웃하고 자기 계정으로 들어와야 한다.

   로그인과 같은 시도 제한을 건다. 잠금 화면이 통제를 우회하는 문이 되면 안 된다.
--------------------------------------------------------------------------- */
export async function unlock(pin: string): Promise<LoginState> {
  const me = await requireUser();
  if (!pin) return { error: '비밀번호를 입력하십시오' };

  const lock = await withActor(null, (db) =>
    db.val<number>(`select login_lock_seconds($1)`, [me.login_code]));
  if (lock && lock > 0) {
    return { error: `비밀번호를 여러 번 틀렸습니다. ${Math.ceil(lock / 60)}분 뒤에 다시 시도하십시오.` };
  }

  const row = await withActor(null, (db) =>
    db.one<{ pin_hash: string | null }>(
      `select pin_hash from app_user where id = $1 and is_active and can_login`, [me.id]));

  if (!row || !(await verifyPin(pin, row.pin_hash))) {
    await withActor(null, (db) => db.rows(`select login_fail($1)`, [me.login_code]));
    const after = await withActor(null, (db) =>
      db.val<number>(`select login_lock_seconds($1)`, [me.login_code]));
    if (after && after > 0) {
      return { error: `비밀번호를 여러 번 틀렸습니다. ${Math.ceil(after / 60)}분 뒤에 다시 시도하십시오.` };
    }
    return { error: '비밀번호가 올바르지 않습니다' };
  }

  await withActor(null, (db) => db.rows(`select login_ok($1)`, [me.login_code]));
  return {};
}
