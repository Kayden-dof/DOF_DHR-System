import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { Wordmark, WordmarkOnDark } from '@/components/logo';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   로그인

   두 조작 모드가 여기서 갈린다. 관리자면 관리 화면, 작업자면 현장 화면으로
   넘어간다. 그래서 이 화면은 두 쓰임새를 동시에 견뎌야 한다.

     넓은 화면  왼쪽에 로고 면, 오른쪽에 입력
     패드       왼쪽 면을 접고 입력만 남긴다. 세로로 길어도 패드가 잘리지 않는다

   왼쪽 면에는 로고만 둔다. 회사 소개나 숫자를 늘어놓지 않는다. 매일 아침
   같은 사람이 같은 화면을 보고 번호를 누르는 자리이므로, 읽을 것이 있으면
   한 번 읽고 그다음부터는 거슬리기만 한다.

   장갑을 낀 손이 누르는 화면이므로 입력은 항상 화면 아래쪽 절반에 온다.
--------------------------------------------------------------------------- */

export default async function LoginPage() {
  if (await currentUser()) redirect('/');

  // 비밀번호를 잊었을 때 누구에게 말해야 하는지. 초기화는 개발 계정만 할 수 있다.
  let owners: string[] = [];
  try {
    owners = await withActor(null, (db) =>
      db.rows<{ full_name: string }>(
        `select full_name from app_user
          where is_developer and is_active and can_login order by full_name`),
    ).then((rows) => rows.map((r) => r.full_name));
  } catch {
    // DB가 아직 없거나 붙지 않는 상태에서도 로그인 화면은 떠야 한다
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_minmax(29rem,0.9fr)]">
      {/* 로고 면. 좁은 화면에서는 접힌다 */}
      <section className="band-dark relative hidden flex-col justify-between overflow-hidden p-14 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(130% 100% at 50% 42%, transparent 36%, rgb(8 6 18 / .5) 100%)',
          }}
        />

        <span aria-hidden className="relative h-px w-16 bg-white/25" />

        <div className="relative">
          <WordmarkOnDark className="w-full max-w-[23rem]" />

          <div className="mt-9 flex items-center gap-4">
            <span aria-hidden className="h-px w-12 shrink-0 bg-white/25" />
            <span className="display text-[2.5rem] leading-none text-white">DHR</span>
          </div>
        </div>

        <p className="relative text-[0.6875rem] font-medium tracking-[0.18em] text-on-dark-mute">
          REGENERATIVE HEALTHCARE PLATFORM
        </p>
      </section>

      {/* 입력 면 */}
      <section className="relative flex flex-col items-center bg-canvas px-5 py-9">
        <div aria-hidden className="brand-rule absolute inset-x-0 top-0 lg:hidden" />

        <div className="flex w-full max-w-[25rem] flex-1 flex-col justify-center">
          {/* 좁은 화면에서는 여기가 브랜드 자리다 */}
          <div className="mb-9 flex items-baseline gap-3 lg:hidden">
            <Wordmark className="h-7 w-auto" />
            <span className="display text-[1.75rem] leading-none text-brand">DHR</span>
          </div>

          <h1 className="display hidden text-[2.75rem] leading-none text-ink lg:block">
            DHR
          </h1>

          <p className="text-sm font-medium tracking-tight text-muted lg:mt-4">
            제조기록 지원 시스템
          </p>

          <div aria-hidden className="mt-5 h-px bg-line" />

          <LoginForm owners={owners} />
        </div>

        <footer className="mt-10 w-full max-w-[25rem] border-t border-line pt-4 text-center text-[0.6875rem] leading-relaxed text-faint">
          <p>Design by 기술고도화팀 &middot; Byunghwi Kim</p>
          <p className="mt-1">&copy; {new Date().getFullYear()} DOF Inc.</p>
        </footer>
      </section>
    </main>
  );
}
