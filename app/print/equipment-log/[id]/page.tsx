import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { logPrint } from '@/lib/print';
import PrintFrame from '@/components/print-frame';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   설비 사용 기록 (장비 기록지)

   설비 하나의 신원 · 쓰는 공정 · 밸리데이션 이력 · 사용 이력을 한 묶음으로
   인쇄한다. 감사에서 "이 설비가 언제 어느 배치에 쓰였고 그때 밸리데이션이
   유효했는가"를 종이 한 장으로 답하기 위한 양식이다.

   사용 이력의 "당시 밸리데이션" 열은 그 사용일을 덮는 이력이 있었는지를
   산술로 적는다. 있으면 그 보고서 번호, 없으면 "해당 이력 없음"이라는 사실만
   적는다. 판정하지 않는다 (§1).
--------------------------------------------------------------------------- */

interface Head {
  id: string; code: string; name: string; note: string | null; is_active: boolean;
}
interface Val {
  performed_on: string; valid_until: string; report_no: string; note: string | null;
}
interface Use {
  work_date: string; batch_no: string; op_code: string; op_name: string;
  worker_name: string; started: string | null; ended: string | null;
  attempt: number; day_no: number;
  valid_report: string | null;
}

export default async function EquipmentLogSheet({
  params,
}: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const d = await withActor(user.id, async (db) => {
    const head = await db.one<Head>(
      `select id, code, name, note, is_active from equipment where id = $1`, [id]);
    if (!head) return null;

    return {
      head,
      ops: await db.rows<{ code: string; name: string }>(
        `select o.code, o.name
           from operation_equipment oe
           join dmr_operation o on o.id = oe.operation_id
          where oe.equipment_id = $1 and oe.is_active
          order by o.seq`, [id]),
      vals: await db.rows<Val>(
        `select performed_on::text as performed_on, valid_until::text as valid_until,
                report_no, note
           from equipment_validation
          where equipment_id = $1
          order by valid_until desc, performed_on desc`, [id]),
      uses: await db.rows<Use>(
        `select pr.work_date::text as work_date, wo.batch_no,
                o.code as op_code, o.name as op_name, u.full_name as worker_name,
                to_char(timezone('Asia/Seoul', pr.started_at), 'HH24:MI') as started,
                to_char(timezone('Asia/Seoul', pr.ended_at),   'HH24:MI') as ended,
                pr.attempt, pr.day_no,
                (select ev.report_no from equipment_validation ev
                  where ev.equipment_id = $1
                    and ev.performed_on <= pr.work_date
                    and ev.valid_until  >= pr.work_date
                  order by ev.valid_until desc limit 1) as valid_report
           from process_record pr
           join work_order wo on wo.id = pr.work_order_id
           join dmr_operation o on o.id = pr.operation_id
           join app_user u on u.id = pr.worker_id
          where pr.equipment_id = (select code from equipment where id = $1)
          order by pr.work_date desc, pr.started_at desc
          limit 200`, [id]),
    };
  });

  if (!d) notFound();
  const { head, ops, vals, uses } = d;

  const meta = await logPrint({
    actorId: user.id, actorName: user.full_name, kind: 'EQUIPMENT_LOG',
    equipmentId: id,
    payload: { head, vals, uses },
  });

  return (
    <PrintFrame
      meta={meta}
      title="설비 사용 기록"
      subtitle={<>관리번호 <b className="font-mono">{head.code}</b> · {head.name}</>}
      back="/equipment"
    >
      <table className="print-table">
        <tbody>
          <tr>
            <th className="w-[18%]">설비 관리번호</th>
            <td className="w-[32%] font-mono text-base font-bold">{head.code}</td>
            <th className="w-[18%]">설비명</th>
            <td className="w-[32%] font-bold">{head.name}</td>
          </tr>
          <tr>
            <th>쓰는 공정</th>
            <td colSpan={3}>
              {ops.length === 0 ? '' : ops.map((o) => `${o.name} (${o.code})`).join(' · ')}
            </td>
          </tr>
          <tr>
            <th>비고</th>
            <td colSpan={3}>{head.note ?? ''}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-5 text-sm font-bold text-black">밸리데이션 이력</h2>
      {vals.length === 0 ? (
        <p className="mt-1.5 text-xs text-black">등록된 밸리데이션 이력이 없습니다.</p>
      ) : (
        <table className="print-table mt-1.5">
          <thead>
            <tr>
              <th className="w-[20%]">수행일</th>
              <th className="w-[20%]">만료일</th>
              <th className="w-[30%]">보고서 번호</th>
              <th className="w-[30%]">비고</th>
            </tr>
          </thead>
          <tbody>
            {vals.map((v, i) => (
              <tr key={i}>
                <td className="tnum">{fmtDate(v.performed_on)}</td>
                <td className="tnum font-bold">{fmtDate(v.valid_until)}</td>
                <td className="font-mono">{v.report_no}</td>
                <td>{v.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-5 text-sm font-bold text-black">사용 이력</h2>
      {uses.length === 0 ? (
        <p className="mt-1.5 text-xs text-black">사용 기록이 없습니다.</p>
      ) : (
        <table className="print-table mt-1.5">
          <thead>
            <tr>
              <th className="w-[11%]">사용일</th>
              <th className="w-[14%]">배치번호</th>
              <th className="w-[24%]">공정</th>
              <th className="w-[7%] text-right">일차</th>
              <th className="w-[12%]">작업자</th>
              <th className="w-[7%]">시작</th>
              <th className="w-[7%]">종료</th>
              <th className="w-[18%]">당시 밸리데이션</th>
            </tr>
          </thead>
          <tbody>
            {uses.map((u, i) => (
              <tr key={i}>
                <td className="tnum">{fmtDate(u.work_date)}</td>
                <td className="font-mono">{u.batch_no}</td>
                <td>
                  {u.op_name}
                  {u.attempt > 1 && <span className="tnum"> · {u.attempt}회차</span>}
                </td>
                <td className="text-right tnum">{u.day_no}</td>
                <td>{u.worker_name}</td>
                <td className="tnum">{u.started ?? ''}</td>
                <td className="tnum">{u.ended ?? ''}</td>
                <td className={u.valid_report ? 'font-mono text-[10px]' : 'font-bold'}>
                  {u.valid_report ?? '해당 이력 없음'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-black">
        당시 밸리데이션 열은 사용일을 덮는 이력의 보고서 번호입니다. 없으면 그 사실만
        적습니다. 시스템은 적합 여부를 판정하지 않습니다.
      </p>
    </PrintFrame>
  );
}
