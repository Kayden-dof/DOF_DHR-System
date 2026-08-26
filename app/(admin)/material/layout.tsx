import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { SubNav } from '../nav';

/* 구역 머리. 제목과 하위 메뉴를 한 틀에서 낸다. */
export default async function MaterialLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="자재 관리" need="생산관리자 또는 시스템관리자" />;
  }

  return (
    <PageShell
      section="자재"
      title="자재 관리"
      lede="입고 · 발주 · 재고. 모든 수량은 사용 단위 기준입니다."
      nav={
        <SubNav
          items={[
            { href: '/material', label: '자재 로트' },
            { href: '/material/orders', label: '발주' },
            { href: '/material/stock', label: '재고' },
            { href: '/material/movement', label: '증감 · 용액' },
          ]}
        />
      }
    >
      {children}
    </PageShell>
  );
}
