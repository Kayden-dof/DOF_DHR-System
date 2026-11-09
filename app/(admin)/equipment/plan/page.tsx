import { requireUser, canWrite, blocksScreen } from '@/lib/session';
import { withUser } from '@/lib/db';
import { getBrand } from '@/lib/brand';
import Denied from '@/components/denied';
import { PageShell, StatStrip, type StatItem } from '@/components/shell';
import { SubNav } from '../../nav';
import { EQUIPMENT_NAV } from '../../sections';
import { cleanRects } from '@/lib/floor-plan';
import { FloorPlan, type PlanRoom, type PlanEquip } from './floor-plan';

export const dynamic = 'force-dynamic';

export const metadata = { title: '배치도' };

/* ---------------------------------------------------------------------------
   배치도 (0125 · 사용자 요청 2026-11-09 «공간을 그리고 그 안에 장비를 배치»)

   방을 사각형으로 그리고 설비를 그 안에 놓는다. 설비 점의 색은 밸리데이션
   상태를 따른다 - 설비 화면의 머리줄과 같은 셈이다 (공정 밸리데이션 기준).
   기록이 아니라 기준정보다. 옮긴 자리 · 지운 방은 감사추적에 남는다.
--------------------------------------------------------------------------- */

export default async function EquipmentPlanPage() {
  const user = await requireUser();
  if (blocksScreen(user, '/equipment/plan')) {
    return <Denied what="배치도" need="생산관리자 또는 시스템관리자" />;
  }
  const writable = canWrite(user);
  const { expiryWarnDays: warnDays } = await getBrand();

  const d = await withUser(user, async (db) => ({
    rooms: await db.rows<Omit<PlanRoom, 'rects'> & { rects: unknown }>(
      `select r.id, r.code, r.name, r.clean_class, r.area_m2::float8 as area_m2,
              r.note, r.rects
         from room r
        where r.is_active
        order by r.code`),
    equipment: await db.rows<Omit<PlanEquip, 'state'> & { days_left: number | null }>(
      `select e.id, e.code, e.name, e.room_id, e.to_room_id,
              e.pos_x_mm as x, e.pos_y_mm as y,
              v.valid_until::text as valid_until,
              (v.valid_until - (timezone('Asia/Seoul', now()))::date) as days_left
         from equipment e
         left join lateral (
           select valid_until from equipment_validation
            where equipment_id = e.id and kind = 'VALIDATION'
            order by valid_until desc, performed_on desc limit 1
         ) v on true
        where e.is_active
        order by e.code`),
  }));

  const rooms: PlanRoom[] = d.rooms.map((r) => ({ ...r, rects: cleanRects(r.rects) }));
  const equipment: PlanEquip[] = d.equipment.map(({ days_left, ...e }) => ({
    ...e,
    state: e.valid_until === null || (days_left ?? -1) < 0 ? 'danger'
         : days_left !== null && days_left <= warnDays ? 'warn' : 'ok',
  }));

  const placed = equipment.filter((e) => e.room_id || e.x !== null);
  const loose = equipment.filter((e) => e.room_id && e.x === null);
  const stats: StatItem[] = [
    { label: '방', value: rooms.length, unit: '개' },
    { label: '놓인 설비', value: placed.length - loose.length, unit: '대' },
    { label: '방만 정함 · 자리 미정', value: loose.length, unit: '대',
      tone: loose.length > 0 ? 'info' : undefined },
    { label: '아직 안 놓음', value: equipment.length - placed.length, unit: '대',
      tone: equipment.length - placed.length > 0 ? 'warn' : undefined },
  ];

  return (
    <PageShell
      section="설비"
      title="배치도"
      nav={<SubNav items={EQUIPMENT_NAV} />}
      lede="방을 그리고 설비를 그 안에 놓습니다. 설비 점의 색은 밸리데이션 상태입니다."
      stats={<StatStrip items={stats} />}
    >
      <FloorPlan rooms={rooms} equipment={equipment} writable={writable} />
    </PageShell>
  );
}
