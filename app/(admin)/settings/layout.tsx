import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';

/* ---------------------------------------------------------------------------
   설정 구역

   구역 문지기가 시스템관리자만 들이고 있었다. 그런데 이 구역 안에는 시스템
   관리자 말고도 볼 사람이 있는 화면이 둘 있다.

     /settings/audit  감사추적   열람자(대표) 메뉴에 올라 있다
     /settings/dmr    제품표준서  품질책임자가 기준을 보는 자리다

   그래서 **열람자 메뉴의 감사추적이 눌러도 열리지 않는 죽은 항목이었다**
   (2026-09-01 확인). 메뉴에 있는데 막히는 것은 메뉴가 거짓말을 하는 것이다.

   구역은 들이고, 막는 일은 화면이 각자 한다. 화면마다 이미 제 문지기가 있고,
   실제 차단은 그 아래 DB 다 - 읽기 전용 세션은 app_readonly 로 돌아 쓰기 함수의
   실행 권한이 없다 (0053).
--------------------------------------------------------------------------- */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR', 'VIEWER', 'QP')) {
    return <Denied what="설정" need="시스템관리자" />;
  }
  return <>{children}</>;
}
