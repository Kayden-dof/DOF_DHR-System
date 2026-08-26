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
      <section className="band-dark relative hidden items-center justify-center overflow-hidden p-16 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 50% 50%, transparent 40%, rgb(10 8 20 / .45) 100%)',
          }}
        />
        <WordmarkOnDark className="relative w-full max-w-[26rem]" />
      </section>

      {/* 입력 면 */}
      <section className="relative flex flex-col items-center bg-canvas px-5 py-9">
        <div aria-hidden className="brand-rule absolute inset-x-0 top-0 lg:hidden" />

        <div className="flex w-full max-w-[24rem] flex-1 flex-col justify-center">
          <div className="lg:hidden">
            <Wordmark className="h-8 w-auto" />
          </div>

          <div className="mt-8 lg:mt-0">
            <p className="crumb">DX2401</p>
            <h1 className="mt-2 text-[1.75rem] font-bold leading-tight tracking-tight text-ink">
              DHR 지원 시스템
            </h1>
          </div>

          <LoginForm owners={owners} />
        </div>

        <footer className="mt-10 w-full max-w-[24rem] text-center text-[0.6875rem] leading-relaxed text-faint">
          <p>Design by 기술고도화팀 &middot; Byunghwi Kim</p>
          <p className="mt-1">&copy; {new Date().getFullYear()} DOF Inc.</p>
        </footer>
      </section>
    </main>
  );
}
