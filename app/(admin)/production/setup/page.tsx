import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { PRODUCTION_NAV } from '../../sections';
import { NewItemForm } from '../../settings/items/item-forms';
import { DmrWorkbench } from '../../settings/dmr/workbench';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   생산 품목 설정 (사용자 지시 2026-08-27)

   새 생산 품목이 생기면 생산관리자가 여기서 셋업한다. 완제품 품목을 만들고,
   제품표준서 개정을 등록해 공정을 구성하고, 공정별 자재 구성표와 설비를 걸고,
   배치당 예상 생산수량을 적는다. 서면 제품표준서와 대조 확인까지 끝나야
   작업 지시를 발행할 수 있다.

   작업대는 설정 > 제품표준서와 같은 것이다. 셋업은 생산관리자의 일이고,
   같은 자료를 시스템관리자가 설정에서도 본다.
--------------------------------------------------------------------------- */
export default async function ProductionSetupPage({
  searchParams,
}: { searchParams: Promise<{ dm?: string }> }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="생산 품목 설정" need="생산관리자 또는 시스템관리자" />;
  }
  const sp = await searchParams;

  return (
    <PageShell
      section="생산"
      title="품목 설정"
      lede="새 생산 품목의 셋업입니다. 완제품 품목을 만들고, 공정을 구성하고, 자재 구성표와 설비를 걸고, 배치당 예상 생산수량을 적습니다. 서면 대조 확인까지 끝나야 작업 지시를 발행할 수 있습니다."
      action={<NewItemForm />}
      nav={<SubNav items={PRODUCTION_NAV} />}
    >
      <DmrWorkbench userId={user.id} dmParam={sp.dm} base="/production/setup" />
    </PageShell>
  );
}
