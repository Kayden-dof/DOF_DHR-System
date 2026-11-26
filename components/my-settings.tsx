import Link from 'next/link';
import type { SessionUser } from '@/lib/session';
import { isAdmin, isWorker, ROLE_LABEL } from '@/lib/roles';
import { withActor } from '@/lib/db';
import { Panel, Field } from '@/components/ui';
import { IdleLockForm, LockMinutesForm } from './my-settings-forms';
import { InstallApp } from './install-app';

/* ---------------------------------------------------------------------------
   내 설정 본문 (사용자 2026-11-20 · 2026-11-25)

   이 계정 하나에만 걸리는 것을 둔다. 관리 화면(/me)과 현장 화면(/work/me)이 같이
   그린다 - 두 곳의 레이아웃이 각자 자동 잠금을 붙이므로, 이 화면도 잠금 아래에 있다.
   잠긴 화면에서 주소만 바꿔 잠금을 끄는 길이 없게 하려는 것이다.

   자동 잠금
     관리 화면 시간   관리 화면을 쓰는 역할이 있으면 (작업자 하나뿐인 계정은 그 화면에 못 들어간다)
     현장 화면 시간   작업자 역할이 있으면
     끄기 (0153)      관리자로 앉은 세션에만. 작업자 · 열람자 · 품질책임자는 늘 잠긴다
--------------------------------------------------------------------------- */
export async function MySettings({ user }: { user: SessionUser }) {
  const row = await withActor(user.id, (db) =>
    db.one<{ off: boolean; desk: number | null; pad: number | null }>(
      `select idle_lock_off as off, idle_lock_desk_min as desk, idle_lock_pad_min as pad
         from app_user where id = $1`, [user.id]));

  const admin = isAdmin(user.seat);
  const worker = isWorker(user.roles);
  const desk = user.roles.some((r) => r !== 'WORKER');
  /* 관리자로 앉아 끈 동안 관리 화면 시간은 쓰이지 않는다. 현장은 작업자로 앉으면 여전히 잠근다 */
  const off = admin && row?.off === true;

  const roleLine = user.roles.length
    ? user.roles.map((r) => ROLE_LABEL[r]).join(' · ')
    : '역할 없음';

  return (
    <div className="space-y-6">
      <Panel
        title="계정"
        action={<Link href="/password" className="btn-ghost">비밀번호 바꾸기</Link>}
      >
        <div className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-3">
          <Field label="이름">{user.full_name}</Field>
          <Field label="사번">{user.login_code}</Field>
          <Field label="역할">{roleLine}</Field>
        </div>
      </Panel>

      {(desk || worker) && (
        <Panel title="자동 잠금"
               note="자리를 비우면 화면을 덮습니다. 비밀번호를 누르면 하던 자리로 돌아갑니다.">
          {desk && <LockMinutesForm place="desk" value={row?.desk ?? null} unused={off} />}
          {worker && <LockMinutesForm place="pad" value={row?.pad ?? null} />}
          {admin && <IdleLockForm off={row?.off === true} worker={worker} />}
        </Panel>
      )}

      {/* 기기에 걸리는 것이라 계정과 상관없지만, 패드를 처음 맞출 때 찾는 자리가 여기다 */}
      <Panel title="앱으로 설치"
             note="홈 화면이나 시작 메뉴의 아이콘으로 바로 열고, 주소창 없이 화면을 넓게 씁니다.">
        <InstallApp />
      </Panel>
    </div>
  );
}
