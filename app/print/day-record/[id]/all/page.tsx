import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { PrintBar } from '@/components/print-frame';
import { DayRecordDoc } from '../[day]/[worker]/page';

export const dynamic = 'force-dynamic';

export const metadata = { title: '제조기록서 묶음' };

/* ---------------------------------------------------------------------------
   제조기록서 묶음 발행 (사용자 요청 2026-09-01)

   일차가 여럿인 배치를 한 장씩 뽑으면 여는 횟수만큼 손이 간다. 편철할 때는
   어차피 전부 필요하다.

   ── 마감된 묶음만 넣는다 ──────────────────────────────────────────────────
   제조기록서는 **여는 것이 곧 마감**이다 (S04). 묶음 발행이 아직 작성 중인
   일차까지 끌고 가면, 단추 한 번에 여러 날의 기록이 한꺼번에 잠긴다. 잠금을
   푸는 방법은 없다.

   그래서 이미 잠긴 묶음만 낸다. 아직 마감되지 않은 것은 몇 건인지 화면에
   적어 두고 **넣지 않는다** - 조용히 빼면 다 나온 줄 안다.

   ── 대장은 묶음마다 한 줄 ─────────────────────────────────────────────────
   한 번에 뽑아도 record_print 는 묶음마다 한 줄씩 남는다. 회차도 각자 오른다.
   한 줄로 뭉치면 "이 일차를 몇 번째 뽑았는가" 가 사라진다 (§7).

   ── 낱장과 같은 것을 그린다 ───────────────────────────────────────────────
   DayRecordDoc 하나를 낱장 발행과 함께 쓴다. 두 곳이 각자 그리면 갈라지고,
   종이가 정본인 시스템에서 그 어긋남은 되돌릴 수 없다 (§10).
--------------------------------------------------------------------------- */

interface DayRow {
  day_no: number;
  worker_id: string;
  worker_name: string;
  locked: boolean;
}

export default async function DayRecordBundle({ params }: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const d = await withActor(user.id, async (db) => ({
    wo: await db.one<{ batch_no: string }>(
      `select batch_no from work_order where id = $1`, [id]),
    days: await db.rows<DayRow>(
      `select pr.day_no, pr.worker_id, u.full_name as worker_name,
              exists (select 1 from day_lock dl
                       where dl.work_order_id = pr.work_order_id
                         and dl.day_no = pr.day_no
                         and dl.worker_id = pr.worker_id) as locked
         from process_record pr
         join app_user u on u.id = pr.worker_id
        where pr.work_order_id = $1
        group by pr.work_order_id, pr.day_no, pr.worker_id, u.full_name
        order by pr.day_no, u.full_name`, [id]),
  }));

  if (!d.wo) notFound();

  const locked = d.days.filter((r) => r.locked);
  const open = d.days.filter((r) => !r.locked);

  if (locked.length === 0) {
    return (
      <>
        <PrintBar back={`/production/${id}`} label="제조기록서 묶음" />
        <div className="mx-auto max-w-[210mm] px-2">
          <p className="rounded-lg border border-warn/40 bg-warn-bg px-4 py-3 text-sm leading-relaxed text-ink">
            마감된 일차가 없습니다. 묶음 발행은 이미 마감된 기록지만 냅니다.
            아직 작성 중인 일차는 낱장으로 발행하며, 그때 그 묶음이 잠깁니다 (S04).
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PrintBar
        back={`/production/${id}`}
        label="제조기록서 묶음"
        right={
          <>
            배치 <b className="text-ink">{d.wo.batch_no}</b> · 마감된 묶음{' '}
            <b className="tnum text-ink">{locked.length}</b>건
            {open.length > 0 && (
              <span className="ml-1.5 font-bold text-warn">
                작성 중 {open.length}건은 넣지 않았습니다
              </span>
            )}
          </>
        }
      />

      {/*
        * 작성 중인 일차를 조용히 빼지 않는다. 종이에는 나오지 않되 화면에는
        * 무엇이 빠졌는지 적어 둔다 - 빠진 줄 모르면 다 나온 줄 안다.
        */}
      {open.length > 0 && (
        <div className="no-print mx-auto mb-5 max-w-[210mm] px-2">
          <p className="rounded-lg border border-warn/40 bg-warn-bg px-4 py-3 text-xs leading-relaxed text-ink">
            <b>넣지 않은 일차</b>{' '}
            {open.map((r) => `${r.day_no}일차 ${r.worker_name}`).join(' · ')}
            <br />
            아직 마감되지 않았습니다. 여기서 함께 뽑으면 그 일차들도 한꺼번에
            잠기므로 넣지 않습니다. 낱장으로 발행하십시오.
          </p>
        </div>
      )}

      {locked.map((r) => (
        <DayRecordDoc key={`${r.day_no}-${r.worker_id}`}
                      id={id} dayNo={r.day_no} worker={r.worker_id} bare />
      ))}
    </>
  );
}
