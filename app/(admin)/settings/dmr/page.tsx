import { requireUser, blocksViewer, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
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
}: { searchParams: Promise<{ dm?: string }> }) {
  const user = await requireUser();
  /* 열람자에게 열어 둔 화면이 아니다. 주소를 직접 쳐도 들어가지 못한다 */
  if (blocksViewer(user)) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;

  const sp = await searchParams;

  return (
    <PageShell
      section="설정"
      title="제품표준서"
      lede="서면 제품표준서가 정본입니다. 여기에는 개정 표기와 공정 · 자재 구성표만 옮겨 기재합니다. 이 내용이 작업 지시서의 소요량 계산 근거가 됩니다."
      nav={<SubNav items={settingsNav(user.roles)} />}
    >
      <DmrWorkbench userId={user.id} dmParam={sp.dm} base="/settings/dmr" />
    </PageShell>
  );
}
