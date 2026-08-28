import Link from 'next/link';
import { withActor } from '@/lib/db';
import { redirect } from 'next/navigation';
import { requireUser, hasRole, ROLE_LABEL } from '@/lib/session';
import { isAdmin, isWorker, isViewerOnly } from '@/lib/roles';
import { Wordmark } from '@/components/logo';
import Watermark, { stamp } from '@/components/watermark';
import BackFab from '@/components/back-fab';
import DemoBanner from '@/components/demo-banner';
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
  /* 시연 자료가 들어 있으면 모든 화면 맨 위에 알린다 (0049) */
  const demo = await withActor(user.id, (db) =>
    db.val<string>(`select seeded_at::text from demo_marker limit 1`));


  /*
   * 작업자 전용 계정은 현장 화면으로 보낸다. 열람자는 여기 남는다 - 볼 것이
   * 이 화면들에 있고, 쓰는 단추는 화면마다 감춘다.
   */
  const viewer = isViewerOnly(user.roles);
  if (!isAdmin(user.roles) && !viewer) {
    redirect(isWorker(user.roles) ? '/work' : '/no-role');
  }

  /*
   * 열람자 메뉴는 셋뿐이다 (사용자 지시).
   *
   * 오늘 · 이번 달 숫자와 개체 번호 찾기는 경영 현황 한 장에 다 있다. 배치를
   * 눌러 들어가는 일이 있으므로 생산을 남기고, 누가 무엇을 고쳤는지는 경영진이
   * 보는 것이 자연스러워 감사추적을 남긴다.
   *
   * 자재 · 설비 · 출하 · 조회는 운영하는 사람의 화면이다. 볼 것이 없어서가
   * 아니라, 볼 것을 넷으로 줄여야 그 넷이 눈에 들어오기 때문이다.
   */
  const items: NavItem[] = viewer
    ? [
        { href: '/board', label: '경영 현황' },
        { href: '/production', label: '생산' },
        { href: '/settings/audit', label: '감사추적' },
      ]
    : [
        { href: '/', label: '현황' },
        { href: '/board', label: '경영' },
        { href: '/production', label: '생산' },
        { href: '/material', label: '자재' },
        { href: '/equipment', label: '설비' },
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
      <DemoBanner seededAt={demo ?? null} canPurge={hasRole(user, 'SYS_ADMIN')} />

      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-5 lg:gap-9">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="현황으로">
            <Wordmark className="h-5 w-auto" />
            <span className="h-5 w-px bg-line-strong" aria-hidden />
            <span className="display text-[1.125rem] leading-none text-ink">DHR</span>
          </Link>

          <div className="flex h-full min-w-0 flex-1 items-stretch">
            <Nav items={items} />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {isWorker(user.roles) && (
              <Link href="/work" className="btn-ghost h-9">현장 화면</Link>
            )}

            <div className="hidden items-center gap-2.5 md:flex">
              {/*
                * 개발 계정 표시를 이름 옆 꼬리표에서 동그라미 자체로 옮긴다.
                * 꼬리표로 두면 이름 줄에 세 번째 색이 끼어들어 머리글이 시끄럽고,
                * 정작 봐야 할 이름보다 꼬리표가 먼저 읽힌다.
                *
                * 동그라미를 물들이면 색은 하나로 줄면서 오히려 더 눈에 띈다.
                * 이 표시는 장식이 아니라 "지금 개발 계정이다"라는 경고다.
                */}
              <span
                aria-hidden
                className={`grid size-9 place-items-center rounded-full text-[0.8125rem] font-bold ${
                  user.is_developer
                    ? 'bg-warn-bg text-warn ring-1 ring-warn/25'
                    : 'bg-brand-tint text-brand'
                }`}
              >
                {initial}
              </span>
              <div className="leading-tight">
                <div className="text-[0.8125rem] font-bold text-ink">
                  {user.full_name}
                </div>
                <div className="text-[0.6875rem] text-muted">
                  {user.is_developer && <span className="font-bold text-warn">개발 · </span>}
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

      {/*
        * 홈 화면에서 전체 화면으로 띄우면 브라우저 뒤로가기가 없다.
        * 첫 화면에서는 스스로 숨는다 (components/back-fab.tsx).
        */}
      <BackFab />
    </div>
  );
}
