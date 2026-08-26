import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { SubNav } from '../nav';

/* 구역 머리. 제목과 하위 메뉴를 한 줄에 두어 표가 위로 올라오게 한다. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) {
    return <Denied what="설정" need="시스템관리자" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-4">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-bold text-ink">설정</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            기준정보와 계정. 여기서 정한 것이 생산 화면의 선택지가 됩니다.
          </p>
        </div>

        <SubNav
          items={[
            { href: '/settings', label: '개요' },
            { href: '/settings/numbering', label: '채번 규칙' },
            { href: '/settings/items', label: '품목' },
            { href: '/settings/suppliers', label: '공급자' },
            { href: '/settings/dmr', label: '제품표준서' },
            { href: '/settings/users', label: '사용자' },
            { href: '/settings/audit', label: '감사추적' },
          ]}
        />
      </div>

      {children}
    </div>
  );
}
