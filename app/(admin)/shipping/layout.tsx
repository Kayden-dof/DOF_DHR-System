import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { SubNav } from '../nav';

/* 구역 머리. 제목과 하위 메뉴를 한 틀에서 낸다. */
export default async function ShippingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="출하 관리" need="생산관리자 또는 시스템관리자" />;
  }

  return (
    <PageShell
      section="출하"
      title="출하 관리"
      lede="멸균 위탁, 출하 승인, 출고. 판정은 서면으로 하고 시스템은 시점과 번호를 기록합니다."
      nav={
        <SubNav
          items={[
            { href: '/shipping', label: '출하 승인' },
            { href: '/shipping/steril', label: '멸균 위탁' },
            { href: '/shipping/ship', label: '출고' },
          ]}
        />
      }
    >
      {children}
    </PageShell>
  );
}
