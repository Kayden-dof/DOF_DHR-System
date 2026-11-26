import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { brSheet } from '@/lib/br-sheet';
import RecordSheetClient from './sheet-client';
import IssuePanel, { type IssueLot } from './issue-panel';
import { chem } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   관리자 기록서 정정 (0155 · 사용자 2026-11-20 «틀린걸 알려주는건 좋은데 관리자는 수정 기록할수있게
   열어줘»)

   현장 기록서 화면을 그대로 쓴다. 잠긴 일차여도 칸을 열고, 칸마다 정정 사유를 받는다. 고친 칸은
   정정 내역 · 감사추적에 남고, 그 줄의 작업(검사)자 · 일자는 처음 적은 사람 · 날 그대로다.
--------------------------------------------------------------------------- */
export default async function RecordSheetPage({ params, searchParams }: {
  params: Promise<{ id: string; pr: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const { id, pr } = await params;
  const { doc } = await searchParams;
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="기록서 정정" need="생산관리자 또는 시스템관리자" />;
  }
  const d = await withActor(user.id, async (db) => ({
    sheet: await brSheet(db, pr, doc ?? null),
    head: await db.one<{ batch_no: string; day_no: number; op_name: string; worker: string; locked: boolean }>(
      `select w.batch_no, r.day_no, o.name as op_name, u.full_name as worker,
              is_locked(r.work_order_id, r.day_no, r.worker_id) as locked
         from process_record r join work_order w on w.id = r.work_order_id
         join dmr_operation o on o.id = r.operation_id join app_user u on u.id = r.worker_id
        where r.id = $1 and r.work_order_id = $2`, [pr, id]),
    /* 쓸 수 있는 로트: 이 공정 구성표 품목 먼저, 그 밖의 로트는 «구성표 밖» 으로 (투입 더하기 · 0165) */
    lots: await db.rows<IssueLot>(
      `select ml.id, i.code || ' ' || i.name as item, ml.lot_no,
              rtrim(to_char(ml.qty_available, 'FM999999990.999'), '.') as left, i.usage_uom as uom,
              not exists (select 1 from dmr_bom b where b.operation_id = r.operation_id
                             and b.component_item_id = ml.item_id) as outside
         from process_record r
         cross join material_lot ml
         join item i on i.id = ml.item_id
        where r.id = $1 and ml.status = 'AVAILABLE' and ml.qty_available > 0
          and (ml.expiry_date is null or ml.expiry_date >= (timezone('Asia/Seoul', now()))::date)
        order by outside, i.code, ml.lot_no`, [pr]),
  }));
  if (!d.head) notFound();
  if (!d.sheet) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm text-muted">이 공정에 등록된 제조기록서 양식이 없습니다.</p>
        <Link href={`/production/${id}`} className="btn-ghost mt-4">배치로</Link>
      </main>
    );
  }
  return (
    <div className="space-y-3">
      <RecordSheetClient initial={{ ...d.sheet, locked: false }} recordId={pr} woId={id}
                         title={`${d.head.batch_no} · ${d.head.day_no}일차 · ${chem(d.head.op_name)} · ${d.head.worker}`}
                         locked={d.head.locked} />
      <IssuePanel recordId={pr} woId={id} lots={d.lots} />
    </div>
  );
}
