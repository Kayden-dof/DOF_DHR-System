import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { SubNav } from '../nav';

/* 구역 머리. 제목과 하위 메뉴를 한 줄에 두어 표가 위로 올라오게 한다. */
export default async function ShippingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="출하 관리" need="생산관리자 또는 시스템관리자" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-4">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-bold text-ink">출하</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            멸균 위탁, 출하 승인, 출고. 판정은 서면으로 하고 시스템은 시점과 번호를 기록합니다.
          </p>
        </div>

        <SubNav
          items={[
            { href: '/shipping', label: '출하 승인' },
            { href: '/shipping/steril', label: '멸균 위탁' },
            { href: '/shipping/ship', label: '출고' },
          ]}
        />
      </div>

      {children}
    </div>
  );
}
