import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { logPrint } from '@/lib/print';
import PrintFrame, { SignRow } from '@/components/print-frame';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   작업 지시서 (§7)

   착수 전 · 배치 단위
   지시서·배치번호, 제품표준서 개정번호, 원재료 로트번호, 장입 장수,
   필요 용기 수, 시약 소요량, 공정 순서, 생산·품질 서명란

   원재료 로트번호는 들어간다. 배치당 1개로 확정되고 동물유래물질 추적이
   요구되기 때문이다. 시약·포장재 로트번호는 들어가지 않는다. 착수 전에
   확정되지 않는다.
--------------------------------------------------------------------------- */

interface Wo {
  wo_no: string; batch_no: string; sheet_count: number; dmr_revision: string;
  issued_at: Date; item_code: string; item_name: string;
  raw_lot_no: string; thickness_band: string | null; raw_item_code: string;
  supplier_name: string; supplier_lot_no: string; coa_no: string; coa_date: string;
  prod_name: string; qa_name: string; device_master_id: string;
}
interface PlanRow { item_code: string; item_name: string; planned_qty: number | null }
interface OpRow {
  seq: number; code: string; name: string; after_cutting: boolean;
  materials: { item_code: string; item_name: string; usage_uom: string;
               basis: string; required: string | null }[];
}

