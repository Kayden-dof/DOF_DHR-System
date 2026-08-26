import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { SubNav } from '../nav';

/* 구역 머리. 제목과 하위 메뉴를 한 줄에 두어 표가 위로 올라오게 한다. */
export default async function MaterialLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="자재 관리" need="생산관리자 또는 시스템관리자" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-4">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-bold text-ink">자재</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
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
      </div>

      {children}
    </div>
  );
}
