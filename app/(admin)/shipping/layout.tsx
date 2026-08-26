import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';

/* 권한 확인만 한다. 제목과 하위 메뉴는 화면이 스스로 낸다 (app/(admin)/sections.ts 참조) */
export default async function ShippingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="출하 관리" need="생산관리자 또는 시스템관리자" />;
  }
  return <>{children}</>;
}