export default async function WorkOrderSheet({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const d = await withActor(user.id, async (db) => {
    const wo = await db.one<Wo>(
      `select wo.wo_no, wo.batch_no, wo.sheet_count, wo.dmr_revision, wo.issued_at,
              wo.device_master_id, i.code as item_code, i.name as item_name,
              ml.lot_no as raw_lot_no, ml.thickness_band, ri.code as raw_item_code,
              s.name as supplier_name, ml.supplier_lot_no, ml.coa_no, ml.coa_date,
              up.full_name as prod_name, uq.full_name as qa_name
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
         join material_lot ml on ml.id = wo.material_lot_id
         join item ri on ri.id = ml.item_id
         join supplier s on s.id = ml.supplier_id
         join app_user up on up.id = wo.issued_by_prod
         join app_user uq on uq.id = wo.issued_by_qa
        where wo.id = $1`, [id]);
    if (!wo) return null;

    /*
     * 예정 형명. 한 배치에서 여러 규격이 나온다. 포장재처럼 제품 개수에
     * 비례하는 자재는 이 합이 있어야 소요량을 미리 계산할 수 있다.
     */
    const plan = await db.rows<PlanRow>(
      `select i.code as item_code, i.name as item_name, p.planned_qty
         from work_order_plan p join item i on i.id = p.item_id
        where p.work_order_id = $1
        order by p.seq, i.code`, [id]);
    const units = plan.reduce((a, r) => a + (r.planned_qty ?? 0), 0);

    return {
      wo,
      plan,
      ops: await db.rows<OpRow>(
        `select o.seq, o.code, o.name, o.after_cutting,
                coalesce((
                  select json_agg(json_build_object(
                    'item_code', r.item_code, 'item_name', r.item_name,
                    'usage_uom', r.usage_uom, 'basis', r.basis::text,
                    'required', r.required) order by r.item_code)
                    from operation_requirements(o.id, $2, $3) r), '[]'::json) as materials
           from dmr_operation o
          where o.device_master_id = $1 order by o.seq`,
        [wo.device_master_id, wo.sheet_count, units]),
    };
  });

  if (!d) notFound();
  const { wo, ops, plan } = d;

  // 필요 용기 수: 장입 구간 기준 자재의 소요량 합. 시약이 통 단위로 나가므로
  // 그 합이 곧 현장에서 꺼내야 할 용기 수다.
  const containers = ops.flatMap((o) =>
    o.materials.filter((m) => m.basis === 'SHEET_TIER' && m.required !== null));
  const containerTotal = containers.reduce((s, m) => s + Number(m.required), 0);

  const meta = await logPrint({
    actorId: user.id, actorName: user.full_name, kind: 'WORK_ORDER',
    workOrderId: id,
    payload: { wo, ops },
  });

  return (
    <PrintFrame
      meta={meta}
      title="작업 지시서"
      subtitle={<>배치 {wo.batch_no} · 지시서 {wo.wo_no}</>}
      back={`/production/${id}`}
    >
      <table className="print-table">
        <tbody>
          <tr>
            <th className="w-[15%]">지시서번호</th>
            <td className="w-[35%] font-mono font-bold">{wo.wo_no}</td>
            <th className="w-[15%]">배치번호</th>
            <td className="w-[35%] font-mono font-bold">{wo.batch_no}</td>
          </tr>
          <tr>
            <th>제품</th>
            <td>{wo.item_name} ({wo.item_code})</td>
            <th>제품표준서 개정</th>
            <td className="font-mono">{wo.dmr_revision}</td>
          </tr>
          <tr>
            <th>원재료 로트번호</th>
            <td className="font-mono font-bold">{wo.raw_lot_no}</td>
            <th>두께 구간</th>
            <td>{wo.thickness_band ?? ''}</td>
          </tr>
          <tr>
            <th>원재료 공급자</th>
            <td>{wo.supplier_name} / {wo.supplier_lot_no}</td>
            <th>성적서</th>
            <td>{wo.coa_no} ({fmtDate(wo.coa_date)})</td>
          </tr>
          <tr>
            <th>장입 장수</th>
            <td className="tnum font-bold">{wo.sheet_count} 장</td>
            <th>필요 용기 수</th>
            <td className="tnum font-bold">{containerTotal} 개</td>
          </tr>
          <tr>
            <th>발행 일시</th>
            <td className="tnum">{fmtDate(wo.issued_at)}</td>
            <th>발행자</th>
            <td>생산 {wo.prod_name} / 품질 {wo.qa_name}</td>
          </tr>
        </tbody>
      </table>

      {plan.length > 0 && (
        <>
          {/*
            * 예정 형명. 규격은 재단에서 확정되지만, 어떤 규격을 몇 개 낼
            * 계획인지는 착수 전에 정해 두고 현장에 같이 내린다.
            * 실제와 달라도 시스템이 고치지 않는다 (§7).
            */}
          <h2 className="mt-5 text-sm font-bold text-black">예정 형명</h2>
          <table className="print-table mt-1.5">
            <thead>
              <tr>
                <th className="w-[24%]">모델명</th>
                <th className="w-[56%]">규격</th>
                <th className="w-[20%] text-right">예정 수량</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((r) => (
                <tr key={r.item_code}>
                  <td className="font-mono font-bold">{r.item_code}</td>
                  <td>{r.item_name}</td>
                  <td className="text-right tnum">{r.planned_qty ?? ''}</td>
                </tr>
              ))}
              <tr>
                <th colSpan={2} className="text-right">합계</th>
                <td className="text-right tnum font-bold">
                  {plan.reduce((a, r) => a + (r.planned_qty ?? 0), 0)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1.5 text-[10px] leading-relaxed text-black">
            규격은 재단 공정에서 확정됩니다. 위 수량은 예정입니다. 실제 규격과
            수량은 재단 시 기록되어 생산 규격 기록지에 인쇄되므로 이 표에 손으로
            적지 않습니다. 예정과 실제가 달라도 시스템이 고치지 않습니다.
          </p>
        </>
      )}

      <h2 className="mt-5 text-sm font-bold text-black">공정 순서 및 자재 소요량</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[6%] text-center">순번</th>
            <th className="w-[16%]">공정 코드</th>
            <th className="w-[22%]">공정명</th>
            <th className="w-[32%]">자재</th>
            <th className="w-[12%] text-right">소요량</th>
            <th className="w-[12%]">확인</th>
          </tr>
        </thead>
        <tbody>
          {ops.map((o) => {
            const rows = o.materials.length || 1;
            return o.materials.length === 0 ? (
              <tr key={o.seq}>
                <td className="text-center tnum">{o.seq}</td>
                <td className="font-mono">{o.code}</td>
                <td>{o.name}{o.after_cutting ? ' (재단 이후)' : ''}</td>
                <td className="text-center">-</td>
                <td />
                <td />
              </tr>
            ) : (
              o.materials.map((m, i) => (
                <tr key={`${o.seq}-${m.item_code}`}>
                  {i === 0 && (
                    <>
                      <td rowSpan={rows} className="text-center tnum">{o.seq}</td>
                      <td rowSpan={rows} className="font-mono">{o.code}</td>
                      <td rowSpan={rows}>
                        {o.name}{o.after_cutting ? ' (재단 이후)' : ''}
                      </td>
                    </>
                  )}
                  <td>{m.item_name} ({m.item_code})</td>
                  <td className="text-right tnum">
                    {m.basis === 'PER_UNIT'
                      ? '재단 후 확정'
                      : m.required === null
                        ? '구간 없음'
                        : `${Number(m.required)} ${m.usage_uom}`}
                  </td>
                  {i === 0 && <td rowSpan={rows} />}
                </tr>
              ))
            );
          })}
        </tbody>
      </table>

      <p className="mt-2 text-[10px] leading-relaxed text-black">
        시약과 포장재의 로트번호는 이 지시서에 인쇄하지 않습니다. 착수 전에 확정되지 않으며,
        실제 투입 로트는 제조기록서에 기록합니다. 여기 적힌 소요량은 예정이며, 실제와 달라도
        시스템이 고치지 않습니다.
      </p>

      <SignRow roles={['생산 책임자', '품질 책임자']} />
    </PrintFrame>
  );
}
