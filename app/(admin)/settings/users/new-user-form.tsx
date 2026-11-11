'use client';

import { useActionState, useState, useEffect } from 'react';
import { Dialog, useDialog } from '@/components/dialog';
import { PIN_MIN_LENGTH } from '@/lib/auth-const';
import type { FormState } from '@/lib/forms';
import { createUser } from './actions';
import { Msg } from '@/components/ui';
import { ROLE_LABEL, ROLE_NOTE, ROLE_ORDER, type RoleCode } from '@/lib/roles';

export default function NewUserForm({ sysAdmin }: { sysAdmin: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createUser, {});
  const { open, setOpen } = useDialog(state);
  const [canLogin, setCanLogin] = useState(true);
  /* 처음 줄 역할 (UI/UX 검수 2026-11-11). 비우면 지금처럼 역할 없이 만든다 */
  const [role, setRole] = useState<RoleCode | ''>('');
  /* 시스템관리자 역할은 시스템관리자만 준다. 고를 수 없으면 목록에 내지 않는다 (user-row 와 같다) */
  const roles = ROLE_ORDER.filter((r) => sysAdmin || r !== 'SYS_ADMIN');
  /* 만든 뒤에는 비운다. 다음 계정에 앞 사람의 역할이 남아 골라져 있으면 안 된다 */
  useEffect(() => { if (state.ok) setRole(''); }, [state]);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary"> 새 계정 등록 </button>
      <Dialog open={open} onClose={() => setOpen(false)} wide title="새 계정 등록">
        <form action={action}>
      <h2 className="mb-3 text-sm font-semibold text-ink">새 계정</h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="login_code">사번</label>
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
          {/*
            * 개발 계정 표시는 시스템관리자만 켠다 (4차 감사 D1). 서버가 이미
            * 막지만, 못 누르는 자리를 내놓고 눌렀을 때 막는 것보다 아예
            * 보이지 않는 편이 낫다.
            */}
          {sysAdmin && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="is_developer" className="size-4 accent-brand" />
              개발 계정
            </label>
          )}
        </div>
      </div>

      {/*
        * 역할을 만들 때 함께 준다 (UI/UX 검수 2026-11-11 «새 계정에 역할 못 넣음»). 빈
        * 선택지가 기본이다 - 첫 역할이 조용히 골라지면 고르지 않은 권한이 붙는다.
        * 고른 역할이 무엇을 하는지 칸 바로 아래에 글로 적는다 (title 에 숨기지 않는다).
        * 둘째 역할부터는 만든 뒤 줄을 열어 더한다.
        */}
      <div className="mt-3">
        <label className="label" htmlFor="new-user-role">역할</label>
        <select id="new-user-role" name="role" value={role}
                onChange={(e) => setRole(e.target.value as RoleCode | '')} className="input">
          <option value="">정하지 않음 (나중에 부여)</option>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <p className="mt-1 text-xs leading-relaxed text-faint">
          {role
            ? ROLE_NOTE[role]
            : '역할이 없는 계정은 로그인해도 열 화면이 없습니다. 둘째 역할부터는 만든 뒤 계정 줄에서 더합니다.'}
        </p>
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
