import Link from 'next/link';
import FlowDiagram from './flow-diagram';
import { withActor } from '@/lib/db';
import { fmtDate, fmtDateTime } from '@/lib/fmt';
import { Panel, Empty, Tag, Field } from '@/components/ui';
import { FilterBar } from '@/components/shell';
import { Table, Th, Td, IdCell, RowLink } from '@/components/table';
import { Unblock } from '@/components/unblock';
import type { Fix } from '@/lib/unblock';
import {
  VerifyForm, AddOperationForm, OperationCard, ExpectedUnitsForm,
  SamplePlanForm, type SampleTier,
  ProductCodeForm, OperationSetForm, BomSetForm, DmrNoteForm, DmrLimitsForm, EffectiveFromForm,
  type OperationRow, type ItemOption,
} from './dmr-forms';

/* ---------------------------------------------------------------------------
   제품표준서 작업대

   설정 > 제품표준서와 생산 > 품목 설정이 같은 작업대를 쓴다. 새 생산 품목의
   셋업(공정 구성 · 자재 구성표 · 설비 연결 · 예상 생산수량)은 생산관리자의
   일이고, 같은 자료를 설정에서도 본다. 화면 골격과 주소만 다르다.
--------------------------------------------------------------------------- */

interface DmRow {
  id: string; revision: string; status: string; effective_from: string | null;
  verified_at: Date | null; verified_by_name: string | null;
  expected_units: number | null; sample_basis: string | null;
  product_code: string | null; product_name: string | null; note: string | null;
  /** 서면 허가증의 번호 (0095) */
  license_no: string | null;
  sheet_min: number | null; sheet_max: number | null; steril_box_qty: number | null;
  /* 장입 수량의 단위 (0101) */
  load_unit: string | null;
  item_code: string; item_name: string;
  op_count: number; bom_count: number; wo_count: number;
  /** 작업 지시 발행이 받아 주는 개정인가 (0061 의 세 조건) */
  in_force: boolean;
}

/* ---------------------------------------------------------------------------
   개정의 상태 (사용자 2026-11-11 «Rev 몇이 현행본이고 몇 개가 지나갔는지»)

   작업 지시 발행이 묻는 규칙(0061)을 그대로 읽는다. 시스템이 새로 판정하지 않는다.
     현행      서면 대조 확인 · ACTIVE · 시행일이 오늘 이전인 개정 가운데 가장 나중 것
     지난 개정  같은 조건이지만 더 나중 개정이 시행된 것
     시행 전    확인은 끝났으나 시행일이 비었거나 아직 오지 않은 것
     작성 중    서면 대조 확인 전
--------------------------------------------------------------------------- */
function revState(m: DmRow, currentId: string | null): {
  key: 'current' | 'past' | 'pending' | 'draft'; label: string; tone: 'ok' | 'quiet' | 'info' | 'warn';
} {
  if (!m.verified_at || m.status !== 'ACTIVE') return { key: 'draft', label: '작성 중', tone: 'warn' };
  if (!m.in_force) return { key: 'pending', label: '시행 전', tone: 'info' };
  if (m.id === currentId) return { key: 'current', label: '현행', tone: 'ok' };
  return { key: 'past', label: '지난 개정', tone: 'quiet' };
}

/** 제품의 열쇠. 제품 코드가 없으면 대표 형명 */
const keyOf = (m: DmRow) => m.product_code ?? m.item_code;
/** 그 제품의 현행본: 받아 주는 개정 가운데 시행일 · 개정이 가장 나중 것 */
const currentOf = (revs: DmRow[]) => revs
  .filter((m) => m.in_force)
  .sort((a, b) => (b.effective_from ?? '').localeCompare(a.effective_from ?? '')
                  || b.revision.localeCompare(a.revision))[0] ?? null;

type Search = Promise<{ dm?: string }>;

