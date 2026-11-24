import { requireUser } from '@/lib/session';
import { PageShell } from '@/components/shell';
import { MySettings } from '@/components/my-settings';

export const dynamic = 'force-dynamic';
export const metadata = { title: '내 설정' };

/* ---------------------------------------------------------------------------
   내 설정 · 관리 화면 (사용자 2026-11-20 · 2026-11-25)

   레일 아래 이름 · «내 설정» 에서 온다. 현장 화면에는 /work/me 가 같은 본문을 그린다
   (components/my-settings.tsx). 작업자로 앉은 세션이 여기로 오면 레이아웃이 그쪽으로
   보낸다.
--------------------------------------------------------------------------- */
export default async function MePage() {
  const user = await requireUser();
  return (
    <PageShell title="내 설정" lede={`${user.full_name} 님 계정에만 적용됩니다.`}>
      <MySettings user={user} />
    </PageShell>
  );
}
