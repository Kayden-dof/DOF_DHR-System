import { requireUser, blocksScreen } from '@/lib/session';
import { headers } from 'next/headers';
import { PATH_HEADER } from '@/lib/auth-const';
import Denied from '@/components/denied';

/* 권한 확인만 한다. 제목과 하위 메뉴는 화면이 스스로 낸다 (app/(admin)/sections.ts 참조) */
/* ---------------------------------------------------------------------------
   구역 문지기는 **경로로** 판정한다 (0116)

   전에는 역할 하나로 구역 전체를 막았다. 그러면 관리자가 계정별로 열어 준
   화면도 이 한 줄에 걸려, 배정이 아무 뜻이 없다.

   경로는 미들웨어가 실어 준다 (proxy.ts). 권한 매트릭스에 없는 주소 - 배치
   상세처럼 그 아래에 있는 화면 - 는 여기서 막지 않고 화면이 제 판정을 한다.
--------------------------------------------------------------------------- */
export default async function MaterialLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const here = (await headers()).get(PATH_HEADER);
  if (here && blocksScreen(user, here)) {
    return <Denied what="자재 관리" need="생산관리자 또는 시스템관리자" />;
  }
  return <>{children}</>;
}
