import Link from 'next/link';
import { currentUser } from '@/lib/session';
import { redirect } from 'next/navigation';
import { canOpen } from '@/lib/access';
import { homePath } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';

export const dynamic = 'force-dynamic';
export const metadata = { title: '열리지 않는 화면' };

/* ---------------------------------------------------------------------------
   관리자가 닫아 둔 화면 (0116)

   차림표는 못 여는 자리를 감추므로, 여기 오는 길은 대개 셋이다 - 즐겨찾기,
   남이 보내 준 주소, 그리고 방금 권한이 바뀐 경우.

   ── 무엇이 잘못됐다고 말하지 않는다 ──────────────────────────────────────
   닫혀 있는 것은 사고가 아니라 누군가의 결정이다. 그러니 "권한 없음" 으로
   겁을 주는 대신 **어디로 가야 하는지**를 적는다 (§8.5 의 어법과 같다).

   ── 이 화면 자신은 문지기를 지나지 않는다 ────────────────────────────────
   requireUser() 가 닫힌 화면을 여기로 보내므로, 이 화면이 그 문지기를 부르면
   자기에게 자기를 보내는 고리가 된다. currentUser() 를 직접 쓴다 - /password
   가 같은 까닭으로 같은 길을 쓴다.
--------------------------------------------------------------------------- */
export default async function NoAccess() {
  const user = await currentUser();
  if (!user) redirect('/login');

  /*
   * 돌아갈 곳. 그 사람의 홈도 닫혀 있으면 열려 있는 첫 자리로 보낸다 -
   * "돌아가기" 가 다시 여기로 오면 나갈 길이 없다.
   */
  const home = homePath(user.roles);
  const back = canOpen(home, user.roles, user.screens) ? home : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <BrandMark className="mb-8 h-7 w-auto text-[1.125rem]" />
      <h1 className="text-xl font-bold text-ink">이 화면은 열려 있지 않습니다</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        <b className="text-ink">{user.full_name}</b> 님에게는 이 화면이 배정되어 있지
        않습니다. 필요하시면 시스템관리자에게 요청하십시오.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-faint">
        화면 배정은 설정 &gt; 권한에서 계정마다 정합니다.
      </p>
      <div className="mt-8">
        {back
          ? <Link href={back} className="btn-primary">돌아가기</Link>
          : <Link href="/password" className="btn-ghost">비밀번호 화면으로</Link>}
      </div>
    </main>
  );
}
