import Link from 'next/link';
import { withActor } from '@/lib/db';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { isAdmin, isWorker } from '@/lib/roles';
import { WordmarkOnDark } from '@/components/logo';
import Watermark, { stamp } from '@/components/watermark';
import BackFab from '@/components/back-fab';
import DemoBanner from '@/components/demo-banner';
import { logout } from './actions';
import IdleLock from '@/components/idle-lock';

/* ---------------------------------------------------------------------------
   현장 화면

   장갑 낀 손으로 패드를 쓴다. 전제가 관리 화면과 다르다.

     · 키보드를 쓰지 않는다. 숫자는 패드, 선택은 큰 타일, 사유는 미리 정한 문구
     · 최소 조작 크기 56px (.touch가 --tap을 올린다)
     · 한 화면에 한 가지 일만 둔다. 목록과 입력을 겹치지 않는다
     · 되돌릴 수 없는 조작(마감·인쇄) 앞에는 확인 단계를 둔다

   자유 입력이 꼭 필요한 곳은 관리 화면으로 넘긴다.

   상단에 오늘 날짜와 이름을 크게 둔다. 현장 패드는 여러 사람이 번갈아 쓰므로
   지금 누구로 들어와 있는지가 한눈에 보여야 한다. 남의 계정으로 기록이 남으면
   되돌릴 방법이 없다.
--------------------------------------------------------------------------- */

export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  /* 시연 자료가 들어 있으면 모든 화면 맨 위에 알린다 (0049) */
  const demo = await withActor(user.id, (db) =>
    db.val<string>(`select seeded_at::text from demo_marker limit 1`));


  if (!isWorker(user.roles) && !isAdmin(user.roles)) redirect('/no-role');

  const today = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short',
  }).format(new Date());

  return (
    <div className="touch flex min-h-screen flex-col bg-canvas">
      {/*
        * 현장 화면에서는 알리기만 한다. 비우는 일은 사무 화면에서 한다 -
        * 장갑 낀 손이 오가는 자리에 되돌릴 수 없는 단추를 두지 않는다.
        */}
      <DemoBanner seededAt={demo ?? null} canPurge={false} />

      <header className="band-solid sticky top-0 z-20">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-5 py-3">
          <Link href="/work" className="flex shrink-0 items-center gap-3" aria-label="배치 목록으로">
            <WordmarkOnDark className="h-5 w-auto" />
            <span className="h-5 w-px bg-white/25" aria-hidden />
            <span className="display text-[1.125rem] leading-none text-white">DHR</span>
            <span className="chip bg-white/15 text-white">현장</span>
          </Link>

          <span className="hidden text-sm text-on-dark-mute sm:inline tnum">{today}</span>

          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-base font-bold text-white"
              >
                {user.full_name.slice(0, 1)}
              </span>
              <div className="leading-tight">
                <div className="text-base font-bold text-white">{user.full_name}</div>
                <div className="text-xs text-on-dark-mute">
                  {isAdmin(user.roles) ? '관리자' : '작업자'}
                </div>
              </div>
            </div>

            {isAdmin(user.roles) && (
              <Link href="/"
                    className="inline-flex h-11 items-center rounded-md border border-white/25 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                관리 화면
              </Link>
            )}
            <form action={logout}>
              <button type="submit"
                      className="inline-flex h-11 items-center rounded-md border border-white/25 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-6">{children}</main>

      {/*
        * 자리 비움 잠금. 로그아웃이 아니라 화면만 덮는다. 세션은 8시간 그대로다.
        * 시간은 공정 대기 시간을 보고 정해야 한다. 초임계 가공처럼 오래 도는
        * 공정이 있으면 더 길어야 한다.
        */}
      <IdleLock minutes={20} name={user.full_name} initial={user.full_name.slice(0, 1)} />

      <footer className="mx-auto w-full max-w-[1400px] px-5 pb-8 pt-4">
        <div className="flex items-center justify-between gap-4 border-t border-white/12 pt-4">
          <WordmarkOnDark className="h-3.5 w-auto opacity-30" />
          <p className="text-[0.6875rem] tracking-wide text-white/35">&copy; DOF Inc.</p>
        </div>
      </footer>

      {/* 감사 04. 현장 패드는 여러 사람이 번갈아 쓴다. 바탕이 어두우니 밝게 깐다 */}
      <Watermark text={stamp(user.full_name, user.login_code)} />

      {/*
        * 홈 화면에서 전체 화면으로 띄우면 브라우저 뒤로가기가 없다.
        * 첫 화면에서는 스스로 숨는다 (components/back-fab.tsx).
        */}
      <BackFab />
    </div>
  );
}
