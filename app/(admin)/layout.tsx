import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, hasRole, ROLE_LABEL } from '@/lib/session';
import { isAdmin, isWorker } from '@/lib/roles';
import { Wordmark } from '@/components/logo';
import { logout } from './actions';
import Nav, { type NavItem } from './nav';

/* ---------------------------------------------------------------------------
   관리 화면

   키보드와 마우스를 쓰는 사무 환경을 전제한다. 밀도를 높이고 표를 많이 쓴다.
   현장 패드용 화면은 /work 쪽이며 조작 크기가 다르다.

   상단은 한 줄로 끝낸다. 두 줄이 되면 표가 밀려 내려가 화면당 보이는 행이
   줄어든다. 이 시스템은 목록을 훑는 시간이 대부분이다.
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

  const initial = user.full_name.slice(0, 1);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="brand-rule" />

      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center gap-5 px-5 py-2.5 lg:gap-7">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="현황으로">
            <Wordmark className="h-[1.125rem] w-auto" />
            <span className="h-4 w-px bg-line-strong" aria-hidden />
            <span className="display text-[1.0625rem] leading-none text-ink">DHR</span>
            <span className="chip hidden bg-brand-tint text-brand sm:inline-flex">관리</span>
          </Link>

          <Nav items={items} />

          <div className="ml-auto flex items-center gap-2.5">
            {isWorker(user.roles) && (
              <Link href="/work" className="btn-ghost h-8">
                현장 화면
              </Link>
            )}

            <div className="hidden items-center gap-2.5 md:flex">
              <span
                aria-hidden
                className="grid h-8 w-8 place-items-center rounded-full bg-brand-tint text-xs font-bold text-brand"
              >
                {initial}
              </span>
              <div className="leading-tight">
                <div className="flex items-center gap-1.5 text-[0.8125rem] font-bold text-ink">
                  {user.full_name}
                  {user.is_developer && <span className="chip bg-warn-bg text-warn">개발</span>}
                </div>
                <div className="text-[0.6875rem] text-muted">
                  {user.roles.length
                    ? user.roles.map((r) => ROLE_LABEL[r]).join(' · ')
                    : '역할 없음'}
                </div>
              </div>
            </div>

            <form action={logout}>
              <button type="submit" className="btn-quiet h-8">로그아웃</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-7">{children}</main>

      <footer className="mx-auto w-full max-w-[1400px] px-5 pb-10 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="max-w-2xl text-xs leading-relaxed text-faint">
            정본은 서명된 종이다. 이 시스템은 종이를 발행하고 입력된 기록을 집계한다.
            판정하지 않고, 전자서명을 받지 않는다.
          </p>
          <p className="text-[0.6875rem] tracking-wide text-faint">DOF Inc.</p>
        </div>
      </footer>
    </div>
  );
}
