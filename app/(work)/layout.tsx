import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { isAdmin, isWorker } from '@/lib/roles';
import { logout } from './actions';

/* ---------------------------------------------------------------------------
   현장 화면

   장갑 낀 손으로 패드를 쓴다. 전제가 관리 화면과 다르다.

     · 키보드를 쓰지 않는다. 숫자는 패드, 선택은 큰 타일, 사유는 미리 정한 문구
     · 최소 조작 크기 56px (.touch가 --tap을 올린다)
     · 한 화면에 한 가지 일만 둔다. 목록과 입력을 겹치지 않는다
     · 되돌릴 수 없는 조작(마감·인쇄) 앞에는 확인 단계를 둔다

   자유 입력이 꼭 필요한 곳은 관리 화면으로 넘긴다.
--------------------------------------------------------------------------- */

export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  if (!isWorker(user.roles) && !isAdmin(user.roles)) redirect('/no-role');

  return (
    <div className="touch flex min-h-screen flex-col">
      <div className="brand-rule" />
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1100px] items-center gap-4 px-4 py-3">
          <Link href="/work" className="flex shrink-0 items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight text-brand">DOF</span>
            <span className="text-base font-semibold text-ink">제조기록</span>
          </Link>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-base font-bold text-ink">{user.full_name}</div>
              <div className="text-xs text-muted">작업자</div>
            </div>
            {isAdmin(user.roles) && (
              <Link href="/" className="btn-ghost h-11 px-3 text-xs">
                관리 화면
              </Link>
            )}
            <form action={logout}>
              <button type="submit" className="btn-ghost h-11 px-4 text-sm">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-5">{children}</main>

      <footer className="mx-auto w-full max-w-[1100px] px-4 pb-6">
        <p className="border-t border-line pt-3 text-xs leading-relaxed text-faint">
          여기에 입력한 내용은 제조기록서로 인쇄됩니다. 인쇄한 묶음은 고칠 수 없으니
          인쇄 전에 확인하십시오.
        </p>
      </footer>
    </div>
  );
}
