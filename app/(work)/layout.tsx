import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { isAdmin, isWorker } from '@/lib/roles';
import { Wordmark } from '@/components/logo';
import { logout } from './actions';

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

  if (!isWorker(user.roles) && !isAdmin(user.roles)) redirect('/no-role');

  const today = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short',
  }).format(new Date());

  return (
    <div className="touch flex min-h-screen flex-col bg-canvas">
      <div className="brand-rule" />

      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center gap-4 px-4 py-3">
          <Link href="/work" className="flex shrink-0 items-center gap-3" aria-label="배치 목록으로">
            <Wordmark className="h-5 w-auto" />
            <span className="h-5 w-px bg-line-strong" aria-hidden />
            <span className="text-base font-bold tracking-tight text-ink">제조기록</span>
          </Link>

          <span className="hidden text-sm text-muted sm:inline tnum">{today}</span>

          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid h-11 w-11 place-items-center rounded-full bg-brand-tint text-base font-bold text-brand"
              >
                {user.full_name.slice(0, 1)}
              </span>
              <div className="leading-tight">
                <div className="text-base font-bold text-ink">{user.full_name}</div>
                <div className="text-xs text-muted">{isAdmin(user.roles) ? '관리자' : '작업자'}</div>
              </div>
            </div>

            {isAdmin(user.roles) && (
              <Link href="/" className="btn-ghost h-11">관리 화면</Link>
            )}
            <form action={logout}>
              <button type="submit" className="btn-ghost h-11">로그아웃</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-5">{children}</main>

      <footer className="mx-auto w-full max-w-[1100px] px-4 pb-8">
        <p className="border-t border-line pt-4 text-xs leading-relaxed text-faint">
          여기에 입력한 내용은 제조기록서로 인쇄됩니다. 인쇄한 묶음은 고칠 수 없으니
          인쇄 전에 확인하십시오.
        </p>
      </footer>
    </div>
  );
}
