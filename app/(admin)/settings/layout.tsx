import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';

/* 권한 확인만 한다. 제목과 하위 메뉴는 화면이 스스로 낸다 (app/(admin)/sections.ts 참조) */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) {
    return <Denied what="설정" need="시스템관리자" />;
  }
  return <>{children}</>;
}
