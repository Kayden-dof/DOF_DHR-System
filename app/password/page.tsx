import { requireUserForPasswordChange } from '@/lib/session';
import { logout } from '@/app/(admin)/actions';
import { Wordmark } from '@/components/logo';
import PinForm from './pin-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: '비밀번호' };

/* ---------------------------------------------------------------------------
   비밀번호 화면

   두 가지 경우에 온다.

     처음 들어온 사람   계정을 만들거나 초기화한 사람이 값을 알고 있다.
                       본인이 바꾸기 전에는 다른 화면으로 가지 않는다.
     스스로 바꾸러 온 사람

   앞의 경우에는 로그아웃 말고 나가는 길을 두지 않는다. 건너뛸 수 있으면
   아무도 바꾸지 않는다.

   ── 왜 이걸 강제하는가 ────────────────────────────────────────────────────
   이 시스템에는 전자서명이 없다. 기록에 누구 이름이 붙는지는 오직 로그인으로
   정해진다. 비밀번호를 둘이 알면 그 이름은 한 사람을 가리키지 않고, 가리키지
   않는 이름은 서명란을 채우지 못한다.

   두 화면 묶음 밖에 둔다. 사무 화면 안에 두면 작업자가 못 오고, 현장 화면
   안에 두면 관리자가 못 온다.
--------------------------------------------------------------------------- */
export default async function PasswordPage() {
  const user = await requireUserForPasswordChange();
  const first = user.must_change_pin;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Wordmark className="h-7 w-auto" />

        <h1 className="mt-6 text-xl font-bold text-ink">
          {first ? '비밀번호를 정해 주십시오' : '비밀번호 바꾸기'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {first ? (
            <>
              {user.full_name} 님의 비밀번호는 계정을 만든 사람이 정한 값입니다.
              본인만 아는 값으로 바꾼 뒤에 시작합니다. 기록에 붙는 이름이
              한 사람을 가리켜야 합니다.
            </>
          ) : (
            <>{user.full_name} 님 · 사번 {user.login_code}</>
          )}
        </p>

        <div className="mt-6">
          <PinForm first={first} />
        </div>

        <form action={logout} className="mt-4">
          <button type="submit" className="btn-quiet h-10 w-full text-sm">
            로그아웃
          </button>
        </form>
      </div>
    </main>
  );
}
