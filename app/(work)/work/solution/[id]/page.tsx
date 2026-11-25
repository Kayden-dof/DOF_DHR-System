import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, hasRole } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { solutionSheet } from '@/lib/br-sheet';
import type { SheetLot } from '@/app/(work)/work/[id]/br-sheet';
import SolutionSheetClient from '@/app/(admin)/material/solution/[id]/sheet-client';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------------------------------------------------------------------------
   현장에서 적는 원액 로트의 PBS 제조기록서 (사용자 2026-11-25 «재고가 없으면 제조기록서를
   작성하는쪽으로»)

   알칼리 처리 투입에서 20X PBS 재고가 없으면 그 자리에서 원액을 만들고 여기로 온다. 관리 화면의
   원액 로트 화면(/material/solution/[id])과 같은 기록서를 같은 처리로 적는다. 닫으면 그 배치로 돌아간다.
--------------------------------------------------------------------------- */
export default async function WorkSolutionSheetPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ wo?: string }>;
}) {
  const { id } = await params;
  const wo = (await searchParams).wo;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR', 'WORKER')) {
    return <Denied what="원액 제조기록서" need="작업자 · 생산관리자 또는 시스템관리자" />;
  }
  const d = await withActor(user.id, async (db) => ({
    sheet: await solutionSheet(db, id),
    lotNo: await db.val<string>(`select lot_no from material_lot where id = $1 and made_on is not null`, [id]),
    /* 부여로트번호 칸에서 고를 원료 로트 (원액이 아닌 입고 로트) */
    lots: await db.rows<SheetLot>(
      `select ml.id, ml.lot_no, ml.item_id, i.code as item_code, i.name as item_name, i.usage_uom,
              ml.qty_available::text as qty_available, ml.expiry_date::text as expiry_date
         from material_lot ml join item i on i.id = ml.item_id
        where ml.made_on is null and ml.status in ('AVAILABLE', 'CONSUMED')
        order by i.code, ml.expiry_date nulls last, ml.lot_no`),
  }));
  const back = wo && UUID.test(wo) ? `/work/${wo}` : '/work';
  if (!d.sheet) {
    /* 원액 로트가 아니면 없는 주소다. 원액 로트인데 그 품목의 제조기록서 양식이 없으면 그렇다고 말한다 */
    if (!d.lotNo) notFound();
    return (
      <section className="card mx-auto mt-6 max-w-xl py-5">
        <h1 className="text-base font-semibold text-ink">원액 로트 <span className="font-mono">{d.lotNo}</span></h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          이 원액 품목에 등록된 제조기록서 양식이 없습니다. 관리 화면의 문서 대조에서 그 품목의
          제조기록서 양식을 먼저 등록하십시오.
        </p>
        <Link href={back} className="btn-ghost mt-4">배치로 돌아가기</Link>
      </section>
    );
  }
  return (
    <SolutionSheetClient initial={d.sheet} lotId={id} lots={d.lots} canWrite
                         back={back} />
  );
}
