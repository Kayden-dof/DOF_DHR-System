import { requireUser } from '@/lib/session';
import { logout } from '@/app/(admin)/actions';

export const dynamic = 'force-dynamic';

export default async function NoRolePage() {
  const user = await requireUser();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-6 text-center">
        <p className="chip mx-auto bg-warn-bg text-warn">역할 없음</p>
        <h1 className="mt-3 text-base font-bold text-ink">{user.full_name} 님</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          계정에 역할이 부여되어 있지 않아 열 수 있는 화면이 없습니다.
          시스템관리자에게 역할 부여를 요청하십시오.
        </p>
        <form action={logout} className="mt-5">
          <button type="submit" className="btn-ghost w-full">로그아웃</button>
        </form>
      </div>
    </main>
  );
}
