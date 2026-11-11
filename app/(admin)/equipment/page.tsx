import Link from 'next/link';
import { requireUser, hasRole, canWrite, blocksScreen } from '@/lib/session';
import { fixAt } from '@/lib/unblock';
import { Unblock } from '@/components/unblock';
import { withUser } from '@/lib/db';
import { getBrand } from '@/lib/brand';
import Denied from '@/components/denied';
import { Empty } from '@/components/ui';
import { PageShell, StatStrip, FilterBar, type StatItem } from '@/components/shell';
import { statRows, mono } from '@/components/stat-rows';
import { SubNav } from '../nav';
import { isNoExpiry } from '@/lib/equipment-check';
import { EQUIPMENT_NAV } from '../sections';
import {
  NewEquipment, EquipCard, type EquipRow, type OpOption,
} from './equipment-forms';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '설비' };

/* ---------------------------------------------------------------------------
   설비

   설정 아래에 있던 것을 제 메뉴로 올렸다 (사용자 지시). 설비는 기준정보이면서
   동시에 밸리데이션 기한이라는 살아 있는 상태를 갖는다. 기한이 지나면
     · 작업 지시서 발행 화면과 인쇄물에 미리 표시되고
     · 현장 타일에 경고가 붙으며
     · 검토 지원이 사용일 기준으로 짚는다 (§8.5)
   막지는 않는다. 차단은 S01~S05 뿐이다 (§2).
--------------------------------------------------------------------------- */

/*
 * 상태 거르개 (사용자 2026-11-09 «17개의 설비를 볼 수 있는 필터»).
 * 숫자 띠의 칸과 같은 갈래다. 현황의 «설비 밸리데이션» 은 due(임박 + 경과 · 기록 없음)로 온다.
 */
const FILTERS = [
  { code: 'valid', label: '유효' },
  { code: 'soon', label: '만료 임박' },
  { code: 'gone', label: '기한 경과 · 기록 없음' },
  { code: 'none', label: '대상 아님' },
] as const;
type FilterCode = (typeof FILTERS)[number]['code'] | 'due';

type Search = Promise<{ f?: string }>;

