import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, hasRole, ROLE_LABEL } from '@/lib/session';
import { isAdmin, isWorker } from '@/lib/roles';
import { logout } from './actions';
import Nav, { type NavItem } from './nav';

/* ---------------------------------------------------------------------------
   관리 화면

   키보드와 마우스를 쓰는 사무 환경을 전제한다. 밀도를 높이고 표를 많이 쓴다.
   현장 패드용 화면은 /work 쪽이며 조작 크기가 다르다.
--------------------------------------------------------------------------- */

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // 작업자 전용 계정은 현장 화면으로 보낸다.
  if (!isAdmin(user.roles)) {
    redirect(isWorker(user.roles) ? '/work' : '/no-role');
  }

  const items: NavItem[] = [
    { href: '/', label: '현황' },
    { href: '/production', label: '생산' },
    { href: '/material', label: '자재' },
    { href: '/shipping', label: '출하' },
    { href: '/trace', label: '조회' },
    ...(hasRole(user, 'SYS_ADMIN') ? [{ href: '/settings', label: '설정' }] : []),
  ];

  return (
    <div className="min-h-screen">
      <div className="brand-rule" />
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center gap-6 px-5 py-2.5">
          <Link href="/" className="flex shrink-0 items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight text-brand">DOF</span>
            <span className="text-sm font-semibold text-ink">DHR</span>
            <span className="chip bg-canvas text-faint">관리</span>
          </Link>

          <Nav items={items} />

          <div className="ml-auto flex items-center gap-3">
            {isWorker(user.roles) && (
              <Link href="/work" className="btn-ghost h-9 px-3 text-xs">
                현장 화면
              </Link>
            )}
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
              <button type="submit" className="btn-quiet h-9 px-3 text-xs">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-6">{children}</main>

      <footer className="mx-auto max-w-[1500px] px-5 pb-10 pt-2">
        <p className="border-t border-line pt-3 text-xs leading-relaxed text-faint">
          정본은 서명된 종이다. 이 시스템은 종이를 발행하고 입력된 기록을 집계한다.
          판정하지 않고, 전자서명을 받지 않는다.
        </p>
      </footer>
    </div>
  );
}
