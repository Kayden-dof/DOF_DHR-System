import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import Denied from '@/components/denied';
import { Empty } from '@/components/ui';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { SETTINGS_NAV } from '../../sections';
import {
  NewEquipment, EquipCard, type EquipRow, type OpOption,
} from './equipment-forms';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   설비 기준정보

   process_record.equipment_id 는 스키마에도 있고 제조기록서에도 인쇄되는데
   현장에서 넣을 칸이 없어 늘 비어 있는 칸이 찍혀 나갔다. 여기서 목록을 만들고
   공정에 걸어 두면 현장 화면이 그 공정에 걸린 것만 타일로 보여 준다.

   설비를 고르는 것을 강제하지 않는다. 차단은 S01~S05 다섯 개뿐이고 (§2)
   설비 미기록은 그중에 없다.
--------------------------------------------------------------------------- */

export default async function EquipmentPage() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN')) {
    return <Denied what="설비 관리" need="시스템관리자" />;
  }

  const d = await withActor(user.id, async (db) => ({
    equipment: await db.rows<EquipRow>(
      `select e.id, e.code, e.name, e.note, e.is_active,
              coalesce((
                select json_agg(json_build_object(
                  'operation_id', o.id, 'code', o.code, 'name', o.name) order by o.seq)
                  from operation_equipment oe
                  join dmr_operation o on o.id = oe.operation_id
                 where oe.equipment_id = e.id and oe.is_active), '[]'::json) as ops,
              -- 이 설비로 적힌 기록 수. 내리기 전에 얼마나 쓰였는지 보인다
              (select count(*)::int from process_record pr
                where pr.equipment_id = e.code) as used
         from equipment e
        order by e.is_active desc, e.code`),
    /*
     * 공정 목록. 서면 대조가 끝난 제품표준서의 공정만 고른다. 확인하지 않은
     * 개정의 공정에 설비를 걸어 두면 그 개정이 바뀔 때 연결이 떠 버린다.
     */
    ops: await db.rows<OpOption>(
      `select o.id, o.code, o.name, o.seq
         from dmr_operation o
         join device_master dm on dm.id = o.device_master_id
        where dm.verified_at is not null
        order by o.seq`),
  }));

  return (
    <PageShell
      section="설정"
      title="설비"
      lede="공정에 걸어 두면 현장 화면에서 타일로 고를 수 있습니다. 고른 값은 제조기록서에 그대로 적힙니다."
      action={<NewEquipment />}
      nav={<SubNav items={SETTINGS_NAV} />}
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
