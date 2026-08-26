import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import { ROLE_LABEL, ROLE_NOTE, ROLE_ORDER } from '@/lib/roles';
import Denied from '@/components/denied';
import NewUserForm from './new-user-form';
import UserRowView, { type UserRow } from './user-row';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const me = await requireUser();
  if (!hasRole(me, 'SYS_ADMIN')) {
    return <Denied what="사용자 · 역할 관리" need="시스템관리자" />;
  }

  const users = await withActor(me.id, (db) =>
    db.rows<UserRow>(
      `select u.id, u.login_code, u.full_name, u.is_active, u.is_developer, u.can_login,
              (u.pin_hash is not null) as has_pin,
              array_remove(array_agg(r.role::text order by r.role), null)::text[] as roles
         from app_user u
         left join user_role r on r.user_id = u.id
        group by u.id
        order by u.is_active desc, u.login_code`,
    ),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-bold text-ink">사용자 · 역할</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
            계정은 삭제하지 않고 비활성화합니다. 역할 부여와 회수는 모두 감사추적에 남습니다.
          </p>
        </div>
        <NewUserForm />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">로그인 번호</th>
                <th className="th">이름</th>
                <th className="th">역할</th>
                <th className="th">상태</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRowView key={u.id} u={{ ...u, roles: u.roles ?? [] }} meId={me.id} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section className="card p-4">
        <h2 className="text-xs font-bold text-ink">역할</h2>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          {ROLE_ORDER.map((r) => (
            <div key={r} className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold text-ink">{ROLE_LABEL[r]}</dt>
              <dd className="text-muted">{ROLE_NOTE[r]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          개발 계정에는 품질책임자 역할을 부여할 수 없습니다. 반대로 품질책임자 역할을 가진
          계정을 개발 계정으로 돌리는 것도 막혀 있습니다 - 둘 다 DB 계층에서 거부됩니다.
        </p>
      </section>
    </div>
  );
}
