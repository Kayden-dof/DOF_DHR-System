import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { logPrint } from '@/lib/print';
import { chunkByWeight } from '@/lib/print-pages';
import PrintFrame, { Sheet, SignRow } from '@/components/print-frame';

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
  planned_units: number | null;
  product_code: string | null; product_name: string | null;
  issued_at: Date; item_code: string; item_name: string;
  raw_lot_no: string; thickness_band: string | null; raw_item_code: string;
  supplier_name: string; supplier_lot_no: string; coa_no: string; coa_date: string;
  prod_name: string; qa_name: string; device_master_id: string;
}
interface OpRow {
  seq: number; code: string; name: string; after_cutting: boolean;
  typical_day: number | null;
  materials: { item_code: string; item_name: string; usage_uom: string;
               basis: string; required: string | null }[];
  /** 공정에 걸린 설비. 소요량 표의 설비 열에 만료일과 함께 찍힌다 */
  equipment: { code: string; name: string; valid_until: string | null }[];
}

/*
 * 공정명과 "재단 이후" 를 한 칸에 늘어놓으면 칸이 좁을 때 "재단 이 / 후" 로
 * 갈라진다. 딸린 말이니 아래 줄로 내리고 작게 둔다. 이름이 먼저 읽히고,
 * 재단 전후는 그 아래에서 한 덩어리로 남는다.
 */
function opName(o: { name: string; after_cutting: boolean }) {
  return (
    <>
      {o.name}
      {o.after_cutting && (
        <div className="nb text-[10px]">재단 이후</div>
      )}
    </>
  );
}


