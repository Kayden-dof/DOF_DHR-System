import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { logPrint, printGate, viewParam } from '@/lib/print';
import Denied from '@/components/denied';
import PrintFrame, { PrintBar } from '@/components/print-frame';
import Barcode from '@/components/barcode';
import { getBrand } from '@/lib/brand';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   자재 라벨 (§7)
   입고 등록 시점 · 자재 로트 단위
   로트번호 바코드, 품목명, 수량, 유효기한, 성적서 번호

   바코드 값은 사내 로트번호 그대로다 (§4.4). 스캔하면 그 로트가 바로 잡힌다.

   ── 종이가 두 가지다 (0114 · 사용자 지시 2026-09-15) ──────────────────────
   `?stock=label` 로 열면 **라벨 용지 크기**로 나온다. 그 크기는 설정에서 오고
   (§2.0), 설정이 비어 있으면 이 갈래는 열리지 않는다 - 아무 치수나 기본으로
   넣어 두면 그 값이 코드에 박힌 치수와 같아진다.

   담기는 값은 두 갈래가 같다. 그래서 **자료 식별자도 같다** - 같은 자료가 같은
   값을 낸다는 규율이 여기서도 선다 (§7). 회차만 오른다. 같은 내용을 종이를
   바꿔 한 번 더 뽑은 것이고, 실제로 종이 두 장이 나갔으니 대장에 두 줄이
   남는 것이 맞다.
--------------------------------------------------------------------------- */

interface Lot {
  lot_no: string; item_code: string; item_name: string; usage_uom: string;
  qty_received: string; qty_available: string; coa_no: string; coa_date: string;
  expiry_date: string | null; received_at: Date; location: string | null;
  supplier_name: string; supplier_lot_no: string; thickness_band: string | null;
}

