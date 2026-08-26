import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { SubNav } from '../nav';

/* 구역 머리. 제목과 하위 메뉴를 한 틀에서 낸다. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) {
    return <Denied what="설정" need="시스템관리자" />;
  }

  return (
    <PageShell
      section="설정"
      title="기준정보와 계정"
      lede="여기서 정한 것이 생산 화면의 선택지가 됩니다."
      nav={
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
      }
    >
      {children}
    </PageShell>
  );
}
