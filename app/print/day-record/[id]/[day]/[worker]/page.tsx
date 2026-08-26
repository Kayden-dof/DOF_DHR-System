import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import { logPrint } from '@/lib/print';
import PrintFrame, { SignRow } from '@/components/print-frame';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   제조기록서 (§7)

   일차 마감 시점 · 지시서 + 일차 + 작업자 단위
   배치번호, 일차·작업일, 작업자·순환자, 공정별 시작·종료,
   투입 자재 로트·수량, 재포장 수량, 작업자 서명란

   인쇄하면 이 묶음이 잠긴다 (S04). 잠금 단위가 기록지 묶음 단위와 같아야
   같은 날 두 사람이 작업했을 때 각자 자기 것만 마감할 수 있다.

   순환자는 서명하지 않는다. 이름만 표시한다. 책임 주체는 작업자 하나다.
--------------------------------------------------------------------------- */

interface Head {
  batch_no: string; wo_no: string; sheet_count: number; dmr_revision: string;
  item_code: string; item_name: string; raw_lot_no: string;
  worker_name: string; work_date: string;
}
interface RecRow {
  operation_seq: number; operation_code: string; operation_name: string;
  attempt: number; product_lot_no: string | null;
  started_at: Date | null; ended_at: Date | null;
  equipment_id: string | null; rework_qty: number | null; no_material_reason: string | null;
  rotation_name: string | null;
  issues: { item_code: string; item_name: string; lot_no: string;
            qty: string; usage_uom: string }[];
}

export default async function DayRecordSheet({ params }: {
  params: Promise<{ id: string; day: string; worker: string }>;
}) {
  const user = await requireUser();
  const { id, day, worker } = await params;
  const dayNo = Number(day);

  const d = await withActor(user.id, async (db) => {
    const head = await db.one<Head>(
      `select wo.batch_no, wo.wo_no, wo.sheet_count, wo.dmr_revision,
              i.code as item_code, i.name as item_name, ml.lot_no as raw_lot_no,
              u.full_name as worker_name,
              (select min(pr.work_date)::text from process_record pr
                where pr.work_order_id = wo.id and pr.day_no = $2
                  and pr.worker_id = $3) as work_date
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
         join material_lot ml on ml.id = wo.material_lot_id
         join app_user u on u.id = $3
        where wo.id = $1`, [id, dayNo, worker]);
    if (!head) return null;

    return {
      head,
      records: await db.rows<RecRow>(
        `select o.seq as operation_seq, o.code as operation_code, o.name as operation_name,
                pr.attempt, pl.lot_no as product_lot_no, pr.started_at, pr.ended_at,
                pr.equipment_id, pr.rework_qty, pr.no_material_reason,
                ru.full_name as rotation_name,
                coalesce((
                  select json_agg(json_build_object(
                    'item_code', i.code, 'item_name', i.name, 'lot_no', ml.lot_no,
                    'qty', mi.qty, 'usage_uom', i.usage_uom) order by i.code)
                    from material_issue mi
                    join material_lot ml on ml.id = mi.material_lot_id
                    join item i on i.id = ml.item_id
                   where mi.process_record_id = pr.id), '[]'::json) as issues
           from process_record pr
           join dmr_operation o on o.id = pr.operation_id
           left join product_lot pl on pl.id = pr.product_lot_id
           left join app_user ru on ru.id = pr.rotation_worker_id
          where pr.work_order_id = $1 and pr.day_no = $2 and pr.worker_id = $3
          order by o.seq, pr.attempt`, [id, dayNo, worker]),
    };
  });

  if (!d || d.records.length === 0) notFound();
  const { head, records } = d;
  const rotations = [...new Set(records.map((r) => r.rotation_name).filter(Boolean))];

  const meta = await logPrint({
    actorId: user.id, actorName: user.full_name, kind: 'DAY_RECORD',
    workOrderId: id, dayNo, workerId: worker,
    payload: { head, records },
    lockDay: true,
  });

  return (
    <PrintFrame
      meta={meta}
      title="제조기록서"
      subtitle={<>배치 {head.batch_no} · {dayNo}일차 · {head.worker_name}</>}
      back={`/production/${id}`}
    >
      <table className="print-table">
        <tbody>
          <tr>
            <th className="w-[15%]">배치번호</th>
            <td className="w-[35%] font-mono font-bold">{head.batch_no}</td>
            <th className="w-[15%]">일차 / 작업일</th>
            <td className="w-[35%] tnum">
              {dayNo}일차 / {fmtDate(head.work_date)}
            </td>
          </tr>
          <tr>
            <th>제품</th>
            <td>{head.item_name} ({head.item_code})</td>
            <th>제품표준서 개정</th>
            <td className="font-mono">{head.dmr_revision}</td>
          </tr>
          <tr>
            <th>원재료 로트</th>
            <td className="font-mono">{head.raw_lot_no}</td>
            <th>장입 장수</th>
            <td className="tnum">{head.sheet_count} 장</td>
          </tr>
          <tr>
            <th>작업자</th>
            <td className="font-bold">{head.worker_name}</td>
            <th>순환자</th>
            <td>{rotations.length ? rotations.join(', ') : ''}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-5 text-sm font-bold text-black">공정 기록</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[5%] text-center">순번</th>
            <th className="w-[20%]">공정</th>
            <th className="w-[11%]">시작</th>
            <th className="w-[11%]">종료</th>
            <th className="w-[35%]">투입 자재 (로트 / 수량)</th>
            <th className="w-[18%]">비고</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i}>
              <td className="text-center tnum">
                {r.operation_seq}
                {r.attempt > 1 && <div className="text-[9px]">{r.attempt}회차</div>}
              </td>
              <td>
                {r.operation_name}
                <div className="font-mono text-[9px]">{r.operation_code}</div>
                {r.product_lot_no && (
                  <div className="font-mono text-[9px]">제조번호 {r.product_lot_no}</div>
                )}
              </td>
              <td className="tnum">{r.started_at ? fmtDateTime(r.started_at).slice(11) : ''}</td>
              <td className="tnum">{r.ended_at ? fmtDateTime(r.ended_at).slice(11) : ''}</td>
              <td>
                {r.issues.length === 0 ? (
                  r.no_material_reason
                    ? <span>{r.no_material_reason}</span>
                    : <span />
                ) : (
                  r.issues.map((x, j) => (
                    <div key={j}>
                      {x.item_name} · <span className="font-mono">{x.lot_no}</span> ·{' '}
                      <span className="tnum">{Number(x.qty)} {x.usage_uom}</span>
                    </div>
                  ))
                )}
              </td>
              <td>
                {r.equipment_id && <div>설비 {r.equipment_id}</div>}
                {r.rework_qty ? <div className="tnum">재포장 {r.rework_qty}</div> : null}
                {r.issues.length > 0 && r.no_material_reason && (
                  <div>{r.no_material_reason}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-[10px] leading-relaxed text-black">
        여기 적힌 것은 실제로 수행하고 투입한 내용입니다. 작업지시서의 예정과 달라도
        시스템이 고치지 않습니다. 순환자는 서명하지 않으며 이름만 표시합니다.
      </p>

      <SignRow roles={['작업자']} />
    </PrintFrame>
  );
}
