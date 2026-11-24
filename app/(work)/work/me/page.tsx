import { requireUser } from '@/lib/session';
import { MySettings } from '@/components/my-settings';

export const dynamic = 'force-dynamic';
export const metadata = { title: '내 설정' };

/* ---------------------------------------------------------------------------
   내 설정 · 현장 화면 (사용자 2026-11-25 «내 계정 설정은 어디있어..?»)

   머리줄 «내 설정» 에서 온다. 본문은 관리 화면의 /me 와 같다
   (components/my-settings.tsx). 현장 레이아웃 아래에 있으므로 자동 잠금도 그대로 걸린다.
--------------------------------------------------------------------------- */
export default async function WorkMePage() {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">내 설정</h1>
        <p className="mt-1.5 text-sm text-muted">{user.full_name} 님 계정에만 적용됩니다.</p>
      </div>
      <MySettings user={user} />
    </div>
  );
}
