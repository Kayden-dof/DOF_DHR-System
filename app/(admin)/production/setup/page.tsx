import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { PRODUCTION_NAV } from '../../sections';
import { NewProduct } from '../../settings/dmr/dmr-forms';
import { DmrWorkbench } from '../../settings/dmr/workbench';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '제품' };

/* ---------------------------------------------------------------------------
   제품 (사용자 지시 2026-08-27)

   만드는 것(제품)과 사들이는 것(자재 품목)은 다른 물건이다. 여기는 제품이고,
   자재 품목은 자재 > 품목이 맡는다. 둘을 한 "품목 등록"으로 묶어 두었더니
   제품 하나 만드는 데 폼 셋을 거쳐야 했다.

   새 제품이 생기면 생산관리자가 여기서 셋업한다. 완제품 품목을 만들고,
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

  // 대표 형명 후보와 오늘. 제품 등록 폼이 쓴다
  const d = await withActor(user.id, async (db) => ({
    finished: await db.rows<{ id: string; code: string; name: string }>(
      `select i.id, i.code, i.name from item i
        where i.type = 'FIN' and i.is_active
          and not exists (select 1 from device_master dm where dm.item_id = i.id)
        order by i.code limit 200`),
    today: (await db.val<string>(
      `select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`)) ?? '',
  }));

  return (
    <PageShell
      section="생산"
      title="제품"
      lede="만드는 제품을 여기서 셋업합니다. 제품 코드와 규격을 정하고, 공정 흐름을 넣고, 자재 구성표와 설비를 겁니다. 서면 대조 확인까지 끝나야 작업 지시를 발행할 수 있습니다. 사들이는 자재는 자재 > 품목에서 등록합니다."
      action={<NewProduct finished={d.finished} today={d.today} />}
      nav={<SubNav items={PRODUCTION_NAV} />}
    >
      <DmrWorkbench userId={user.id} dmParam={sp.dm} base="/production/setup" />
    </PageShell>
  );
}