export default async function EquipmentPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  if (blocksScreen(user, '/equipment')) {
    return <Denied what="설비 관리" need="생산관리자 또는 시스템관리자" />;
  }

  /*
   * 쓰지 못하는 세션이면 쓰기 단추를 아예 그리지 않는다.
   *
   * 전에는 순수 열람자만 보고 있어 품질책임자에게는 "설비 등록" 이 그대로
   * 보였다. 눌러도 DB 가 막아 아무 일도 일어나지 않는다 - 죽은 단추다.
   */
  const writable = canWrite(user);

  const d = await withUser(user, async (db) => ({
    equipment: await db.rows<EquipRow>(
      `select e.id, e.code, e.name, e.note, e.is_active,
              e.check_cycle, e.check_items,
              /* 구입과 감가상각 (0076). 원가에만 쓰이고 기록에는 나가지 않는다 */
              e.purchased_on::text as purchased_on,
              e.purchase_price, e.useful_life_months, e.salvage_value, e.monthly_hours,
              e.vendor_name, e.vendor_contact_name, e.vendor_phone,
              e.vendor_email, e.vendor_site, e.vendor_address,
              equipment_hourly_cost(e.code) as hourly_cost,
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
              (select count(*)::int from v_process_equipment ve
                where ve.equipment_id = e.id) as used,
              coalesce((
                select json_agg(json_build_object(
                  'id', ev.id, 'performed_on', ev.performed_on, 'valid_until', ev.valid_until,
                  'report_no', ev.report_no, 'note', ev.note, 'kind', ev.kind::text,
                  'registered_by_name', u.full_name)
                  order by ev.valid_until desc, ev.performed_on desc)
                  from equipment_validation ev
                  join app_user u on u.id = ev.registered_by
                 where ev.equipment_id = e.id), '[]'::json) as history
         from equipment e
         /*
          * 머리줄의 만료는 **공정 밸리데이션**을 말한다 (F4 · 2026-09-11).
          * 교정이 갈라졌으므로 섞어 세면 저울 교정 하나가 초임계 장비의
          * 밸리데이션을 덮어 버린다. 교정 만료는 아래 이력과 검토 표시가 짚는다.
          */
         left join lateral (
           select performed_on, valid_until, report_no
             from equipment_validation
            where equipment_id = e.id and kind = 'VALIDATION'
            order by valid_until desc, performed_on desc limit 1
         ) v on true
        order by e.is_active desc, e.code`),
    /*
     * 공정을 제품(표준서)별로 보여 준다. 전 제품의 공정을 한 줄에 쏟으면
     * 제품이 둘만 되어도 어느 공정이 누구 것인지 읽을 수 없다 (사용자 지적).
     * 제품을 먼저 고르고 그 공정에서 걸며, 제품마다 따로 걸 수 있다.
     *
     * 서면 확인 전 개정도 보여 준다. 설비 연결은 서면 대조 항목(«설비가 서면과
     * 같습니까?»)이라 확인보다 먼저 걸려 있어야 한다 (2026-11-09).
     */
    ops: await db.rows<OpOption>(
      `select o.id, o.code, o.name, o.seq,
              dm.id as dm_id, dm.revision,
              dm.product_code, dm.product_name,
              i.code as item_code, i.name as item_name
         from dmr_operation o
         join device_master dm on dm.id = o.device_master_id
         join item i on i.id = dm.item_id
        order by i.code, dm.revision desc, o.seq`),
  }));

  /* 며칠 남으면 눈에 띄게 할지는 설정이 정한다 (6차 감사 N1) */
  const { expiryWarnDays: warnDays } = await getBrand();

  const active = d.equipment.filter((e) => e.is_active);
  /* 검교정 대상이 아닌 설비는 유효 · 임박 · 경과 어느 숫자에도 넣지 않는다 (0126) */
  const subject = active.filter((e) => e.check_cycle !== 'NONE');
  const expired = subject.filter((e) => e.valid_until === null || (e.days_left ?? -1) < 0);
  const soon = subject.filter(
    (e) => e.days_left !== null && e.days_left >= 0 && e.days_left <= warnDays);

  /*
   * 숫자에 든 설비를 그대로 적는다. 뜻풀이가 아니라 항목이다 (사용자 지시).
   * 밸리데이션은 서면 보고서가 근거이므로 보고서 번호가 있으면 함께 보인다.
   */
  const valid = subject.filter((e) => !expired.includes(e) && !soon.includes(e));
  const exempt = active.filter((e) => e.check_cycle === 'NONE');

  const sp = await searchParams;
  const f = (['valid', 'soon', 'gone', 'none', 'due'] as const).includes(sp.f as FilterCode)
    ? (sp.f as FilterCode) : null;
  const groups: Record<FilterCode, EquipRow[]> = {
    valid, soon, gone: expired, none: exempt, due: [...soon, ...expired],
  };
  /*
   * 손볼 설비를 위로 올린다 (UI/UX 검수 2026-11-11 «설비 목록 경과 · 임박 정렬»). 전에는
   * 코드 순이라 기한이 지난 설비가 목록 가운데 묻혀, 숫자 띠를 보고도 카드를 하나씩
   * 넘겨 찾았다. 차례는 기한 경과 · 기록 없음 → 만료 임박 → 유효 → 대상 아님 → 내린 설비.
   * 앞 두 묶음 안에서는 급한 것(남은 날이 적은 것 · 기록 없음)이 먼저, 나머지는 코드 순.
   */
  const rank = (e: EquipRow) =>
    !e.is_active ? 4 : expired.includes(e) ? 0 : soon.includes(e) ? 1 : exempt.includes(e) ? 3 : 2;
  const urgency = (e: EquipRow) => e.days_left ?? Number.NEGATIVE_INFINITY;
  const byNeed = (a: EquipRow, b: EquipRow) =>
    rank(a) - rank(b)
    || (rank(a) <= 1 ? urgency(a) - urgency(b) || 0 : 0)
    || a.code.localeCompare(b.code);
  /* 거르개는 쓰는 설비 안에서 고른다. 전체는 내린 설비까지 그대로 보인다 */
  const shown = (f ? d.equipment.filter((e) => groups[f].includes(e)) : d.equipment)
    .slice().sort(byNeed);
  const link = (code?: string) => (code ? `/equipment?f=${code}` : '/equipment');
  const eqRow = (e: EquipRow, right: React.ReactNode) =>
    ({ left: mono(e.code), sub: e.name, right });

  const stats: StatItem[] = [
    { label: '쓰는 설비', value: active.length, unit: '대', href: link(),
      detail: statRows(
        active.map((e) => eqRow(e, `공정 ${e.ops.length}개`)),
        '등록된 설비가 없습니다') },
    { label: '밸리데이션 유효', value: valid.length, unit: '대', href: link('valid'),
      detail: statRows(
        valid.map((e) => eqRow(e, isNoExpiry(e.valid_until) ? '최초 1회 · 기한 없음' : `${e.valid_until} 까지`)),
        '해당 설비가 없습니다') },
    { label: `만료 ${warnDays}일 이내`, value: soon.length, unit: '대', href: link('soon'),
      tone: soon.length > 0 ? 'warn' : undefined,
      detail: statRows(
        soon.map((e) => eqRow(e, `${e.days_left}일 남음`)),
        '해당 설비가 없습니다') },
    { label: '기한 경과 · 기록 없음', value: expired.length, unit: '대', href: link('gone'),
      tone: expired.length > 0 ? 'danger' : undefined,
      detail: statRows(
        expired.map((e) => eqRow(e,
          e.valid_until === null ? '기록 없음' : `${-(e.days_left ?? 0)}일 지남`)),
        '해당 설비가 없습니다') },
    { label: '검교정 대상 아님', value: exempt.length, unit: '대', href: link('none'),
      detail: statRows(
        exempt.map((e) => eqRow(e, '대상 아님')),
        '해당 설비가 없습니다') },
  ];

  return (
    <PageShell
      section="설비"
      title="설비"
      nav={<SubNav items={EQUIPMENT_NAV} />}
      lede="공정에 걸어 두면 현장에서 타일로 선택하고, 고른 값이 제조기록서에 기재됩니다. 밸리데이션은 서면 보고서 번호로 등록하며, 기한이 지나도 막지 않고 발행 화면과 검토 지원에 표시됩니다."
      action={writable ? <NewEquipment /> : null}
      stats={<StatStrip items={stats} />}
    >
      {d.ops.length === 0 && (
        <div className="card border-warn/30 bg-warn-bg px-4 py-3">
          <Unblock fix={fixAt(user, '/settings/dmr')} align="start"
                   why="제품표준서에 공정이 없어 설비를 공정에 걸 수 없습니다."
                   todo="제품표준서에 공정 넣기" />
        </div>
      )}

      {d.equipment.length > 0 && (
        <FilterBar
          items={[
            { href: link(), label: '전체', count: d.equipment.length, on: !f },
            ...FILTERS.map((x) => ({
              href: link(x.code), label: x.label, count: groups[x.code].length, on: f === x.code,
            })),
            ...(f === 'due'
              ? [{ href: link('due'), label: '임박 · 경과 · 기록 없음', count: groups.due.length, on: true }]
              : []),
          ]}
        />
      )}

      {d.equipment.length === 0 ? (
        <div className="card">
          {/* 다음 걸음을 적는다 (UI/UX 검수 2026-11-11). 만드는 단추가 어디 있는지부터 */}
          <Empty hint={writable
            ? '오른쪽 위 설비 등록에서 넣습니다. 등록한 설비를 공정에 걸면 현장 화면에 타일로 나옵니다.'
            : '등록한 설비를 공정에 걸면 현장 화면에 타일로 나옵니다.'}>
            등록된 설비가 없습니다.
          </Empty>
        </div>
      ) : (
        <div className="space-y-4">
          {shown.length === 0 && (
            <div className="card">
              <Empty hint="위 거르개에서 전체를 누르면 모든 설비가 보입니다."
                     action={<Link href={link()} className="btn-ghost">전체 보기</Link>}>
                이 갈래에 든 설비가 없습니다.
              </Empty>
            </div>
          )}
          {shown.map((e) => (
            <EquipCard key={e.id} e={e} ops={d.ops} warnDays={warnDays} writable={writable} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
