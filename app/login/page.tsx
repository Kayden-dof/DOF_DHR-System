import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { Wordmark, WordmarkOnDark } from '@/components/logo';
import LoginForm from './login-form';

/* ---------------------------------------------------------------------------
   로그인

   두 조작 모드가 여기서 갈린다. 관리자면 관리 화면, 작업자면 현장 화면으로
   넘어간다. 그래서 이 화면은 두 쓰임새를 동시에 견뎌야 한다.

     넓은 화면  왼쪽에 로고 면, 오른쪽에 입력
     패드       왼쪽 면을 접고 입력만 남긴다. 세로로 길어도 패드가 잘리지 않는다

   왼쪽 면에는 로고만 둔다. 회사 소개나 숫자를 늘어놓지 않는다. 매일 아침
   같은 사람이 같은 화면을 보고 번호를 누르는 자리이므로, 읽을 것이 있으면
   한 번 읽고 그다음부터는 거슬리기만 한다. 로고는 읽는 것이 아니라 보는 것이다.

   장갑을 낀 손이 누르는 화면이므로 입력은 항상 화면 아래쪽 절반에 온다.
--------------------------------------------------------------------------- */

export default async function LoginPage() {
  if (await currentUser()) redirect('/');

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_minmax(28rem,0.9fr)]">
      {/* 로고 면. 좁은 화면에서는 접힌다 */}
      <section className="band-dark relative hidden items-center justify-center overflow-hidden p-16 lg:flex">
        <WordmarkOnDark className="relative w-full max-w-[26rem]" />
      </section>

      {/* 입력 면 */}
      <section className="relative flex flex-col items-center justify-center bg-canvas px-5 py-10">
        <div aria-hidden className="brand-rule absolute inset-x-0 top-0 lg:hidden" />

        <div className="w-full max-w-[23rem]">
          <div className="lg:hidden">
            <Wordmark className="h-8 w-auto" />
          </div>

          <h1 className="mt-7 text-[1.375rem] font-bold tracking-tight text-ink lg:mt-0">
            DHR 지원 시스템
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            로그인하면 맡은 일에 맞는 화면으로 넘어갑니다.
          </p>

          <LoginForm />
        </div>
      </section>
    </main>
  );
}
