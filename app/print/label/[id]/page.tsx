import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { logPrint, printGate, viewParam } from '@/lib/print';
import Denied from '@/components/denied';
import PrintFrame from '@/components/print-frame';
import Barcode from '@/components/barcode';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   자재 라벨 (§7)
   입고 등록 시점 · 자재 로트 단위
   로트번호 바코드, 품목명, 수량, 유효기한, 성적서 번호

   바코드 값은 사내 로트번호 그대로다 (§4.4). 스캔하면 그 로트가 바로 잡힌다.

   사내에서 만든 원액도 같은 라벨이다. 성적서 · 공급자 자리에는 제조일과 원료 종
   수가 들어간다. 원액을 용기에 담을 때 관리번호와 유효기한을 적어 붙이는 것이
   이 라벨이다.

   ── 종이는 A4 하나다 (사용자 결정 2026-09-15) ────────────────────────────
   한때 라벨 용지 크기를 설정에서 받아 그 크기로 뽑는 갈래를 함께 냈다가
   걷었다 (0114 → 0115). **모든 인쇄물은 A4 규격이 기준이다** (§7).

   종이를 두 가지로 두면 "이 라벨은 어느 종이로 나갔나" 가 새 물음이 된다.
   대장에는 그 구분이 남지 않고 - 담긴 값이 같아 자료 식별자도 같다 - 손에
   든 종이만으로는 가릴 수 없다. 기준이 하나면 그 물음이 생기지 않는다.

   라벨 전용 프린터를 쓰고 싶으면 A4 라벨(스티커) 용지에 뽑아 떼어 붙인다.
--------------------------------------------------------------------------- */

interface Lot {
  lot_no: string; item_code: string; item_name: string; usage_uom: string;
  qty_received: string; qty_available: string;
  /* 사내 제조 원액은 성적서 · 공급자 칸이 비어 있다. 제조일(made_on)이 있으면 원액이다 */
  coa_no: string | null; coa_date: string | null;
  expiry_date: string | null; received_at: Date; location: string | null;
  supplier_name: string | null; supplier_lot_no: string | null; thickness_band: string | null;
  made_on: string | null;
  /** 원액의 원료 품목 수. 입고 로트는 0 */
  input_kinds: number;
}

