import Link from 'next/link';
import { requireUser, hasRole, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { Panel, Empty } from '@/components/ui';
import { withActor } from '@/lib/db';
import { loadCalendar, loadDmHead, loadTimeline } from '@/lib/timeline-db';
import { SubNav } from '../../../nav';
import { settingsNav } from '../../../sections';
import TimelineEditor from './editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: '공정 시간표' };

/* ---------------------------------------------------------------------------
   공정 시간표 (0137 · 사용자 2026-11-19)

   제품표준서 판마다 한 벌. 공정 아래 작업의 차례 · 시간 · 허용범위를 막대로
   놓고 끌어 고친다. 생산 > 일정이 이것을 날짜에 얹는다.
--------------------------------------------------------------------------- */

export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ dm?: string }> }) {
  const user = await requireUser();
  if (blocksScreen(user, '/settings/dmr')) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;
  const { dm } = await searchParams;
  const writable = hasRole(user, 'SYS_ADMIN', 'PROD_MGR');

  const d = dm ? await withActor(user.id, async (db) => {
    const head = await loadDmHead(db, dm);
    if (!head) return null;
    return { head, tl: await loadTimeline(db, head.id), cal: await loadCalendar(db) };
  }) : null;

  const back = d ? `/settings/dmr?dm=${d.head.id}` : '/settings/dmr';
  return (
    <PageShell
      section="설정"
      title={d ? `공정 시간표 · ${d.head.label}` : '공정 시간표'}
      lede={<>공정 아래 작업의 차례와 시간을 막대로 놓습니다. 계획이라 서면 대조 확인과 무관하고, 생산 &gt; 일정이 이 시간표를 날짜에 얹습니다.
        {d?.tl?.updated_at && <> 마지막 저장 {d.tl.updated_at}{d.tl.updated_by_name ? ` · ${d.tl.updated_by_name}` : ''}{d.tl.basis ? ` · 근거 ${d.tl.basis}` : ''}.</>}</>}
      action={<Link href={back} className="btn-ghost">제품표준서로</Link>}
      nav={<SubNav items={settingsNav(user.seat, user.screens)} />}
    >
      {!d ? (
        <Panel><Empty hint="제품표준서 화면에서 판을 고른 뒤 «공정 시간표» 로 들어옵니다.">고른 제품표준서가 없습니다</Empty></Panel>
      ) : d.head.ops.length === 0 ? (
        <Panel><Empty hint="제품표준서에 공정을 먼저 넣습니다.">공정이 없는 판입니다</Empty></Panel>
      ) : (
        <TimelineEditor dm={d.head.id} ops={d.head.ops} initial={d.tl?.steps ?? []} basis={d.tl?.basis ?? ''}
                        cal={d.cal} writable={writable} />
      )}
    </PageShell>
  );
}
