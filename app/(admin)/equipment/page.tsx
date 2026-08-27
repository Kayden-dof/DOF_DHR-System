import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import Denied from '@/components/denied';
import { Empty } from '@/components/ui';
import { PageShell, StatStrip, type StatItem } from '@/components/shell';
import {
  NewEquipment, EquipCard, type EquipRow, type OpOption,
} from './equipment-forms';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   설비

   설정 아래에 있던 것을 제 메뉴로 올렸다 (사용자 지시). 설비는 기준정보이면서
   동시에 밸리데이션 기한이라는 살아 있는 상태를 갖는다. 기한이 지나면
     · 작업 지시서 발행 화면과 인쇄물에 미리 표시되고
     · 현장 타일에 경고가 붙으며
     · 검토 지원이 사용일 기준으로 짚는다 (§8.5)
   막지는 않는다. 차단은 S01~S05 뿐이다 (§2).
--------------------------------------------------------------------------- */

export default async function EquipmentPage() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="설비 관리" need="생산관리자 또는 시스템관리자" />;
  }

  const d = await withActor(user.id, async (db) => ({
    equipment: await db.rows<EquipRow>(
      `select e.id, e.code, e.name, e.note, e.is_active,
              v.performed_on::text as performed_on,
              v.valid_until::text as valid_until,
              v.report_no,
              (v.valid_until - (timezone('Asia/Seoul', now()))::date) as days_left,
              coalesce((
                select json_agg(json_build_object(
                  'operation_id', o.id, 'code', o.code, 'name', o.name) order by o.seq)
                  from operation_equipment oe
                  join dmr_operation o on o.id = oe.operation_id
                 where oe.equipment_id = e.id and oe.is_active), '[]'::json) as ops,
              (select count(*)::int from process_record pr
                where pr.equipment_id = e.code) as used,
              coalesce((
                select json_agg(json_build_object(
                  'performed_on', ev.performed_on, 'valid_until', ev.valid_until,
                  'report_no', ev.report_no, 'note', ev.note,
                  'registered_by_name', u.full_name)
                  order by ev.valid_until desc, ev.performed_on desc)
                  from equipment_validation ev
                  join app_user u on u.id = ev.registered_by
                 where ev.equipment_id = e.id), '[]'::json) as history
         from equipment e
         left join lateral (
           select performed_on, valid_until, report_no
             from equipment_validation
            where equipment_id = e.id
            order by valid_until desc, performed_on desc limit 1
         ) v on true
        order by e.is_active desc, e.code`),
    ops: await db.rows<OpOption>(
      `select o.id, o.code, o.name, o.seq
         from dmr_operation o
         join device_master dm on dm.id = o.device_master_id
        where dm.verified_at is not null
        order by o.seq`),
  }));

  const active = d.equipment.filter((e) => e.is_active);
  const expired = active.filter((e) => e.valid_until === null || (e.days_left ?? -1) < 0);
  const soon = active.filter((e) => e.days_left !== null && e.days_left >= 0 && e.days_left <= 30);

  const stats: StatItem[] = [
    { label: '쓰는 설비', value: active.length, unit: '대' },
    { label: '밸리데이션 유효', value: active.length - expired.length - soon.length, unit: '대' },
    { label: '만료 30일 이내', value: soon.length, unit: '대',
      tone: soon.length > 0 ? 'warn' : undefined },
    { label: '기한 경과 · 기록 없음', value: expired.length, unit: '대',
      tone: expired.length > 0 ? 'danger' : undefined },
  ];

  return (
    <PageShell
      section="설비"
      title="설비"
      lede="공정에 걸어 두면 현장에서 타일로 고르고, 고른 값이 제조기록서에 적힙니다. 밸리데이션은 서면 보고서 번호로 등록하며, 기한이 지나도 막지 않고 발행 화면과 검토 지원에 표시됩니다."
      action={<NewEquipment />}
      stats={<StatStrip items={stats} />}
    >
      {d.ops.length === 0 && (
        <div className="card border-warn/30 bg-warn-bg px-4 py-3">
          <p className="text-sm leading-relaxed text-ink">
            서면 대조가 확인된 제품표준서가 없습니다. 공정 목록이 비어 있어 설비를
            공정에 걸 수 없습니다.
          </p>
        </div>
      )}

      {d.equipment.length === 0 ? (
        <div className="card">
          <Empty hint="등록한 설비를 공정에 걸면 현장 화면에 타일로 나옵니다.">
            등록된 설비가 없습니다.
          </Empty>
        </div>
      ) : (
        <div className="space-y-4">
          {d.equipment.map((e) => (
            <EquipCard key={e.id} e={e} ops={d.ops} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