export default async function MaterialLabel({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const view = viewParam((await searchParams).view);
  const { denied } = await printGate(!!view);
  if (denied) {
    return (
      <Denied what="인쇄물" need="생산관리자 · 시스템관리자 또는 품질책임자">
        이미 나간 종이는 인쇄 이력의 <b>보기</b>로 여십시오.
      </Denied>
    );
  }
  const user = await requireUser();

  /*
   * 공급자는 바깥 결합이다. 사내 제조 원액은 공급자가 없어서(material_lot_source)
   * 안쪽 결합이면 라벨이 열리지 않는다.
   *
   * 원료 종 수는 v_solution_input 에서 센다 - 되돌려 순량이 0 이 된 원료는 이미
   * 거기서 빠져 있다. 입고 로트는 그 뷰에 줄이 없으므로 0 이고 쓰이지 않는다.
   */
  const lot = await withActor(user.id, (db) =>
    db.one<Lot>(
      `select ml.lot_no, i.code as item_code, i.name as item_name, i.usage_uom,
              ml.qty_received, ml.qty_available, ml.coa_no, ml.coa_date,
              ml.expiry_date, ml.received_at, ml.location, ml.thickness_band,
              s.name as supplier_name, ml.supplier_lot_no,
              ml.made_on,
              (select count(distinct v.item_code)::int
                 from v_solution_input v where v.solution_lot_id = ml.id) as input_kinds
         from material_lot ml
         join item i on i.id = ml.item_id
         left join supplier s on s.id = ml.supplier_id
        where ml.id = $1`, [id]));

  if (!lot) notFound();

  /*
   * 자료 식별자에 들어가는 값.
   *
   * 원액은 조회 결과가 그대로 들어간다 - 제조일과 원료 종 수도 종이에 찍히는
   * 값이므로 식별자가 그것을 담아야 한다.
   *
   * 입고 로트는 새 두 칸을 뺀다. 이미 나간 라벨의 식별자는 그 전의 칸으로
   * 만들어졌고, 칸이 늘면 같은 로트인데도 열람이 "자료가 바뀌었다" 고 말한다.
   * 바뀐 것은 없다.
   */
  const payload = lot.made_on
    ? lot
    : Object.fromEntries(
        Object.entries(lot).filter(([k]) => k !== 'made_on' && k !== 'input_kinds'));

  const meta = await logPrint({
    view,
    /* 여는 것은 미리보기다. 회차는 인쇄 단추가 올린다 (2026-09-16) */
    preview: !view,
    actorId: user.id, actorName: user.full_name, kind: 'LABEL',
    materialLotId: id, payload,
  });

  return (
    <PrintFrame
      meta={meta}
      title="자재 라벨"
      subtitle={<>{lot.item_name}</>}
      back="/material"
    >
      <div className="border-2 border-black p-4">
        <div className="text-center">
          <div className="text-xs font-bold text-black">사내 로트번호</div>
          <div className="mt-1 font-mono text-3xl font-bold tracking-wider text-black">
            {lot.lot_no}
          </div>
          <div className="mt-2 flex justify-center">
            <Barcode value={lot.lot_no} />
          </div>
        </div>

        <table className="print-table mt-4">
          <tbody>
            <tr>
              <th className="w-[22%]">품목</th>
              <td colSpan={3} className="text-base font-bold">
                {lot.item_name}
                <span className="ml-2 font-mono text-xs">({lot.item_code})</span>
              </td>
            </tr>
            <tr>
              <th>{lot.made_on ? '제조량' : '입고 수량'}</th>
              <td className="w-[28%] tnum text-base font-bold">
                {Number(lot.qty_received)} {lot.usage_uom}
              </td>
              <th className="w-[22%]">유효기한</th>
              <td className="tnum text-base font-bold">
                {lot.expiry_date ? fmtDate(lot.expiry_date) : '해당 없음'}
              </td>
            </tr>
            {lot.made_on ? (
              <>
                {/*
                  * 사내에서 만든 원액이다. 성적서도 공급자도 없고, 그 자리에 어디서
                  * 언제 무엇으로 만들었는지를 적는다 (용기에 붙이는 관리번호 라벨).
                  */}
                <tr>
                  <th>출처</th>
                  <td colSpan={3} className="font-bold">
                    {`사내 제조 · 제조일 ${fmtDate(lot.made_on)} · 원료 ${lot.input_kinds}종`}
                  </td>
                </tr>
                <tr>
                  <th>보관 위치</th>
                  <td colSpan={3}>{lot.location ?? ''}</td>
                </tr>
              </>
            ) : (
              <>
                <tr>
                  <th>성적서 번호</th>
                  <td className="font-mono font-bold">{lot.coa_no}</td>
                  <th>성적서 일자</th>
                  <td className="tnum">{fmtDate(lot.coa_date)}</td>
                </tr>
                <tr>
                  <th>공급자</th>
                  <td>{lot.supplier_name}</td>
                  <th>공급자 로트</th>
                  <td className="font-mono">{lot.supplier_lot_no}</td>
                </tr>
                <tr>
                  <th>입고일</th>
                  <td className="tnum">{fmtDate(lot.received_at)}</td>
                  <th>보관 위치</th>
                  <td>{lot.location ?? ''}</td>
                </tr>
              </>
            )}
            {lot.thickness_band && (
              <tr>
                <th>두께 구간</th>
                <td colSpan={3} className="font-bold">{lot.thickness_band}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-black">
        바코드 값은 사내 로트번호입니다. 공정에서 자재를 투입할 때 이 라벨을 읽으면
        해당 로트가 그대로 기록됩니다.
      </p>
    </PrintFrame>
  );
}
