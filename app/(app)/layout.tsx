import { requireUser, hasRole, ROLE_LABEL } from '@/lib/session';
import { logout } from './actions';
import Nav from './nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // 화면 접근 제어는 응용 계층 관심사다. DB 계층이 보장하는 것은 기록 무결성
  // (S01~S05)이지 "누가 어느 화면을 보는가"가 아니다. 각 페이지에서도 다시 확인한다.
  const items = [
    { href: '/', label: '현황' },
    ...(hasRole(user, 'SYS_ADMIN') ? [{ href: '/numbering', label: '채번 규칙' }] : []),
    ...(hasRole(user, 'SYS_ADMIN') ? [{ href: '/users', label: '사용자' }] : []),
    ...(hasRole(user, 'SYS_ADMIN', 'PROD_MGR') ? [{ href: '/audit', label: '감사추적' }] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight text-brand">DOF</span>
            <span className="text-sm font-semibold text-ink">DHR</span>
          </div>

          <Nav items={items} />

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-semibold text-ink">
                {user.full_name}
                {user.is_developer && (
                  <span className="chip ml-1.5 bg-warn-bg text-warn">개발</span>
                )}
              </div>
              <div className="text-xs text-muted">
                {user.roles.length
                  ? user.roles.map((r) => ROLE_LABEL[r]).join(' · ')
                  : '역할 없음'}
              </div>
            </div>
            <form action={logout}>
              <button type="submit" className="btn-ghost h-9 px-3 text-xs">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-6">{children}</main>

      <footer className="mx-auto max-w-[1400px] px-5 pb-8 pt-2">
        <p className="text-xs leading-relaxed text-faint">
          정본은 서명된 종이다. 이 시스템은 종이를 발행하고 입력된 기록을 집계한다
          판정하지 않고, 전자서명을 받지 않는다.
        </p>
      </footer>
    </div>
  );
}
