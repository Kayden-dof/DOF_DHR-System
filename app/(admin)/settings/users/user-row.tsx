'use client';

import { useActionState, useState } from 'react';
import { Dialog } from '@/components/dialog';
import { ROLE_LABEL, ROLE_NOTE, ROLE_ORDER, type RoleCode } from '@/lib/roles';
import { PIN_MIN_LENGTH } from '@/lib/auth-const';
import type { FormState } from '@/lib/forms';
import { grantRole, revokeRole, setActive, setDeveloper, setPin, setFullName } from './actions';

export interface UserRow {
  id: string;
  login_code: string;
  full_name: string;
  is_active: boolean;
  is_developer: boolean;
  can_login: boolean;
  has_pin: boolean;
  roles: RoleCode[];
}

export default function UserRowView(
  { u, meId, meIsDeveloper, meIsSysAdmin, writable = true }: {
    u: UserRow; meId: string; meIsDeveloper: boolean;
    /**
     * 시스템관리자인가. 시스템관리자 역할을 주고받는 것과 개발 계정 표시는
     * 시스템관리자만 한다 (actions.ts). 화면도 같은 경계를 그린다 - 눌러서
     * 거절당하는 자리를 만들지 않는다.
     */
    meIsSysAdmin: boolean;
    /** 이 세션이 쓸 수 있는가. 못 쓰면 관리 단추와 그 안의 조작을 그리지 않는다 */
    writable?: boolean;
  },
) {
  const [open, setOpen] = useState(false);
  const isMe = u.id === meId;

  return (
    <>
      <tr className={u.is_active ? '' : 'bg-canvas/60'}>
        <td className="td tnum font-semibold">{u.login_code}</td>
        <td className="td">
          {u.full_name}
          {isMe && <span className="chip ml-1.5 bg-brand-soft text-brand">나</span>}
          {u.is_developer && <span className="chip ml-1.5 bg-warn-bg text-warn">개발</span>}
        </td>
        <td className="td">
          <div className="flex flex-wrap gap-1">
            {u.roles.length === 0 && <span className="text-xs text-faint">없음</span>}
            {u.roles.map((r) => (
              <span key={r} className="chip bg-brand-soft text-brand">
                {ROLE_LABEL[r]}
              </span>
            ))}
          </div>
        </td>
        <td className="td">
          <div className="flex flex-wrap gap-1">
            <span className={`chip ${u.is_active ? 'bg-ok-bg text-ok' : 'bg-canvas text-faint'}`}>
              {u.is_active ? '활성' : '비활성'}
            </span>
            {!u.can_login && <span className="chip bg-canvas text-muted">로그인 불가</span>}
            {u.can_login && !u.has_pin && (
              <span className="chip bg-danger-bg text-danger">비밀번호 없음</span>
            )}
          </div>
        </td>
        {writable && (
          <td className="td text-right">
            <button onClick={() => setOpen(true)} className="btn-ghost h-8 px-3 text-xs">
              관리
            </button>
          </td>
        )}
      </tr>

      {/*
        * 팝업으로 띄운다. 표 안에서 줄을 벌리면 세 칸이 한꺼번에 펼쳐져 뒤의
        * 계정들이 통째로 밀려 내려간다. 사람이 늘수록 심해진다.
        *
        * 여기는 스스로 닫지 않는다. 역할 부여 · 비밀번호 초기화 · 활성 전환이
        * 한 칸에 모여 있어 하나를 마치고 다른 하나를 이어서 하는 일이 흔하다.
        * 매번 닫히면 같은 사람을 다시 찾아 들어와야 한다.
        */}
      <Dialog open={open} onClose={() => setOpen(false)} wide
              title={`${u.full_name} 계정 관리`}
              note={<><span className="tnum">{u.login_code}</span>
                {u.is_developer && <span className="ml-1.5 font-bold text-warn">개발 계정</span>}</>}>
        <NamePanel u={u} />
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <RolePanel u={u} isMe={isMe} sysAdmin={meIsSysAdmin} />
          <PinPanel u={u} isMe={isMe} canReset={meIsDeveloper} />
          <FlagPanel u={u} isMe={isMe} sysAdmin={meIsSysAdmin} />
        </div>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/*
 * 이름 정정 (5차 감사 A2). 이 이름이 제조기록서의 작업자 칸에 인쇄되므로
 * 오타를 그대로 두면 종이에 계속 나간다. 이미 나간 종이는 바뀌지 않는다는
 * 것을 화면이 먼저 말한다.
 */
function NamePanel({ u }: { u: UserRow }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setFullName, {});

  return (
    <Panel title="이름">
      <form action={action} className="space-y-2.5">
        <input type="hidden" name="id" value={u.id} />
        <div className="grid gap-2.5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor={`name-${u.id}`}>이름</label>
            <input id={`name-${u.id}`} name="full_name" required autoComplete="off"
                   defaultValue={u.full_name} maxLength={40} className="input" />
          </div>
          <div>
            <label className="label" htmlFor={`nreason-${u.id}`}>고치는 사유</label>
            <input id={`nreason-${u.id}`} name="reason" required autoComplete="off"
                   placeholder="예: 등록 시 오타" className="input" />
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          이 이름이 제조기록서의 작업자 칸에 인쇄됩니다.
          <b className="text-ink"> 이미 나간 종이는 바뀌지 않습니다.</b>
          {' '}바꾼 사실과 이전 이름은 감사추적에 남습니다.
        </p>
        <Msg state={state} />
        <button type="submit" disabled={pending} className="btn-ghost h-9">
          {pending ? '고치는 중' : '이름 고치기'}
        </button>
      </form>
    </Panel>
  );
}

function RolePanel({ u, isMe, sysAdmin }: {
  u: UserRow; isMe: boolean; sysAdmin: boolean;
}) {
  const [grantState, grantAction, granting] = useActionState<FormState, FormData>(grantRole, {});
  const [revokeState, revokeAction, revoking] = useActionState<FormState, FormData>(revokeRole, {});
  /* 시스템관리자 역할은 시스템관리자만 준다. 고를 수 없으면 목록에 내지 않는다 */
  const missing = ROLE_ORDER.filter(
    (r) => !u.roles.includes(r) && (sysAdmin || r !== 'SYS_ADMIN'));

  return (
    <Panel title="역할">
      {u.roles.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {u.roles.map((r) => (
            <form key={r} action={revokeAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="role" value={r} />
              <span className="flex-1 text-sm text-ink">{ROLE_LABEL[r]}</span>
              <button
                type="submit"
                disabled={revoking || (r === 'SYS_ADMIN' && (isMe || !sysAdmin))}
                className="btn-ghost h-7 px-2 text-xs text-muted"
                title={r !== 'SYS_ADMIN' ? ''
                  : !sysAdmin ? '시스템관리자 역할은 시스템관리자만 회수할 수 있습니다'
                  : isMe ? '자기 계정의 시스템관리자는 회수할 수 없습니다' : ''}
              >
                회수
              </button>
            </form>
          ))}
        </div>
      )}

      {missing.length > 0 && (
        <form action={grantAction} className="flex gap-2">
          <input type="hidden" name="id" value={u.id} />
          <select name="role" className="input h-9 flex-1 text-xs" defaultValue={missing[0]}>
            {missing.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]} - {ROLE_NOTE[r]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={granting} className="btn-ghost h-9 px-3 text-xs">
            부여
          </button>
        </form>
      )}

      <Msg state={grantState} />
      <Msg state={revokeState} />
      {u.is_developer && (
        <p className="mt-2 text-xs leading-relaxed text-warn">
          개발 계정에는 품질책임자 역할을 부여할 수 없습니다.
        </p>
      )}
    </Panel>
  );
}

/**
 * 비밀번호 초기화.
 *
 * 남의 비밀번호를 바꾸면 그 사람 이름으로 기록을 남길 수 있게 된다. 기록은
 * 지울 수 없어 사후 복구가 안 되므로 개발 계정만 할 수 있다. DB 트리거가 같은
 * 것을 막고 있고, 여기서는 아예 단추를 내주지 않는다. 자기 비밀번호는 누구나
 * 바꾼다.
 */
function PinPanel({ u, isMe, canReset }: { u: UserRow; isMe: boolean; canReset: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setPin, {});

  if (!u.can_login) {
    return (
      <Panel title="비밀번호">
        <p className="text-xs leading-relaxed text-muted">
          로그인을 사용하지 않는 계정입니다. 품질책임자처럼 인쇄물에 이름만 나오는 계정이
          여기 해당합니다.
        </p>
      </Panel>
    );
  }

  if (!isMe && !canReset) {
    return (
      <Panel title="비밀번호 초기화">
        <p className="text-xs leading-relaxed text-muted">
          다른 사람의 비밀번호는 <b className="text-ink">개발 계정</b>만 초기화할 수 있습니다.
          초기화한 뒤에는 본인이 바로 바꾸게 하십시오.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={isMe ? '내 비밀번호 변경' : '비밀번호 초기화'}>
      <form action={action} className="flex gap-2">
        <input type="hidden" name="id" value={u.id} />
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="new-password"
          placeholder={`숫자 ${PIN_MIN_LENGTH}자리 이상 권장`}
          className="input h-9 flex-1 text-xs"
        />
        <button type="submit" disabled={pending} className="btn-ghost h-9 px-3 text-xs">
          변경
        </button>
      </form>
      <Msg state={state} />
    </Panel>
  );
}

function FlagPanel({ u, isMe, sysAdmin }: { u: UserRow; isMe: boolean; sysAdmin: boolean }) {
  const [activeState, activeAction, a1] = useActionState<FormState, FormData>(setActive, {});
  const [devState, devAction, a2] = useActionState<FormState, FormData>(setDeveloper, {});

  return (
    <Panel title="계정 상태">
      <div className="space-y-2">
        <form action={activeAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={u.id} />
          <input type="hidden" name="next" value={String(!u.is_active)} />
          <span className="flex-1 text-sm text-ink">
            {u.is_active ? '활성 상태' : '비활성 상태'}
          </span>
          <button
            type="submit"
            disabled={a1 || (isMe && u.is_active)}
            className="btn-ghost h-7 px-2 text-xs"
            title={isMe && u.is_active ? '자기 계정은 비활성화할 수 없습니다' : ''}
          >
            {u.is_active ? '비활성화' : '활성화'}
          </button>
        </form>

        {sysAdmin && (
        <form action={devAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={u.id} />
          <input type="hidden" name="next" value={String(!u.is_developer)} />
          <span className="flex-1 text-sm text-ink">
            {u.is_developer ? '개발 계정' : '일반 계정'}
          </span>
          <button type="submit" disabled={a2} className="btn-ghost h-7 px-2 text-xs">
            {u.is_developer ? '해제' : '개발 계정으로'}
          </button>
        </form>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-faint">
        계정은 삭제하지 않습니다. 쓰지 않는 계정은 비활성화합니다 - 기록을 남긴 계정을
        지우면 그 기록의 작성자를 설명할 수 없습니다.
      </p>
      <Msg state={activeState} />
      <Msg state={devState} />
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <h3 className="mb-2 text-xs font-bold text-ink">{title}</h3>
      {children}
    </div>
  );
}

export function Msg({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-2 rounded bg-danger-bg px-2 py-1.5 text-xs leading-relaxed text-danger">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p className="mt-2 rounded bg-ok-bg px-2 py-1.5 text-xs leading-relaxed text-ok">
        {state.message}
      </p>
    );
  }
  return null;
}
