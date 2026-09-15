import Link from 'next/link';
import { requireUser, blocksViewer } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import Denied from '@/components/denied';
import { Empty, Panel, Tag } from '@/components/ui';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { settingsNav } from '../../sections';
import { SetupSteps, type SetupStep } from '../setup-steps';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다.
 */
export const metadata = { title: '제품 세우기' };

/* ---------------------------------------------------------------------------
   제품 세우기 (사용자 요청 2026-09-15)

   설정 화면 여덟과 「첫 설정 차례」가 이미 있고, 다른 제조소의 다른 품목이
   설정만으로 서는 것도 시험이 확인한다 (npm run second). 그런데 그 차례표는
   **제조소를 한 번 세우는 표**다 - 품목이 하나라도 있으면 그 줄은 채워진
   것으로 보이므로, **둘째 제품을 세울 때는 아무것도 짚지 않는다.**

   그래서 같은 차례를 제품 하나 단위로 한 벌 더 낸다. 이 제품에 공정이
   걸렸는지, 자재 구성표에 줄이 있는지, 장입 구간이 비었는지, 제조번호 규칙이
   걸리는지를 한 자리에서 보고 빈 곳으로 바로 넘어간다.

   ── 여기서 입력하지 않는다 ──────────────────────────────────────────────
   넣는 자리는 그대로 제품표준서 작업대 하나다 (생산 > 제품 · 설정 >
   제품표준서). 같은 값을 두 화면이 쓰면 출처가 둘이 되고, 그것이 이 시스템이
   계보에서부터 피해 온 것이다 (§10).

   ── "완료" 를 적지 않는다 ───────────────────────────────────────────────
   시스템이 아는 것은 등록되었는가 하나뿐이다. 넣은 소요량이 작업표준서와
   같은지, 공정 순서가 맞는지는 모른다. 없는 것만 짚고 있는 것은 지금 값을
   그대로 적는다 (§8.5 가 "이상 없음" 을 금지하는 것과 같은 이유).
--------------------------------------------------------------------------- */

interface Row {
  id: string; revision: string; status: string;
  effective_from: string | null; verified_at: Date | null;
  sheet_min: number | null; sheet_max: number | null; load_unit: string | null;
  steril_box_qty: number | null; license_no: string | null;
  expected_units: number | null;
  item_id: string; item_code: string; item_name: string;
  shelf_life_months: number | null;
  product_code: string; product_name: string;
  issuable: boolean;
  ops: number; ops_after: number; ops_with_equip: number;
  bom_lines: number; ops_no_bom: string[]; tier_missing: string[];
  sample_rows: number; issued: number;
  scheme_name: string | null; scheme_prefix: string | null; scheme_items: number;
  lot_pattern: string | null; lot_reset: string | null; lot_scope: string | null;
}

