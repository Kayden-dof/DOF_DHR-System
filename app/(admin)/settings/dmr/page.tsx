import { requireUser, hasRole, canWrite, blocksScreen } from '@/lib/session';
import { fixAt } from '@/lib/unblock';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { withActor } from '@/lib/db';
import { NewDeviceMaster, type ItemOption } from './dmr-forms';
import { SubNav } from '../../nav';
import { settingsNav } from '../../sections';
import { DmrWorkbench } from './workbench';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '제품표준서' };

/* 작업대는 workbench.tsx 하나다. 생산 > 품목 설정과 같은 것을 쓴다. */
export default async function DmrPage({
  searchParams,
}: { searchParams: Promise<{ dm?: string; p?: string }> }) {
  const user = await requireUser();
  /* 열람자에게 열어 둔 화면이 아니다. 주소를 직접 쳐도 들어가지 못한다 */
  if (blocksScreen(user, '/settings/dmr')) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;

  const sp = await searchParams;
  const writable = canWrite(user);
  const fixes = { fin: fixAt(user, '/settings/items', '?type=FIN'), material: fixAt(user, '/material/items') };
  /* 화면 머리의 «제품표준서 개정 추가» 가 고를 완제품 형명 */
  const fin = writable
    ? await withActor(user.id, (db) => db.rows<ItemOption>(
        `select id, code, name, usage_uom, type::text as type from item
          where is_active and type = 'FIN' order by code`))
    : [];

  return (
    <PageShell
      section="설정"
      title="제품표준서"
      lede="서면 제품표준서가 정본입니다. 여기에는 개정 표기와 공정 · 자재 구성표만 옮겨 기재합니다. 이 내용이 작업 지시서의 소요량 계산 근거가 됩니다."
      action={writable && <NewDeviceMaster items={fin} fix={fixes.fin} />}
      nav={<SubNav items={settingsNav(user.roles, user.screens)} />}
    >
      <DmrWorkbench userId={user.id} dmParam={sp.dm} productParam={sp.p} base="/settings/dmr" writable={writable}
                    fixes={fixes} />
    </PageShell>
  );
}
