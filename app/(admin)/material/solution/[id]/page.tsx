import { notFound } from 'next/navigation';
import { requireUser, hasRole, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { solutionSheet } from '@/lib/br-sheet';
import type { SheetLot } from '@/app/(work)/work/[id]/br-sheet';
import SolutionSheetClient from './sheet-client';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   원액 로트의 PBS 제조기록서 (0145 · 사용자 2026-11-20 «원액 제조 때»)

   원액을 만든 뒤 여기서 그 로트의 제조기록서를 한 번 적는다. 원료 로트 · 양 · 만든 사람 ·
   제조일은 원액 제조 기록에서 채워져 있다. 배치의 WS-03 기록서는 «관리번호 부여» 칸에서
   이 로트를 고르기만 하고, 별첨으로 이 기록을 보여 주고 인쇄에 붙인다.
--------------------------------------------------------------------------- */
export default async function SolutionSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  /* 원액 제조 화면과 같은 문 */
  if (blocksScreen(user, '/material/movement')) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;
  const d = await withActor(user.id, async (db) => ({
    sheet: await solutionSheet(db, id),
    /* 부여로트번호 칸에서 고를 원료 로트 (원액이 아닌 입고 로트) */
    lots: await db.rows<SheetLot>(
      `select ml.id, ml.lot_no, ml.item_id, i.code as item_code, i.name as item_name, i.usage_uom,
              ml.qty_available::text as qty_available, ml.expiry_date::text as expiry_date
         from material_lot ml join item i on i.id = ml.item_id
        where ml.made_on is null and ml.status in ('AVAILABLE', 'CONSUMED')
        order by i.code, ml.expiry_date nulls last, ml.lot_no`),
  }));
  if (!d.sheet) notFound();
  return (
    <SolutionSheetClient initial={d.sheet} lotId={id} lots={d.lots}
                         canWrite={hasRole(user, 'SYS_ADMIN', 'PROD_MGR')} />
  );
}