export default async function ProductSetupPage() {
  const user = await requireUser();
  /* 열람자에게 열어 둔 화면이 아니다. 제품표준서 화면과 같은 문이다 */
  if (blocksViewer(user)) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;

  const d = await withActor(user.id, async (db) => ({
    rows: await db.rows<Row>(
      `select dm.id, dm.revision, dm.status, dm.effective_from::text as effective_from,
              dm.verified_at, dm.sheet_min, dm.sheet_max, dm.load_unit,
              dm.steril_box_qty, dm.license_no, dm.expected_units,
              i.id as item_id, i.code as item_code, i.name as item_name,
              i.shelf_life_months,
              coalesce(dm.product_code, i.code) as product_code,
              coalesce(dm.product_name, i.name) as product_name,

              /* 발행할 수 있는가. 화면이 따로 셈하지 않고 DB 가 막는 조건 그대로다 (0061) */
              (dm.verified_at is not null and dm.status = 'ACTIVE'
               and dm.effective_from is not null
               and dm.effective_from <= (timezone('Asia/Seoul', now()))::date) as issuable,

              (select count(*)::int from dmr_operation o
                where o.device_master_id = dm.id) as ops,
              (select count(*)::int from dmr_operation o
                where o.device_master_id = dm.id and o.after_cutting) as ops_after,
              (select count(*)::int from dmr_operation o
                where o.device_master_id = dm.id
                  and exists (select 1 from operation_equipment oe
                               where oe.operation_id = o.id and oe.is_active)) as ops_with_equip,

              (select count(*)::int from dmr_bom b
                 join dmr_operation o on o.id = b.operation_id
                where o.device_master_id = dm.id) as bom_lines,

              /*
               * 자재가 걸리지 않은 공정. 이것을 "빈 자리" 로 세지 않는다 -
               * 검사 공정에는 자재가 없는 것이 정상이고, 늘 떠 있는 표시는
               * 아무도 안 본다 (0107 · 0108 에서 같은 판단을 했다). 사실로만 적는다.
               */
              (select coalesce(array_agg(o.code order by o.seq), '{}')
                 from dmr_operation o
                where o.device_master_id = dm.id
                  and not exists (select 1 from dmr_bom b
                                   where b.operation_id = o.id)) as ops_no_bom,

              /*
               * 구간이 비어 있는 장입 기준 자재. 이건 다르다 - 구간이 없으면
               * required_qty 가 값을 내지 못해 지시서에 소요량이 안 찍힌다.
               */
              (select coalesce(array_agg(distinct it.name), '{}')
                 from dmr_bom b
                 join dmr_operation o on o.id = b.operation_id
                 join item it on it.id = b.component_item_id
                where o.device_master_id = dm.id and b.basis = 'SHEET_TIER'
                  and not exists (select 1 from dmr_bom_tier t
                                   where t.dmr_bom_id = b.id)) as tier_missing,

              (select count(*)::int from sample_plan sp
                where sp.device_master_id = dm.id) as sample_rows,
              (select count(*)::int from work_order wo
                where wo.device_master_id = dm.id) as issued,

              /* 형명 체계는 접두어로 이어진다 (0075). 품목에 체계 칸을 두지 않았다 */
              ms.name as scheme_name, ms.prefix as scheme_prefix,
              (select count(*)::int from item fi
                where fi.type = 'FIN' and ms.prefix is not null
                  and fi.code like ms.prefix || '%') as scheme_items,

              /* 고르는 차례는 numbering_rule_for 하나에 있다 (0112) */
              nr.pattern as lot_pattern, nr.reset::text as lot_reset,
              case when nr.item_id is not null then '품목별'
                   when nr.item_type is not null then '종류별'
                   when nr.id is not null then '공통' end as lot_scope
         from device_master dm
         join item i on i.id = dm.item_id
         left join model_scheme ms on ms.is_active and i.code like ms.prefix || '%'
         left join numbering_rule nr on nr.id = numbering_rule_for('PRODUCT_LOT', i.id)
        order by dm.status, i.code, dm.revision`),

    /* 아직 제품표준서가 붙지 않은 완제품 품목 */
    orphans: await db.val<number>(
      `select count(*)::int from item i
        where i.type = 'FIN' and i.is_active
          and not exists (select 1 from device_master dm where dm.item_id = i.id)`),
  }));

  return (
    <PageShell
      section="설정"
      title="제품 세우기"
      lede="제품 하나가 어디까지 섰는지 한 자리에서 봅니다. 넣는 것은 제품표준서 작업대에서 하고, 여기서는 빈 곳을 짚어 그 화면으로 보냅니다."
      nav={<SubNav items={settingsNav(user.roles)} />}
    >
      {d.rows.length === 0 ? (
        <Empty hint="생산 > 제품에서 완제품을 만들고 제품표준서 개정을 등록합니다.">
          등록된 제품표준서가 없습니다.
        </Empty>
      ) : d.rows.map((r) => {
        const dmr = `/settings/dmr?dm=${r.id}`;
        const steps: SetupStep[] = [
          {
            href: '/settings/model',
            title: '형명 체계',
            fact: r.scheme_name
              ? `${r.scheme_name} · 접두어 ${r.scheme_prefix} · 이 접두어의 형명 ${r.scheme_items}종`
              : '',
            empty: !r.scheme_name,
            blocks: `${r.item_code} 의 접두어에 맞는 형명 체계가 없습니다. 규격 표기가 종이에 나가지 않습니다`,
          },
          {
            href: '/settings/numbering',
            title: '제조번호 규칙',
            fact: r.lot_pattern
              ? `${r.lot_scope} · ${r.lot_pattern} · ${
                  { NEVER: '초기화 없음', YEARLY: '연 초기화',
                    MONTHLY: '월 초기화', DAILY: '일 초기화' }[r.lot_reset ?? ''] ?? r.lot_reset}`
              : '',
            empty: !r.lot_pattern,
            blocks: '이 품목에 걸리는 제조번호 규칙이 없습니다. 재단에서 번호를 만들 수 없습니다',
          },
          {
            href: dmr,
            title: '제품표준서',
            fact: `${r.revision} · ${r.status}${
              r.effective_from ? ` · 발효 ${fmtDate(r.effective_from)}` : ''}${
              r.verified_at ? ' · 서면 대조 확인됨' : ''}${
              r.license_no ? ` · 허가 ${r.license_no}` : ''}`,
            empty: !r.issuable,
            /*
             * 먼저 걸리는 것부터 말한다. 방금 만든 개정본에 "대조 확인이
             * 남았습니다" 를 먼저 내면, 공정도 안 넣은 사람에게 마지막 걸음을
             * 먼저 시키는 셈이 된다.
             */
            blocks: r.status !== 'ACTIVE'
              ? `상태가 ${r.status} 입니다. 발효된 개정본으로만 발행할 수 있습니다`
              : !r.verified_at
                ? '서면 제품표준서와 대조 확인이 남았습니다. 확인해야 작업 지시를 발행할 수 있습니다'
                : '발효일이 없거나 아직 오지 않았습니다',
          },
          {
            href: dmr,
            title: '공정',
            fact: `공정 ${r.ops}${r.ops_after > 0
              ? ` · 재단 이후 ${r.ops_after}`
              : ' · 재단 분기 없음 (제품 로트가 배치와 1:1)'}`,
            empty: r.ops === 0,
            blocks: '공정이 없습니다. 자재 구성표도 기록도 공정에 붙습니다',
          },
          {
            href: dmr,
            title: '자재 구성표',
            /*
             * 안 걸린 공정을 다 적으면 검사 공정까지 줄줄이 나와 읽히지 않는다.
             * 몇 곳인지를 앞에 적고 이름은 넷까지만 든다.
             */
            fact: `자재 줄 ${r.bom_lines}${r.ops_no_bom.length > 0
              ? ` · 자재가 안 걸린 공정 ${r.ops_no_bom.length}곳 (${
                  r.ops_no_bom.slice(0, 4).join(' · ')}${
                  r.ops_no_bom.length > 4 ? ' 외' : ''})`
              : ''}`,
            empty: r.bom_lines === 0,
            blocks: '자재 구성표가 비어 있습니다. 소요량이 지시서에 찍히지 않고 S05 도 물을 것이 없습니다',
          },
          {
            href: dmr,
            title: '장입 구간',
            fact: r.tier_missing.length === 0
              ? `장입 ${r.sheet_min ?? '?'} ~ ${r.sheet_max ?? '?'}${r.load_unit ?? ''}`
              : '',
            empty: r.tier_missing.length > 0 || r.sheet_min === null || r.sheet_max === null,
            blocks: r.tier_missing.length > 0
              ? `구간이 비어 있는 자재 - ${r.tier_missing.join(' · ')}. 소요량이 계산되지 않습니다`
              : '장입 범위가 없습니다. 지시서를 발행할 때 장수를 물을 기준이 없습니다',
          },
          {
            href: dmr,
            title: '시료 기준',
            fact: `로트 크기 구간 ${r.sample_rows}개`,
            empty: r.sample_rows === 0,
            blocks: '시료 채취 기준이 없습니다. 재단에서 시료 수량을 제안하지 못합니다',
          },
          {
            href: '/equipment',
            title: '설비',
            fact: `설비가 걸린 공정 ${r.ops_with_equip} / ${r.ops}`,
            empty: r.ops > 0 && r.ops_with_equip === 0,
            blocks: '공정에 걸린 설비가 없습니다. 설비 사용 기록이 남지 않습니다',
          },
          {
            href: dmr,
            title: '그 밖의 값',
            fact: [
              r.shelf_life_months ? `사용기간 ${r.shelf_life_months}개월` : '',
              r.steril_box_qty ? `멸균 박스 ${r.steril_box_qty}개` : '',
              r.expected_units ? `배치당 예상 ${r.expected_units}개` : '',
            ].filter(Boolean).join(' · '),
            empty: !r.shelf_life_months,
            blocks: '완제품 사용기간이 없습니다. 유효기한을 계산할 근거가 없습니다',
          },
        ];

        return (
          <Panel
            key={r.id}
            title={`${r.product_name} (${r.product_code})`}
            note={<>
              형명 <span className="font-mono">{r.item_code}</span> · 개정{' '}
              <span className="font-mono">{r.revision}</span>
              {r.issued > 0 && <> · 이 개정으로 나간 작업 지시 <b className="tnum">{r.issued}</b>건</>}
            </>}
            action={r.issuable
              ? <Tag tone="ok">발행할 수 있음</Tag>
              : <Tag tone="brand">발행 전</Tag>}
          >
            <div className="px-4 py-3">
              <SetupSteps steps={steps} title="이 제품을 세우는 차례" />
            </div>
          </Panel>
        );
      })}

      {(d.orphans ?? 0) > 0 && (
        <p className="text-xs leading-relaxed text-muted">
          제품표준서가 붙지 않은 완제품 품목이 <b className="tnum text-ink">{d.orphans}</b>종
          있습니다. 형명 생성으로 만들어 둔 것이면 그대로 두어도 됩니다 - 제품표준서는
          대표 형명 하나에 붙습니다.{' '}
          <Link href="/production/setup" className="font-semibold text-brand">생산 &gt; 제품</Link>
          에서 새 제품을 세웁니다.
        </p>
      )}
    </PageShell>
  );
}