export async function DmrWorkbench({
  userId, dmParam, productParam, base, writable = true, fixes,
}: {
  userId: string;
  /** 고른 제품 (제품 코드, 쿼리스트링 ?p=) */
  productParam?: string;
  /**
   * 막힌 단추를 푸는 자리 (사용자 요청 2026-11-07). 부르는 화면이 그 사람의
   * 권한으로 정해 넘긴다 (lib/unblock.ts) - 완제품 형명과 자재 품목.
   */
  fixes?: { fin: Fix; material: Fix };
  /*
   * 쓰지 못하는 세션이면 쓰기 자리를 그리지 않는다 (사용자 결정 2026-09-11).
   *
   * `editable` 은 "이 개정이 아직 안 나갔는가" 를 묻는다. 그것과 별개로
   * **이 사람이 쓸 수 있는가** 를 물어야 한다. 품질책임자는 제품표준서를
   * 봐야 하지만 고치지는 않는다.
   */
  writable?: boolean;
  /** 고른 제품표준서 id (쿼리스트링) */
  dmParam?: string;
  /** 선택 링크가 돌아올 주소. '/settings/dmr' 또는 '/production/setup' */
  base: string;
}) {
  const d = await withActor(userId, async (db) => {
    const masters = await db.rows<DmRow>(
      `select dm.id, dm.revision, dm.status, dm.effective_from, dm.verified_at,
              dm.expected_units, dm.sample_basis, dm.product_code, dm.product_name, dm.note,
              dm.license_no,
              dm.sheet_min, dm.sheet_max, dm.steril_box_qty, dm.load_unit,
              u.full_name as verified_by_name, i.code as item_code, i.name as item_name,
              (select count(*)::int from dmr_operation o where o.device_master_id = dm.id) as op_count,
              (select count(*)::int from dmr_bom b
                 join dmr_operation o on o.id = b.operation_id
                where o.device_master_id = dm.id) as bom_count,
              (select count(*)::int from work_order w where w.device_master_id = dm.id) as wo_count,
              (dm.verified_at is not null and dm.status = 'ACTIVE' and dm.effective_from is not null
               and dm.effective_from <= (timezone('Asia/Seoul', now()))::date) as in_force
         from device_master dm
         join item i on i.id = dm.item_id
         left join app_user u on u.id = dm.verified_by
        order by i.code, dm.revision desc`);

    /*
     * 제품을 고르면 그 제품의 현행본(없으면 가장 나중 개정)을 연다. 개정을 직접
     * 고른 주소(?dm=)가 있으면 그것이 이긴다 - 공정 · 자재 링크가 그 주소로 돌아온다.
     */
    const byDm = masters.find((m) => m.id === dmParam);
    const productKey = byDm ? keyOf(byDm)
      : (productParam && masters.some((m) => keyOf(m) === productParam) ? productParam
        : masters[0] ? keyOf(masters[0]) : null);
    const productRevs = masters.filter((m) => keyOf(m) === productKey);
    const selected = byDm?.id ?? currentOf(productRevs)?.id ?? productRevs[0]?.id ?? null;

    const operations = selected
      ? await db.rows<OperationRow>(
          `select o.id, o.seq, o.code, o.name, o.after_cutting, o.typical_day,
                  o.takes_rework,
                  coalesce((
                    select json_agg(json_build_object(
                      'id', b.id, 'component_item_id', b.component_item_id,
                      'item_code', ci.code, 'item_name', ci.name, 'usage_uom', ci.usage_uom,
                      'basis', b.basis::text, 'qty_per_unit', b.qty_per_unit,
                      'tiers', coalesce((
                        select json_agg(json_build_object(
                          'id', tr.id, 'min_sheets', tr.min_sheets,
                          'max_sheets', tr.max_sheets, 'qty', tr.qty, 'qty_max', tr.qty_max)
                          order by tr.min_sheets)
                          from dmr_bom_tier tr where tr.dmr_bom_id = b.id), '[]'::json)
                    ) order by ci.code)
                      from dmr_bom b join item ci on ci.id = b.component_item_id
                     where b.operation_id = o.id), '[]'::json) as bom
             from dmr_operation o
            where o.device_master_id = $1
            order by o.seq`, [selected])
      : [];

    return {
      masters, selected, operations,
      /* 공정마다 어느 설비가 걸렸는지. 펼친 공정에서 목록으로 골라 걸고 뗀다 */
      equipment: await db.rows<{ id: string; code: string; name: string }>(
        `select id, code, name from equipment where is_active order by code`),
      opEquip: selected
        ? await db.rows<{ operation_id: string; equipment_id: string }>(
            `select oe.operation_id, oe.equipment_id
               from operation_equipment oe
               join dmr_operation o on o.id = oe.operation_id
              where o.device_master_id = $1 and oe.is_active`, [selected])
        : [],
      /* 생산 수량 구간별 시료 수. 근거는 device_master 에 붙는다 */
      sampleTiers: selected
        ? await db.rows<SampleTier>(
            `select id, min_qty, max_qty, sample_qty from sample_plan
              where device_master_id = $1 order by min_qty`, [selected])
        : [],
      items: await db.rows<ItemOption>(
        `select id, code, name, usage_uom, type::text as type from item
          where is_active order by type, code`),
    };
  });

  const dm = d.masters.find((m) => m.id === d.selected) ?? null;

  /* 제품별 묶음 · 현행본 · 상태별 개수 (사용자 2026-11-11) */
  const products = [...new Set(d.masters.map(keyOf))].map((key) => {
    const revs = d.masters.filter((m) => keyOf(m) === key);
    const current = currentOf(revs);
    const counts = { past: 0, pending: 0, draft: 0 };
    for (const m of revs) {
      const k = revState(m, current?.id ?? null).key;
      if (k !== 'current') counts[k] += 1;
    }
    return { key, name: revs[0].product_name ?? revs[0].item_name, revs, current, counts };
  });
  const product = (dm ? products.find((p) => p.key === keyOf(dm)) : products[0]) ?? null;
  const verified = !!dm?.verified_at;
  const editable = !!dm && dm.wo_count === 0 && writable;

  return (
    <div className="space-y-6">
      {d.masters.length === 0 ? (
        <Panel>
          {/*
            * 다음 걸음을 적는다 (UI/UX 검수 2026-11-11). 설정 > 제품표준서에도 «제품 등록»
            * 이 생겨 두 화면 모두 오른쪽 위에서 제품 · 대표 형명 · 첫 개정을 한 번에 만든다.
            */}
          <Empty hint="오른쪽 위의 제품 등록에서 제품 코드 · 대표 형명 · 첫 개정을 한 번에 만듭니다. 이미 있는 완제품 형명에 붙이려면 제품표준서 개정 추가를 누릅니다."
                 action={fixes?.fin && <Unblock fix={fixes.fin} todo="완제품 형명 만들기" />}>
            등록된 제품표준서가 없습니다.
          </Empty>
        </Panel>
      ) : (
        <>
          {/*
            * 제품별로 묶는다 (사용자 2026-11-11 «DX2401 (2) / DX2402 (1) 이런 형태로»).
            * 전에는 모든 제품의 모든 개정이 카드 한 줄에 섞여, 제품이 늘면 어느 것이
            * 어느 제품의 현행본인지 카드를 하나씩 읽어야 했다. 숫자는 그 제품의 개정 수.
            */}
          <FilterBar items={products.map((p) => ({
            href: `${base}?p=${encodeURIComponent(p.key)}`,
            label: p.key, count: p.revs.length, on: p.key === product?.key,
          }))} />

          {product && (
            <Panel title="개정 이력"
                   note={<>
                     {product.name}
                     {' · '}현행 <b className="font-mono text-ink">{product.current?.revision ?? '없음'}</b>
                     {product.counts.past > 0 && <> · 지난 개정 {product.counts.past}</>}
                     {product.counts.pending > 0 && <> · 시행 전 {product.counts.pending}</>}
                     {product.counts.draft > 0 && <> · 작성 중 {product.counts.draft}</>}
                   </>}>
              {/*
                * 무엇이 현행본인지는 작업 지시 발행이 묻는 것과 같은 규칙으로 정한다
                * (0061 trg_wo_dmr_effective): 서면 대조 확인 · 발효(ACTIVE) · 시행일이
                * 오늘 이전. 그런 개정 가운데 가장 나중 것이 현행이고 그 앞은 지난 개정이다.
                * 개정 사유는 서면 제품표준서에서 옮긴 비고(note)다 - 시스템이 차이를 셈하지 않는다.
                */}
              <Table grow={5}>
                <thead>
                  <tr>
                    <Th>개정</Th>
                    <Th>상태</Th>
                    <Th>시행일</Th>
                    <Th>서면 대조 확인</Th>
                    <Th>개정 사유</Th>
                    <Th right>공정 · 자재</Th>
                    <Th right>발행</Th>
                  </tr>
                </thead>
                <tbody>
                  {product.revs.map((m) => {
                    const st = revState(m, product.current?.id ?? null);
                    return (
                      <RowLink key={m.id} href={`${base}?dm=${m.id}`}>
                        <IdCell id={m.revision}
                                sub={m.id === d.selected ? '보는 중' : undefined} />
                        <Td><Tag tone={st.tone}>{st.label}</Tag></Td>
                        <Td className="tnum">{m.effective_from ? fmtDate(m.effective_from) : '미정'}</Td>
                        <Td className="tnum">{m.verified_at ? fmtDate(m.verified_at) : ''}</Td>
                        <Td className="text-sm">{m.note ?? ''}</Td>
                        <Td right>{m.op_count} · {m.bom_count}</Td>
                        <Td right>{m.wo_count || ''}</Td>
                      </RowLink>
                    );
                  })}
                </tbody>
              </Table>
            </Panel>
          )}

          {dm && (
            <>
              <Panel title={`${dm.product_code ?? dm.item_code} ${dm.revision}`}
                     note={<>{dm.product_name ?? dm.item_name}
                       {dm.product_code && <> · 형명 <span className="font-mono">{dm.item_code}</span></>}</>}>
                <div className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="상태">
                    <Tag tone={dm.verified_at ? 'ok' : 'warn'}>
                      {dm.verified_at ? '대조 확인 완료' : '확인 전'}
                    </Tag>
                  </Field>
                  <Field label="시행일"><span className="tnum">{fmtDate(dm.effective_from)}</span></Field>
                  <Field label="대조 확인자">{dm.verified_by_name ?? ''}</Field>
                  <Field label="확인 일시">
                    <span className="tnum">{fmtDateTime(dm.verified_at)}</span>
                  </Field>
                </div>
                {/*
                  * 대조를 마친 개정을 고치면 무엇이 일어나는지 고치는 자리 위에 적는다
                  * (0134 · UI/UX 검수 2026-11-11). 대조 항목이 바뀌면 확인이 풀린다.
                  */}
                {writable && verified && (
                  <p className="border-t border-line bg-warn-bg px-4 py-2.5 text-xs leading-relaxed text-ink">
                    <b>서면 대조를 마친 개정입니다.</b> 제품 코드 · 제품명 · 예상 생산수량 · 정해 둔
                    시행일 · 공정 · 자재 · 장입 구간 · 설비를 고치면 대조 확인이 풀리고, 다시 대조해야
                    작업 지시를 낼 수 있습니다. 비고 · 장입 범위 · 시료 기준은 고쳐도 풀리지 않습니다.
                  </p>
                )}
                {/*
                  * 저장 단추가 줄마다 하나씩이다 (UI/UX 검수 2026-11-11). 줄마다 저장하는 값이
                  * 다르고 대조가 풀리는 줄 · 안 풀리는 줄이 갈리므로 폼을 합치지 않는다. 대신
                  * 다섯 단추가 모두 «저장» 이라 어느 것이 무엇을 쓰는지 몰랐던 것을, 단추 글에
                  * 그 줄이 저장하는 것을 적어 가른다. 자리는 줄마다 칸 바로 뒤로 같다.
                  */}
                {writable && (
                  <>
                    <ProductCodeForm id={dm.id} code={dm.product_code}
                                     name={dm.product_name} itemCode={dm.item_code}
                                     license={dm.license_no} />
                    {dm.wo_count === 0 && (
                      <EffectiveFromForm id={dm.id} verified={verified}
                                         value={dm.effective_from ? String(dm.effective_from).slice(0, 10) : null} />
                    )}
                    <DmrNoteForm id={dm.id} note={dm.note} />
                    <DmrLimitsForm id={dm.id} sheetMin={dm.sheet_min}
                                   sheetMax={dm.sheet_max} boxQty={dm.steril_box_qty}
                                   loadUnit={dm.load_unit} />
                    <ExpectedUnitsForm id={dm.id} value={dm.expected_units} />
                    <SamplePlanForm id={dm.id} basis={dm.sample_basis}
                                    tiers={d.sampleTiers} />
                  </>
                )}
                {!editable && dm.wo_count > 0 && (
                  <p className="border-t border-line bg-canvas px-4 py-2.5 text-xs leading-relaxed text-muted">
                    이 개정으로 발행된 작업 지시가 {dm.wo_count}건 있어 공정과 자재 구성표를
                    더 이상 수정할 수 없습니다. 바꾸려면 새 개정을 만드십시오.
                  </p>
                )}
              </Panel>

              {/*
                * 대조는 제품당 한 번뿐이다. 그 한 번에 옮겨 적은 값을 항목별로
                * 짚게 하려면 화면이 가진 값을 그대로 넘겨야 한다 (사용자 요청).
                */}
              {writable && (
              <VerifyForm
                id={dm.id}
                verified={verified}
                sheet={{
                  productCode: dm.product_code, productName: dm.product_name,
                  itemCode: dm.item_code, revision: dm.revision,
                  effectiveFrom: fmtDate(dm.effective_from), expectedUnits: dm.expected_units,
                  operations: d.operations,
                  equipmentByOp: Object.fromEntries(d.operations.map((op) => [
                    op.id,
                    d.opEquip
                      .filter((x) => x.operation_id === op.id)
                      .map((x) => d.equipment.find((e) => e.id === x.equipment_id))
                      .filter((e) => !!e)
                      .map((e) => `${e!.code} ${e!.name}`),
                  ])),
                }}
              />
              )}

              {/*
                * 공정을 표로만 늘어놓으면 "이 제품이 어떻게 만들어지는가"가 안
                * 보인다. 흐름은 흐름으로 함께 보여 준다 (사용자 요청). 넓은
                * 화면에서는 나란히, 좁으면 공정도가 아래로 내려간다.
                */}
              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Panel
                title="공정 순서"
                note="제품 로트 단위 공정은 기록이 제품 로트에 붙습니다"
              >
                {/*
                  * 공정이 없으면 흐름부터 넣는다. 하나씩 폼으로 열두 번 누르는
                  * 대신 흐름을 한 번에 적거나 다른 표준서에서 가져온다.
                  * 새 제품을 처음 등록하는 사람이 빠뜨리지 않게 하는 자리다.
                  */}
                {d.operations.length === 0 ? (
                  <OperationSetForm
                    dm={dm.id}
                    sources={d.masters
                      .filter((m) => m.id !== dm.id && m.op_count > 0)
                      .map((m) => ({
                        id: m.id,
                        label: `${m.product_code ?? m.item_code} ${m.revision}`,
                        op_count: m.op_count,
                      }))}
                  />
                ) : (
                  <div>
                    {d.operations.map((op) => (
                      <OperationCard key={op.id} dm={dm.id} op={op}
                                     items={d.items} editable={editable} rangeable={writable}
                                     bomFix={fixes?.material}
                                     equipment={d.equipment.map((e) => ({
                                       ...e,
                                       linked: d.opEquip.some((x) =>
                                         x.operation_id === op.id && x.equipment_id === e.id),
                                     }))} />
                    ))}
                  </div>
                )}
                {editable && (
                  <AddOperationForm dm={dm.id} nextSeq={(d.operations.at(-1)?.seq ?? 0) + 1} />
                )}
                {/*
                  * 공정이 서면 자재 구성표를 한 번에 넣는다. 한 줄씩 열 몇 번
                  * 누르는 대신이고, 공정 흐름 적기와 같은 자리에 둔다.
                  */}
                {editable && d.operations.length > 0 && (
                  <BomSetForm dm={dm.id} opCodes={d.operations.map((o) => o.code)} />
                )}
              </Panel>

              {d.operations.length > 0 && (
                <Panel title="제조 공정도" note="갈라지는 공정에서 형명별로 나뉩니다">
                  <FlowDiagram
                    operations={d.operations}
                    equipmentByOp={new Map(d.operations.map((op) => [
                      op.id,
                      d.opEquip
                        .filter((x) => x.operation_id === op.id)
                        .map((x) => d.equipment.find((e) => e.id === x.equipment_id)?.code)
                        .filter((c): c is string => !!c),
                    ]))}
                  />
                </Panel>
              )}
              </div>

              <section className="card py-4">
                <h3 className="text-xs font-semibold text-ink">소요량 기준</h3>
                <dl className="mt-2 space-y-1.5 text-xs leading-relaxed">
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 font-semibold text-ink">장입 구간 기준</dt>
                    <dd className="text-muted">
                      통 · 포처럼 정해진 단위로 소모되어 투입량에 비례하지 않는 자재.
                      구간별 고정량을 넣습니다. 구간이 겹치면 등록이 거부됩니다.
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 font-semibold text-ink">제품 개수 기준</dt>
                    <dd className="text-muted">포장재 · 라벨처럼 제품 1개당 비례하는 자재.</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 font-semibold text-ink">원재료는 넣지 않는다</dt>
                    <dd className="text-muted">
                      작업 지시에 이미 지정되어 있습니다. 자재 구성표에 입력하면 S05가 이중으로 걸립니다.
                    </dd>
                  </div>
                </dl>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