/* 공정 표. 장이 여럿일 때 이어지는 장이 같은 표를 그린다 (§10 복제는 갈라진다) */
function OpTable({ rows, title, today, units }: {
  rows: OpRow[]; title: string; today?: string | null; units: number;
}) {
  return (
      <>
        <h2 className="mt-5 text-sm font-bold text-black">{title}</h2>
        <table className="print-table mt-1.5">
          <thead>
            <tr>
              <th className="w-[5%] text-center">순번</th>
              <th className="w-[5%] text-center">일차</th>
              <th className="w-[16%]">공정 코드</th>
              <th className="w-[17%]">공정명</th>
              <th className="w-[23%]">자재</th>
              <th className="w-[11%] text-right">소요량</th>
              <th className="w-[23%]">설비 · 밸리데이션 만료</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const rows = o.materials.length || 1;

              /* 공정 한 묶음에 한 번만 찍는 설비 칸. 여러 대면 줄로 쌓인다 */
              const equipCell = (
                <td rowSpan={rows} className={o.equipment.length === 0 ? 'text-center' : undefined}>
                  {o.equipment.length === 0 ? (
                    '-'
                  ) : (
                    o.equipment.map((q) => {
                      const gone = !q.valid_until || (today != null && q.valid_until < today);
                      return (
                        <div key={q.code} className={gone ? 'font-bold' : undefined}>
                          <span className="font-mono font-bold">{q.code}</span>{' '}
                          <span className="nb tnum">
                            {q.valid_until
                              ? <>~{fmtDate(q.valid_until)}{gone && ' 기한 경과'}</>
                              : '밸리데이션 기록 없음'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </td>
              );

              return o.materials.length === 0 ? (
                <tr key={o.seq}>
                  <td className="text-center tnum">{o.seq}</td>
                  <td className="text-center tnum">{o.typical_day ?? ''}</td>
                  <td className="font-mono">{o.code}</td>
                  <td>{opName(o)}</td>
                  <td className="text-center">-</td>
                  <td />
                  {equipCell}
                </tr>
              ) : (
                o.materials.map((m, i) => (
                  <tr key={`${o.seq}-${m.item_code}`}>
                    {i === 0 && (
                      <>
                        <td rowSpan={rows} className="text-center tnum">{o.seq}</td>
                        <td rowSpan={rows} className="text-center tnum">{o.typical_day ?? ''}</td>
                        <td rowSpan={rows} className="font-mono">{o.code}</td>
                        <td rowSpan={rows}>{opName(o)}</td>
                      </>
                    )}
                    <td>{m.item_name} ({m.item_code})</td>
                    <td className="text-right tnum">
                      {/*
                        * 제품 개수 기준 자재는 예정 수량이 있어야 셈이 선다.
                        * 예정을 안 적고 발행하면 units 가 0 이라 "0 EA" 가 찍혔는데,
                        * 그건 "포장재를 쓰지 말라"는 말로 읽힌다. 모르는 것과 0 은
                        * 다르므로 모를 때는 모른다고 적는다.
                        */}
                      {m.required === null || (m.basis === 'PER_UNIT' && units === 0)
                        ? (m.basis === 'PER_UNIT' ? '재단 후 확정' : '구간 없음')
                        : `${Number(m.required)} ${m.usage_uom}`}
                    </td>
                    {i === 0 && equipCell}
                  </tr>
                ))
              );
            })}
          </tbody>
        </table>
    </>
  );
}

export default async function WorkOrderSheet({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const d = await withActor(user.id, async (db) => {
    const wo = await db.one<Wo>(
      `select wo.wo_no, wo.batch_no, wo.sheet_count, wo.dmr_revision, wo.issued_at,
              wo.planned_units,
              wo.device_master_id, i.code as item_code, i.name as item_name,
              dm.product_code, dm.product_name,
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
     * 예정 생산 개수. 포장재처럼 제품 개수에 비례하는 자재는 이 값이 있어야
     * 소요량을 미리 계산할 수 있다. 형명은 재단에서 정해지므로 적지 않는다.
     */
    const units = wo.planned_units ?? 0;

    return {
      wo,
      today: await db.val<string>(
        `select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD')`),
      ops: await db.rows<OpRow>(
        `select o.seq, o.code, o.name, o.after_cutting, o.typical_day,
                coalesce((
                  select json_agg(json_build_object(
                    'item_code', r.item_code, 'item_name', r.item_name,
                    'usage_uom', r.usage_uom, 'basis', r.basis::text,
                    'required', r.required) order by r.item_code)
                    from operation_requirements(o.id, $2, $3) r), '[]'::json) as materials,
                /*
                 * 공정에 걸린 설비와 밸리데이션 만료일. 발행 시점의 사실이
                 * 소요량 표의 설비 열에 함께 찍힌다. 기한이 지난 것이 있으면
                 * 착수 전에 이 종이에서 보인다 (사용자 지시). 막지는 않는다 (§2).
                 */
                coalesce((
                  select json_agg(json_build_object(
                    'code', e.code, 'name', e.name,
                    'valid_until', (select max(valid_until)::text
                                      from equipment_validation ev
                                     where ev.equipment_id = e.id))
                    order by e.code)
                    from operation_equipment oe
                    join equipment e on e.id = oe.equipment_id and e.is_active
                   where oe.operation_id = o.id and oe.is_active), '[]'::json) as equipment
           from dmr_operation o
          where o.device_master_id = $1 order by o.seq`,
        [wo.device_master_id, wo.sheet_count, units]),
    };
  });

  if (!d) notFound();
  const { wo, ops, today } = d;
  /* 예정 제품 개수. 0 이면 아직 정해지지 않은 것이지 0 개가 아니다 */
  const units = wo.planned_units ?? 0;

  /* -------------------------------------------------------------------------
     필요 용기 수 (§7)

     전에는 장입 구간 기준 자재의 소요량을 **그냥 다 더했다.** 단위가 다른데
     더했다.

       NaCl 2 kg + 알칼리 2 통 + H2O2 2 통 + 에탄올 2 L + 파우치 4 EA = "12 개"

     현장은 이 숫자를 보고 용기를 꺼낸다. 실제 통은 넷인데 종이가 열둘이라고
     말했다. 조건이 없다. 모든 배치에서 틀렸다 (4차 감사 2026-09-02).

     단위별로 가른다. 서로 더할 수 있는 것만 더한다.
  ------------------------------------------------------------------------- */
  const containers = ops.flatMap((o) =>
    o.materials.filter((m) => m.basis === 'SHEET_TIER' && m.required !== null));

  const byUom = new Map<string, number>();
  for (const m of containers) {
    byUom.set(m.usage_uom, (byUom.get(m.usage_uom) ?? 0) + Number(m.required));
  }
  /* 많이 쓰는 단위부터. 같으면 이름순이라 종이가 배치마다 달라지지 않는다 */
  const containerParts = [...byUom.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([uom, n]) => `${n} ${uom}`);

  /* -------------------------------------------------------------------------
     장을 우리가 가른다 (4차 감사 B2)

     pages 를 넘기지 않아 N 이 1 로 고정이었다. 공정 12개에 자재 줄이 붙고
     안내 문단과 서명란이 이어지면 한 장에 들어가지 않는다. 그러면 **서명란이
     실린 둘째 장이 배치번호도 자료 식별자도 쪽 번호도 없이 편철된다.**

     공정 표는 자재 수만큼 rowSpan 이 걸려 있어 줄 가운데를 자르면 표가
     깨진다. 공정 단위로 담되 그 공정이 차지하는 줄 수를 무게로 삼는다.
  ------------------------------------------------------------------------- */
  const opPages = chunkByWeight(ops, (o) => Math.max(1, o.materials.length), 9, 16);

  const meta = await logPrint({
    actorId: user.id, actorName: user.full_name, kind: 'WORK_ORDER',
    workOrderId: id,
    payload: { wo, ops },
    pages: opPages.length,
  });

  return (
    <PrintFrame
      meta={meta}
      title="작업 지시서"
      subtitle={<>배치 {wo.batch_no} · 지시서 {wo.wo_no}</>}
      back={`/production/${id}`}
      after={opPages.slice(1).map((rows, k) => (
        <Sheet key={k} meta={meta} page={k + 2}
               title="작업 지시서"
               subtitle={<>배치 {wo.batch_no} · 지시서 {wo.wo_no} · 이어짐</>}>
          <OpTable rows={rows} title="공정 순서 및 자재 소요량 (이어짐)" today={today} units={units} />
        </Sheet>
      ))}
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
            <td>
              {wo.product_name ?? wo.item_name}{' '}
              (<span className="font-mono">{wo.product_code ?? wo.item_code}</span>)
              {wo.product_code && (
                <span className="ml-2">형명 <span className="font-mono">{wo.item_code}</span></span>
              )}
            </td>
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
            <td className="tnum font-bold">
              {containerParts.length > 0 ? containerParts.join(' · ') : '해당 없음'}
            </td>
          </tr>
          <tr>
            <th>발행 일시</th>
            <td className="tnum">{fmtDate(wo.issued_at)}</td>
            <th>발행자</th>
            <td>생산 {wo.prod_name} / 품질 {wo.qa_name}</td>
          </tr>
        </tbody>
      </table>

      {/*
        * 예정 생산 수량.
        *
        * 형명은 적지 않는다. 재단에서 정해지므로 (§3 ①) 착수 전 종이에 형명을
        * 적으면 작업자가 재료가 허락하는 대로 자르는 대신 그 수에 맞추려 하게
        * 된다 (사용자 지적).
        *
        * 개수는 적는다. 포장재가 제품 1개당 기준이라 이 값이 없으면 위 표의
        * 소요량이 서지 않는다. 어디까지나 예정이고 실제는 재단에서 정해진다.
        */}
      {units > 0 && (
        <p className="mt-2 text-[10px] leading-relaxed text-black">
          위 표의 제품 개수 기준 자재는 <b>예정 생산 {units}개</b>로 계산했습니다.
          어떤 형명이 몇 개 나올지는 재단에서 정해지며, 실제와 달라도 시스템이
          보정하지 않습니다.
        </p>
      )}

      {/*
        * 설비는 따로 표를 세우지 않고 이 표의 열로 넣는다 (사용자 지시).
        * 공정 하나가 표에서 한 묶음이므로, 그 공정의 설비와 밸리데이션 만료일도
        * 같은 줄에서 읽히는 편이 종이에서 자연스럽다. 발행 시점의 사실이다.
        */}
      <OpTable rows={opPages[0]} title="공정 순서 및 자재 소요량" today={today} units={units} />

      <p className="mt-2 text-[10px] leading-relaxed text-black">
        일차는 보통 며칠째에 하는 공정인지를 적은 참고값입니다. 실제 작업 일차는
        현장이 정하며 이 표가 그것을 제약하지 않습니다.
        실제로 투입한 자재의 로트번호와 수량은 제조기록서에 기록되므로 이 표에
        따로 표시하지 않습니다.
        시약과 포장재의 로트번호는 이 지시서에 인쇄하지 않습니다. 착수 전에 확정되지 않으며,
        실제 투입 로트는 제조기록서에 기록합니다. 여기 적힌 소요량은 예정이며, 실제와 달라도
        시스템이 보정하지 않습니다.
      </p>

      <SignRow roles={['생산 책임자', '품질 책임자']} />
    </PrintFrame>
  );
}
