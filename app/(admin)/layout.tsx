import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, hasRole, ROLE_LABEL } from '@/lib/session';
import { isAdmin, isWorker } from '@/lib/roles';
import { Wordmark } from '@/components/logo';
import Watermark, { stamp } from '@/components/watermark';
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

      {/*
        * 상단은 밝게 둔다. 어두운 면은 현장 화면이 가져갔다. 두 모드가 같은
        * 얼굴을 하면 관리 화면인 줄 알고 현장 기록을 만지게 된다.
        *
        * 대신 자리를 넉넉히 준다. 44px 에 다 밀어 넣으니 로고도 메뉴도 이름도
        * 전부 작아져서 무엇 하나 서지 못했다. 크기를 키우는 대신 높이를 준다.
        */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-5 lg:gap-9">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="현황으로">
            <Wordmark className="h-5 w-auto" />
            <span className="h-5 w-px bg-line-strong" aria-hidden />
            <span className="display text-[1.125rem] leading-none text-ink">DHR</span>
          </Link>

          <Nav items={items} />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            {isWorker(user.roles) && (
              <Link href="/work" className="btn-ghost h-9">현장 화면</Link>
            )}

            <div className="hidden items-center gap-2.5 md:flex">
              <span
                aria-hidden
                className="grid size-9 place-items-center rounded-full bg-brand-tint text-[0.8125rem] font-bold text-brand"
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

            <span className="hidden h-5 w-px bg-line md:block" aria-hidden />

            <form action={logout}>
              <button type="submit" className="btn-quiet h-9">로그아웃</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-8">{children}</main>

      <footer className="mx-auto w-full max-w-[1400px] px-5 pb-10 pt-6">
        <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
          <Wordmark className="h-3.5 w-auto opacity-35" purple="var(--color-faint)"
                    gray="var(--color-faint)" />
          <p className="text-[0.6875rem] tracking-wide text-faint">&copy; DOF Inc.</p>
        </div>
      </footer>

      {/* 감사 04. 캡처를 막지는 못하고, 찍히면 누가 언제 봤는지가 함께 남는다 */}
      <Watermark text={stamp(user.full_name, user.login_code)} />
    </div>
  );
}
