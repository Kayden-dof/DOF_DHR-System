'use client';

import { useActionState, useState } from 'react';
import { Dialog, useDialog } from '@/components/dialog';
import { PIN_MIN_LENGTH } from '@/lib/auth-const';
import type { FormState } from '@/lib/forms';
import { createUser } from './actions';
import { Msg } from './user-row';

export default function NewUserForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createUser, {});
  const { open, setOpen } = useDialog(state);
  const [canLogin, setCanLogin] = useState(true);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary"> 새 계정 등록 </button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="새 계정 등록">
        <form action={action}>
      <h2 className="mb-3 text-sm font-bold text-ink">새 계정</h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="login_code">로그인 번호</label>
          <input
            id="login_code"
            name="login_code"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            autoComplete="off"
            placeholder="숫자"
            className="input tnum"
          />
        </div>
        <div>
          <label className="label" htmlFor="full_name">이름</label>
          <input id="full_name" name="full_name" required autoComplete="off" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="pin">비밀번호</label>
          <input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="new-password"
            disabled={!canLogin}
            placeholder={canLogin ? `숫자 ${PIN_MIN_LENGTH}자리 이상 권장` : '사용 안 함'}
            className="input"
          />
        </div>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="can_login"
              checked={canLogin}
              onChange={(e) => setCanLogin(e.target.checked)}
              className="size-4 accent-brand"
            />
            로그인 사용
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="is_developer" className="size-4 accent-brand" />
            개발 계정
          </label>
        </div>
      </div>

      {!canLogin && (
        <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">
          로그인을 사용하지 않는 계정입니다. 품질책임자가 여기 해당합니다 - 시스템을 쓰지 않고
          인쇄물에 이름만 나옵니다. 비밀번호는 저장하지 않습니다.
        </p>
      )}

      <Msg state={state} />

      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? '등록 중…' : '등록'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
          닫기
        </button>
      </div>
        </form>
      </Dialog>
    </>
  );
}
