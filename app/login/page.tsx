import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { BrandMark, BrandCopyright } from '@/components/brand-mark';
import { getBrand } from '@/lib/brand';
import { yearKST } from '@/lib/kst';
import { APP_VERSION } from '@/lib/version';
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

  const brand = await getBrand();

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

        {/*
          * 어두운 면에도 로고를 낸다 (사용자 요청 2026-09-01).
          *
          * 전에는 이름을 글자로 냈다. 로고 한 장으로 밝은 바탕과 어두운 바탕을
          * 둘 다 감당할 수 없다는 이유였는데, 어두운 자리에서는 로고 뒤에 밝은
          * 판을 깔기로 하면서 그 이유가 없어졌다 (components/brand-mark.tsx).
          *
          * 로고가 없는 제조소에서는 BrandMark 가 이름을 흰 글자로 낸다. 여기서
          * 갈래를 따로 쓰지 않는다 - 두 곳에서 정하면 갈라진다 (§10).
          */}
        <div className="relative">
          {/*
            * 여기서는 높이가 아니라 폭으로 잡는다. 로고마다 가로세로 비가
            * 달라, 높이를 맞추면 납작한 로고는 이 넓은 면에서 작아 보인다.
            * 글자로 떨어질 때는 폭이 먹지 않으므로(inline) 글자 크기가 잡는다.
            */}
          <BrandMark className="w-60 text-[3.5rem]" dark />
        </div>

        {/*
          * 회사 한 줄 문구도 설정에서 온다 (0073). 전에는 DOF 문구가 박혀
          * 있어, 다른 제조소가 받으면 자기 로고 아래에 남의 회사 설명이 붙었다.
          * 적어 두지 않은 제조소에서는 아무것도 나오지 않는다 - 지어내지 않는다.
          */}
        {brand.companyTagline && (
          <p className="relative text-[0.6875rem] font-medium tracking-[0.18em] text-on-dark-mute">
            {brand.companyTagline}
          </p>
        )}
      </section>

      {/* 입력 면 */}
      <section className="relative flex flex-col items-center bg-canvas px-5 py-9">
        <div aria-hidden className="brand-rule absolute inset-x-0 top-0 lg:hidden" />

        <div className="flex w-full max-w-[25rem] flex-1 flex-col justify-center">
          {/*
            * 가운데로 모은다 (사용자 지시 2026-09-01). 제목 · 한 줄 설명 ·
            * 입력 · 단추가 한 축에 서야 눈이 한 번만 움직인다.
            */}
          {/* 좁은 화면에서는 여기가 브랜드 자리다 */}
          <div className="mb-8 flex justify-center lg:hidden">
            <BrandMark className="h-7 w-auto" />
          </div>

          {/*
            * 줄임말을 풀어 쓴다. 줄임말은 아는 사람에게만 이름이다. 이 화면은
            * 회사 밖 사람도 보고, 새로 온 사람도 첫날 본다.
            *
            * 이름은 설정에서 온다 (0071). 다른 제조소가 받아 자기 이름을 넣어도
            * 옆에 남의 제품 이름이 남아 있으면 안 된다.
            */}
          {brand.systemNameLong && (
            <h1 className="display display-lg text-center text-[1.5rem] leading-[1.35] text-ink">
              {brand.systemNameLong}
            </h1>
          )}

          {brand.systemTagline && (
            <p className="mt-2.5 text-center text-sm font-medium tracking-tight text-muted">
              {brand.systemTagline}
            </p>
          )}

          <div aria-hidden className="mt-5 h-px bg-line" />

          <LoginForm owners={owners} />
        </div>

        <footer className="mt-10 w-full max-w-[25rem] border-t border-line pt-4 text-center text-[0.6875rem] leading-relaxed text-faint">
          {/*
            * 만든 사람을 남긴다 (사용자 지시). 로그인 화면은 이 시스템에서
            * 누구나 매일 보는 유일한 화면이다.
            *
            * 판도 함께 적는다. 종이에 적힌 기록이 어느 판에서 나왔는지 되짚는
            * 첫 자리이고, §8.0 의 IQ 가 묻는 것이기도 하다.
            */}
          <p>Design &amp; Engineering &nbsp;Byunghwi Kim, Technology Advancement Team</p>
          <p className="mt-1">
            DHR v{APP_VERSION} &middot; <BrandCopyright year={yearKST()} />
          </p>
        </footer>
      </section>
    </main>
  );
}
