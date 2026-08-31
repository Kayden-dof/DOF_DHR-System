'use server';

import { redirect } from 'next/navigation';
import { withActor, dbMessage } from '@/lib/db';
import { requireUserForPasswordChange } from '@/lib/session';
import { hashPin, verifyPin } from '@/lib/auth';
import { PIN_MIN_LENGTH } from '@/lib/auth-const';
import { homePath } from '@/lib/roles';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   내 비밀번호 바꾸기

   전에는 사무 화면의 계정 관리 안에만 있었다. 그러면 작업자는 자기 비밀번호를
   바꿀 길이 없다 - 그 화면에 들어가지 못하기 때문이다. 남이 정해 준 값을
   계속 쓰게 되고, 그 값을 아는 사람이 둘이면 그 계정으로 적힌 기록이 누구
   것인지 성립하지 않는다.

   전자서명이 없는 시스템이라 기록의 귀속은 오직 로그인에 달려 있다. 그러니
   비밀번호를 본인만 아는 상태로 만드는 일이 이 시스템에서는 서명란을 지키는
   일과 같다.

   화면은 로그인한 사람이면 누구나 들어온다. 역할을 보지 않는다.
--------------------------------------------------------------------------- */

/**
 * 너무 쉬운 숫자를 거른다.
 *
 * 자릿수만 세면 000000 과 123456 이 통과한다. 그 두 가지가 실제로 가장 먼저
 * 시도되는 값이다. 판정이 아니라 형식 검사이므로 응용에서 한다.
 */
function tooWeak(pin: string): string | null {
  if (pin.length < PIN_MIN_LENGTH) {
    return `비밀번호는 ${PIN_MIN_LENGTH}자리 이상이어야 합니다`;
  }
  if (!/^\d+$/.test(pin)) return '비밀번호는 숫자만 사용합니다';
  if (/^(\d)\1*$/.test(pin)) return '같은 숫자만으로는 정할 수 없습니다';

  const asc = '01234567890123456789';
  const desc = '09876543210987654321';
  if (asc.includes(pin) || desc.includes(pin)) {
    return '이어지는 숫자로는 정할 수 없습니다';
  }
  return null;
}

export async function changeMyPin(_prev: FormState, form: FormData): Promise<FormState> {
  let go = '';
  try {
    const me = await requireUserForPasswordChange();
    const current = String(form.get('current') ?? '');
    const next = String(form.get('next') ?? '');
    const again = String(form.get('again') ?? '');

    const weak = tooWeak(next);
    if (weak) return { error: weak };
    if (next !== again) return { error: '새 비밀번호가 서로 다릅니다' };
    if (next === current) return { error: '전과 다른 비밀번호를 정하십시오' };

    /*
     * 지금 비밀번호를 다시 묻는다. 자리를 비운 사이 남이 화면을 잡으면
     * 비밀번호를 바꿔 계정을 가져갈 수 있다. 세션이 여덟 시간이라 그 틈이
     * 짧지 않다.
     */
    const row = await withActor(me.id, (db) =>
      db.one<{ pin_hash: string | null }>(
        `select pin_hash from app_user where id = $1`, [me.id]));
    if (!row || !(await verifyPin(current, row.pin_hash))) {
      return { error: '지금 비밀번호가 올바르지 않습니다' };
    }

    const hash = await hashPin(next);
    await withActor(me.id, (db) =>
      db.rows(`update app_user set pin_hash = $2, must_change_pin = false where id = $1`,
              [me.id, hash]));

    go = homePath(me.roles);
  } catch (e) {
    return { error: dbMessage(e) };
  }

  /* redirect 는 예외를 던진다. try 안에 두지 않는다 */
  redirect(go);
}
