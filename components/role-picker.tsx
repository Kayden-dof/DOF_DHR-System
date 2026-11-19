'use client';

import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Dialog } from './dialog';
import { ROLE_LABEL, ROLE_NOTE, ROLE_ORDER, type RoleCode } from '@/lib/roles';
import { pickRole } from '@/app/login/actions';
import { logout } from '@/app/(admin)/actions';

/* ---------------------------------------------------------------------------
   역할 고르기 (사용자 요청 2026-11-20)

   역할이 둘 이상인 계정은 로그인 직후 어느 역할로 들어갈지 고른다. 들어간 뒤에는
   이름 옆 «역할 바꾸기» 가 같은 고르는 판을 띄운다.

   한 번 누르면 바로 간다. 고르고 «확인» 을 또 누르게 하지 않는다 - 현장 패드에서
   매일 아침 지나는 자리다. 판 하나가 그 역할의 이름과 하는 일을 함께 적는다.
--------------------------------------------------------------------------- */

function Choices({ roles, current }: { roles: RoleCode[]; current?: RoleCode }) {
  const list = ROLE_ORDER.filter((r) => roles.includes(r));
  return (
    <form action={pickRole} className="grid gap-2">
      {list.map((r) => <Choice key={r} role={r} current={r === current} />)}
    </form>
  );
}

function Choice({ role, current }: { role: RoleCode; current: boolean }) {
  const { pending, data } = useFormStatus();
  const going = pending && data?.get('role') === role;

  return (
    <button
      type="submit"
      name="role"
      value={role}
      disabled={pending || current}
      aria-current={current || undefined}
      className={`flex w-full items-center gap-4 rounded-lg border px-4 py-3.5 text-left
                  transition-colors duration-150 disabled:cursor-default ${
        current
          ? 'border-line bg-surface-sub'
          : 'border-line bg-surface hover:border-brand hover:bg-brand-soft'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-ink">{ROLE_LABEL[role]}</span>
        <span className="mt-0.5 block text-sm leading-snug text-muted">{ROLE_NOTE[role]}</span>
      </span>
      <span className={`shrink-0 text-sm font-semibold ${current ? 'text-faint' : 'text-brand'}`}>
        {current ? '지금 역할' : going ? '여는 중' : '들어가기'}
      </span>
    </button>
  );
}

/**
 * 로그인 직후의 고르는 창. 닫는 단추가 없다 - 고르지 않고는 어느 화면으로도
 * 들어가지 않는다 (lib/session.ts requireUser). 사번을 잘못 넣었으면 «다른 사번으로».
 */
export function RolePickerLogin({ name, roles }: { name: string; roles: RoleCode[] }) {
  return (
    <div className="qd-dialog-backdrop fixed inset-0 z-[60] overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="role-pick-title"
             data-role-picker="" className="qd-dialog-content w-full">
          <header className="qd-dialog-header">
            <div className="min-w-0">
              <h2 id="role-pick-title" className="qd-dialog-title">들어갈 역할을 고르십시오</h2>
              <p className="qd-dialog-description mt-1">
                <b className="text-ink">{name}</b> 님은 역할이 {roles.length}개입니다.
                고른 역할의 첫 화면과 차림표로 들어갑니다.
              </p>
            </div>
          </header>
          <div className="qd-dialog-body mt-4">
            <Choices roles={roles} />
          </div>
          <div className="qd-dialog-actions mt-4">
            <p className="mr-auto text-xs leading-relaxed text-faint">
              들어간 뒤에도 이름 옆 «역할 바꾸기» 로 바꿀 수 있습니다.
            </p>
            <form action={logout}>
              <button type="submit" className="qd-text-action">다른 사번으로</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 이름 옆 «역할 바꾸기». 역할이 둘 이상인 계정에만 그린다 (부르는 쪽이 가린다).
 *
 * 비밀번호를 다시 묻지 않는다. 고른 역할은 보이는 범위만 정하고, 같은 세션의
 * 같은 사람이다.
 */
export function RoleSwitch({
  roles, current, className, mini = false,
}: {
  roles: RoleCode[];
  /** 지금 고른 역할. 고르기 전에 연 세션이면 없다 */
  current?: RoleCode;
  className: string;
  /** 접힌 레일에서는 글귀 대신 표식 하나 */
  mini?: boolean;
}) {
  const [open, setOpen] = useState(false);

  /* 고른 역할이 바뀌어 화면이 다시 그려지면 닫는다. 같은 첫 화면이면 주소가 그대로라 이것으로 안다 */
  useEffect(() => { setOpen(false); }, [current]);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}
              aria-haspopup="dialog" aria-label="역할 바꾸기" title="역할 바꾸기">
        {mini
          ? <><span className="dof-rail-full">역할 바꾸기</span><span className="dof-rail-mini" aria-hidden>⇄</span></>
          : '역할 바꾸기'}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="역할 바꾸기"
              note="고른 역할의 첫 화면으로 갑니다.">
        <div data-role-picker="" className="mt-4">
          <Choices roles={roles} current={current} />
        </div>
      </Dialog>
    </>
  );
}
