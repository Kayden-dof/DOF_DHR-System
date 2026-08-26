import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { Wordmark, WordmarkOnDark } from '@/components/logo';
import LoginForm from './login-form';

/* ---------------------------------------------------------------------------
   로그인

   두 조작 모드가 여기서 갈린다. 관리자면 관리 화면, 작업자면 현장 화면으로
   넘어간다. 그래서 이 화면은 두 쓰임새를 동시에 견뎌야 한다.

     넓은 화면  왼쪽에 회사 면을 두고 오른쪽에 입력을 둔다
     패드       왼쪽 면을 접고 입력만 남긴다. 세로로 길어도 패드가 잘리지 않는다

   장갑을 낀 손이 누르는 화면이므로 입력은 항상 화면 아래쪽 절반에 온다.
--------------------------------------------------------------------------- */

export default async function LoginPage() {
  if (await currentUser()) redirect('/');

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_minmax(30rem,0.95fr)]">
      {/* 회사 면. 좁은 화면에서는 접힌다 */}
      <section className="band-dark relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]">
          <svg width="100%" height="100%">
            <defs>
              <pattern id="g" width="28" height="28" patternUnits="userSpaceOnUse">
                <path d="M28 0 L0 0 0 28" fill="none" stroke="#fff" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#g)" />
          </svg>
        </div>

        <WordmarkOnDark className="relative h-7 w-auto self-start" />

        <div className="relative max-w-md">
          <h2 className="text-[2rem] font-bold leading-[1.25] tracking-tight text-white">
            정본은 서명된 종이다
          </h2>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-on-dark-mute">
            이 시스템은 종이를 발행하고 입력된 기록을 집계합니다.
            판정하지 않고, 전자서명을 받지 않습니다.
          </p>
          <dl className="mt-9 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-white/10">
            {[
              ['DX2401', '이종 진피'],
              ['5개', '절대 규칙'],
              ['8시간', '세션 유지'],
            ].map(([v, k]) => (
              <div key={k} className="bg-indigo-deep/60 px-4 py-3.5">
                <dt className="text-xs text-on-dark-mute">{k}</dt>
                <dd className="mt-0.5 text-sm font-bold tnum text-white">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-xs text-on-dark-mute">
          DOF Inc. · Regenerative Healthcare Platform
        </p>
      </section>

      {/* 입력 면 */}
      <section className="relative flex flex-col items-center justify-center bg-canvas px-5 py-10">
        <div aria-hidden className="brand-rule absolute inset-x-0 top-0 lg:hidden" />
        <div className="w-full max-w-[23rem]">
          <div className="lg:hidden">
            <Wordmark className="h-6 w-auto" />
          </div>

          <h1 className="mt-6 text-[1.375rem] font-bold tracking-tight text-ink lg:mt-0">
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