export default async function MaterialLabel({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; stock?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const view = viewParam(sp.view);
  const stock = sp.stock === 'label';
  const { denied } = await printGate(!!view);
  if (denied) {
    return (
      <Denied what="발행" need="생산관리자 또는 시스템관리자">
        인쇄물을 뽑으면 인쇄 기록이 남고 제조기록서는 그 묶음이 잠깁니다.
        이미 나간 종이를 보려면 인쇄 이력의 <b>보기</b>로 여십시오.
      </Denied>
    );
  }
  const user = await requireUser();
  const brand = await getBrand();
  const w = brand.labelWidthMm;
  const h = brand.labelHeightMm;

  /*
   * 라벨 용지 크기가 없으면 **대장에 아무것도 남기지 않고** 돌아선다.
   *
   * 여는 것이 곧 발행이므로(§7.1), 그릴 수 없는 종이를 여는 것만으로 회차가
   * 오르면 앞 종이가 까닭 없이 회수 대상이 된다.
   */
  if (stock && (!w || !h)) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="text-lg font-bold text-ink">라벨 용지 크기가 설정되지 않았습니다</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          라벨 전용 프린터로 뽑으려면 먼저 용지 크기를 넣어야 합니다.
          넣기 전까지 자재 라벨은 A4 로만 나갑니다.
        </p>
        <div className="mt-4 flex gap-2">
          <Link href="/settings/brand" className="btn-primary h-9 px-4 text-sm">
            설정 · 회사 표시로 가기
          </Link>
          <Link href={`/print/label/${id}`} className="btn-ghost h-9 px-4 text-sm">
            A4 로 뽑기
          </Link>
        </div>
      </div>
    );
  }

  const lot = await withActor(user.id, (db) =>
    db.one<Lot>(
      `select ml.lot_no, i.code as item_code, i.name as item_name, i.usage_uom,
              ml.qty_received, ml.qty_available, ml.coa_no, ml.coa_date,
              ml.expiry_date, ml.received_at, ml.location, ml.thickness_band,
              s.name as supplier_name, ml.supplier_lot_no
         from material_lot ml
         join item i on i.id = ml.item_id
         join supplier s on s.id = ml.supplier_id
        where ml.id = $1`, [id]));

  if (!lot) notFound();

  const meta = await logPrint({
    view,
    actorId: user.id, actorName: user.full_name, kind: 'LABEL',
    materialLotId: id, payload: lot,
  });

  /* ---------------------------------------------------------------------
     라벨 용지
  --------------------------------------------------------------------- */
  if (stock) {
    const short = meta.dataHash.slice(0, 12);
    return (
      <>
        {/*
          * 쪽 설정을 여기서 덮는다. globals.css 가 A4 로 못 박아 두었고
          * (`@page { size: A4 portrait }`), 그것이 일곱 양식을 전부 정한다.
          * 이 줄이 뒤에 오므로 이 화면에서만 이긴다.
          */}
        <style>{`
          @page { size: ${w}mm ${h}mm; margin: 3mm; }
          @media print {
            html, body { background: #fff; }
            .no-print { display: none !important; }
            .label-stock { border: 0; margin: 0; box-shadow: none; }
          }
          .label-stock {
            width: ${w! - 6}mm;
            min-height: ${h! - 6}mm;
            display: flex;
            flex-direction: column;
            color: #000;
            background: #fff;
          }
        `}</style>

        <PrintBar back="/material" label="자재 라벨 · 라벨 용지" view={!!meta.view}
                  right={meta.view
                    ? <>{meta.seq}회차를 봅니다</>
                    : <>인쇄 회차 <b className="tnum text-ink">{meta.seq}</b>{
                        meta.seq > 1 && <span className="ml-1.5 font-bold text-warn">재발행</span>}</>} />

        <div className="flex justify-center p-6 print:p-0">
          <div data-sheet={1} className="label-stock border border-line p-2 text-[9px] shadow-sm print:shadow-none">
            <div className="flex items-baseline justify-between">
              <span className="truncate font-bold">{meta.companyName}</span>
              <span className="shrink-0">자재 라벨</span>
            </div>

            <div className="mt-1 text-center">
              <div className="font-mono text-lg font-bold leading-tight tracking-wider">
                {lot.lot_no}
              </div>
              {/*
                * 바코드는 **하나만** 둔다. 꼬리글의 자료 식별자는 글자로만 적는다 -
                * 한 장에 바코드가 둘이면 "어느 걸 찍지" 가 생기고 그것이 새 실수가
                * 된다 (현장 스캔 칸 주석). A4 에서는 둘이 멀리 떨어져 있지만
                * 라벨에서는 손가락 하나 거리다.
                */}
              <div className="mt-0.5 flex justify-center">
                <Barcode value={lot.lot_no} height={30} module={1} />
              </div>
            </div>

            <table className="mt-1 w-full border-collapse">
              <tbody className="[&_td]:border [&_td]:border-black/60 [&_td]:px-1 [&_td]:py-[1px]
                                [&_th]:border [&_th]:border-black/60 [&_th]:bg-black/[0.04]
                                [&_th]:px-1 [&_th]:py-[1px] [&_th]:text-left [&_th]:font-normal">
                <tr>
                  <th className="w-[18%]">품목</th>
                  <td colSpan={3} className="font-bold">
                    {lot.item_name} <span className="font-mono">({lot.item_code})</span>
                  </td>
                </tr>
                <tr>
                  <th>수량</th>
                  <td className="w-[30%] tnum font-bold">
                    {Number(lot.qty_received)} {lot.usage_uom}
                  </td>
                  <th className="w-[20%]">유효기한</th>
                  <td className="tnum font-bold">
                    {lot.expiry_date ? fmtDate(lot.expiry_date) : '해당 없음'}
                  </td>
                </tr>
                <tr>
                  <th>성적서</th>
                  <td className="font-mono font-bold">{lot.coa_no}</td>
                  <th>입고일</th>
                  <td className="tnum">{fmtDate(lot.received_at)}</td>
                </tr>
                <tr>
                  <th>공급자</th>
                  <td colSpan={3}>
                    {lot.supplier_name}
                    <span className="ml-1 font-mono">{lot.supplier_lot_no}</span>
                    {lot.thickness_band && (
                      <span className="ml-2 font-bold">두께 {lot.thickness_band}</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>

            {/*
              * §7 이 모든 인쇄물에 요구하는 다섯 - 인쇄 일시 · 인쇄자 · 회차 ·
              * 자료 식별자 · 쪽 번호. 라벨이라고 빼지 않는다. 다만 회사 소재지
              * 한 줄은 넣지 않는다 - 이 종이는 제조소 안에 붙어 있다가 자재와
              * 함께 소모된다.
              *
              * 이름표와 값을 dt·dd 로 짝지어 둔다. 인쇄 충실성 시험이 대장의
              * 회차·식별자·인쇄자를 **그 이름표 바로 뒤 칸**과 견주기 때문이다 -
              * 글자만 늘어놓으면 그 대조가 성립하지 않는다 (§8.2).
              */}
            <div className="mt-auto border-t border-black pt-0.5 text-[7px] leading-tight">
              <div className="flex items-end justify-between gap-2">
                <dl className="flex flex-wrap gap-x-2 gap-y-0
                               [&>dd]:inline [&>dd]:font-bold [&>dt]:inline [&>dt]:text-black/70">
                  <div>
                    <dt>자료 식별자</dt>{' '}
                    <dd className="font-mono">{short}</dd>
                  </div>
                  <div>
                    <dt>인쇄 회차</dt>{' '}
                    <dd className="tnum">{meta.seq}</dd>
                    {meta.seq > 1 && <b> · 재발행본</b>}
                  </div>
                  <div>
                    <dt>인쇄자</dt>{' '}
                    <dd>{meta.printedBy}</dd>
                  </div>
                  <div>
                    <dt>인쇄 일시</dt>{' '}
                    <dd className="tnum">{meta.printedAt}</dd>
                  </div>
                </dl>
                <div className="tnum shrink-0">1 / 1</div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ---------------------------------------------------------------------
     A4
  --------------------------------------------------------------------- */
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
              <th>입고 수량</th>
              <td className="w-[28%] tnum text-base font-bold">
                {Number(lot.qty_received)} {lot.usage_uom}
              </td>
              <th className="w-[22%]">유효기한</th>
              <td className="tnum text-base font-bold">
                {lot.expiry_date ? fmtDate(lot.expiry_date) : '해당 없음'}
              </td>
            </tr>
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
