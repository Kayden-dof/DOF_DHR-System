import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { isAdmin, isWorker, ROLE_LABEL } from '@/lib/roles';
import { withActor } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { Panel, Field } from '@/components/ui';
import { IdleLockForm } from './me-forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: '내 설정' };

/* ---------------------------------------------------------------------------
   내 설정 (사용자 2026-11-20)

   이 계정 하나에만 걸리는 것을 둔다. 레일 아래 이름을 누르면 온다.

   자동 잠금 (0153)   관리자로 앉은 세션에만 보인다. 작업자 · 열람자 · 품질책임자는
                     늘 잠기므로 고를 것이 없다. 값은 계정에 묶여 DB 에 있고,
                     판정은 관리 역할과 함께 한다 (lib/session.ts idleLockOff).
--------------------------------------------------------------------------- */
export default async function MePage() {
  const user = await requireUser();
  const admin = isAdmin(user.seat);

  /* 관리자로 앉았을 때만 묻는다. 그때는 관리 역할이 있으므로 이 값이 곧 판정이다 */
  const off = admin
    ? (await withActor(user.id, (db) =>
        db.val<boolean>(`select idle_lock_off from app_user where id = $1`, [user.id]))) === true
    : false;

  const roleLine = user.roles.length
    ? user.roles.map((r) => ROLE_LABEL[r]).join(' · ')
    : '역할 없음';

  return (
    <PageShell title="내 설정" lede={`${user.full_name} 님 계정에만 적용됩니다.`}>
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

      {admin && (
        <Panel title="자동 잠금">
          <IdleLockForm off={off} worker={isWorker(user.roles)} />
        </Panel>
      )}
    </PageShell>
  );
}
