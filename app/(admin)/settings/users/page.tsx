import { requireUser, hasRole, canWrite } from '@/lib/session';
import { withActor } from '@/lib/db';
import { ROLE_LABEL, ROLE_NOTE, ROLE_ORDER } from '@/lib/roles';
import Denied from '@/components/denied';
import { PageShell, FilterBar } from '@/components/shell';
import { SubNav } from '../../nav';
import { settingsNav } from '../../sections';
import NewUserForm from './new-user-form';
import UserRowView, { type UserRow } from './user-row';
import { LabourRates, type RateRow } from './labour-rate';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '사용자' };

type Search = Promise<{ q?: string; role?: string }>;

export default async function UsersPage({ searchParams }: { searchParams: Search }) {
  const me = await requireUser();
  /*
   * 생산관리자와 품질책임자에게도 연다 (사용자 지시 2026-09-01).
   *
   * 누가 어느 역할을 들고 있는지는 기록에 이름으로 남는 사실이다. 제조기록서에
   * 찍힌 작업자가 그때 무슨 역할이었는지 되짚으려면 이 화면이 보여야 한다.
   *
   * 품질책임자는 읽기 전용 세션이라 계정을 만들거나 역할을 주고받는 단추가
   * 그려지지 않는다.
   */
  if (!hasRole(me, 'SYS_ADMIN', 'PROD_MGR', 'QP')) {
    return <Denied what="사용자 · 역할" need="생산관리자 · 시스템관리자 또는 품질책임자" />;
  }
  const writable = canWrite(me);

  /*
   * 공수 단가는 이 화면에 얹혀 있을 뿐 계정 이야기가 아니다 (0076). 역할에
   * 매기는 값이라 역할을 다루는 자리에 두었다.
   *
   * 품질책임자에게는 내지 않는다. 원가를 막아 둔 것과 같은 이유다 - 그쪽이
   * 보는 것은 돈이 아니라 기준이다. 계정과 역할은 보되 사람 값은 보지 않는다.
   */
  const showRates = hasRole(me, 'SYS_ADMIN', 'PROD_MGR');

  /*
   * 사람이 늘면 표를 눈으로 훑어 찾게 된다. 이름이나 번호로 걸러 내고 역할로
   * 갈라 볼 수 있게 한다 (사용자 지시). 자재 품목 · 작업 지시 화면과 같은
   * 방식이라 배울 것이 없다.
   */
  const sp = await searchParams;
  const q = (sp.q || '').trim() || null;
  const role = ROLE_ORDER.includes(sp.role as never) ? sp.role! : null;

  const d = await withActor(me.id, async (db) => ({
    /*
     * 공수 단가 (0076). 역할에 매기는 값이라 역할을 다루는 이 화면에 둔다.
     * current 는 그 역할에서 지금 쓰이는 줄인가 - 화면이 따로 셈하지 않는다.
     */
    rates: await db.rows<RateRow>(
      `select r.id, r.role::text as role, r.hourly_rate,
              r.effective_from::text as effective_from, r.note,
              u.full_name as registered_by_name,
              to_char(timezone('Asia/Seoul', r.registered_at), 'YYYY-MM-DD') as registered_at,
              (r.hourly_rate = labour_rate_at(r.role, (timezone('Asia/Seoul', now()))::date)
               and r.effective_from <= (timezone('Asia/Seoul', now()))::date
               and r.id = (select r2.id from labour_rate r2
                            where r2.role = r.role
                              and r2.effective_from <= (timezone('Asia/Seoul', now()))::date
                            order by r2.effective_from desc, r2.registered_at desc
                            limit 1)) as current
         from labour_rate r join app_user u on u.id = r.registered_by
        order by r.role, r.effective_from desc, r.registered_at desc`),
    rateToday: await db.val<string>(
      `select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD')`),
    users: await db.rows<UserRow>(
      `select u.id, u.login_code, u.full_name, u.is_active, u.is_developer, u.can_login,
              (u.pin_hash is not null) as has_pin,
              array_remove(array_agg(r.role::text order by r.role), null)::text[] as roles
         from app_user u
         left join user_role r on r.user_id = u.id
        where ($1::text is null
               or u.full_name ilike '%'||$1||'%' or u.login_code like '%'||$1||'%')
          and ($2::text is null
               or exists (select 1 from user_role x
                           where x.user_id = u.id and x.role::text = $2))
        group by u.id
        order by u.is_active desc, u.login_code`, [q, role]),
    counts: await db.rows<{ role: string; n: number }>(
      `select r.role::text as role, count(distinct r.user_id)::int as n
         from user_role r group by r.role`),
    total: await db.val<number>(`select count(*)::int from app_user`),
  }));

  const users = d.users;
  const byRole = new Map(d.counts.map((c) => [c.role, c.n]));
  const link = (r?: string) => {
    const p = new URLSearchParams();
    if (r) p.set('role', r);
    if (q) p.set('q', q);
    const s = p.toString();
    return s ? `/settings/users?${s}` : '/settings/users';
  };

  return (
    <PageShell
      section="설정"
      title="사용자 · 역할"
      lede="계정은 삭제하지 않고 비활성화합니다. 역할 부여와 회수는 모두 감사추적에 남습니다."
      action={writable ? <NewUserForm sysAdmin={hasRole(me, 'SYS_ADMIN')} /> : null}
      nav={<SubNav items={settingsNav(me.roles)} />}
    >

      <FilterBar
        items={[
          { href: link(), label: '전체', count: d.total ?? 0, on: !role },
          ...ROLE_ORDER.map((r) => ({
            href: link(r), label: ROLE_LABEL[r], count: byRole.get(r) ?? 0, on: role === r,
          })),
        ]}
        extra={
          <form className="flex gap-2">
            {role && <input type="hidden" name="role" value={role} />}
            <input name="q" defaultValue={q ?? ''} placeholder="이름 또는 로그인 번호"
                   className="input h-9 w-56 text-xs" autoComplete="off" />
            <button className="btn-ghost h-9 px-3 text-xs">검색</button>
          </form>
        }
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">로그인 번호</th>
                <th className="th">이름</th>
                <th className="th">역할</th>
                <th className="th">상태</th>
                {writable && <th className="th" />}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={writable ? 5 : 4} className="td text-center text-xs text-faint">
                    해당하는 계정이 없습니다.
                  </td>
                </tr>
              ) : users.map((u) => (
                <UserRowView key={u.id} u={{ ...u, roles: u.roles ?? [] }}
                             meId={me.id} meIsDeveloper={me.is_developer}
                             meIsSysAdmin={hasRole(me, 'SYS_ADMIN')}
                             writable={writable} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showRates && <LabourRates rows={d.rates} today={d.rateToday ?? ''} writable={writable} />}

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
    </PageShell>
  );
}
