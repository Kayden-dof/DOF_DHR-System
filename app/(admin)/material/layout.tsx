import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { SubNav } from '../nav';

export default async function MaterialLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="자재 관리" need="생산관리자 또는 시스템관리자" />;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">자재</h1>
        <p className="mt-1 text-sm text-muted">
          입고 · 발주 · 재고. 모든 수량은 사용 단위 기준입니다.
        </p>
      </div>

      <SubNav
        items={[
          { href: '/material', label: '자재 로트' },
          { href: '/material/orders', label: '발주' },
          { href: '/material/stock', label: '재고' },
          { href: '/material/movement', label: '증감 · 용액' },
        ]}
      />

      {children}
    </div>
  );
}
