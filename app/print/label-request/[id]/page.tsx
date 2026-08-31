import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { logPrint } from '@/lib/print';
import PrintFrame, { SignRow } from '@/components/print-frame';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   라벨요청서 (§7)
   재단 후 · 배치 단위
   제품명, 제조번호, 모델명, 규격, 수량 (WS-07 작업 5번)
--------------------------------------------------------------------------- */

interface Head {
  batch_no: string; wo_no: string; item_name: string; thickness_band: string | null;
  product_code: string | null; product_name: string | null;
}
interface LotRow {
  lot_no: string; item_code: string; item_name: string;
  qty_produced: number; qty_sample: number; qty_available: number;
  manufactured_on: string; expiry_date: string; spec: string; shelf_basis: string;
}

/*
 * 규격 문구는 DB 의 spec_label() 하나에서만 만든다 (0057).
 *
 * 전에는 이 파일과 출하 승인 요청서가 각자 같은 함수를 복제해 두었고, 둘 다
 * 크기 자리까지 10 으로 나눠 10x15cm 제품을 "1.0 x 1.5 cm" 로 찍고 있었다.
 * 라벨 업체가 이 종이를 보고 라벨을 찍는다 (3차 검수 결함 1).
 *
 * 복제는 언젠가 갈라진다. 실제로 두 곳의 띄어쓰기가 이미 갈라져 있었다.
 */

export default async function LabelRequestSheet({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const d = await withActor(user.id, async (db) => {
    const head = await db.one<Head>(
      `select wo.batch_no, wo.wo_no, i.name as item_name, ml.thickness_band,
              dm.product_code, dm.product_name
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
         join material_lot ml on ml.id = wo.material_lot_id
        where wo.id = $1`, [id]);
    if (!head) return null;
    return {
      head,
      lots: await db.rows<LotRow>(
        `select pl.lot_no, i.code as item_code, i.name as item_name,
                pl.qty_produced, pl.qty_sample, pl.qty_available,
                pl.manufactured_on, pl.expiry_date, spec_label(i.code) as spec,
                shelf_life_basis(pl.shelf_life_ref, pl.item_id) as shelf_basis
           from product_lot pl join item i on i.id = pl.item_id
          where pl.work_order_id = $1 order by i.code`, [id]),
    };
  });

  if (!d || d.lots.length === 0) notFound();
  const { head, lots } = d;

  const meta = await logPrint({
    actorId: user.id, actorName: user.full_name, kind: 'LABEL_REQUEST',
    workOrderId: id, payload: { head, lots },
  });

  return (
    <PrintFrame
      meta={meta}
      title="라벨요청서"
      subtitle={<>배치 {head.batch_no}</>}
      back={`/production/${id}`}
    >
      <table className="print-table">
        <tbody>
          <tr>
            <th className="w-[15%]">배치번호</th>
            <td className="w-[35%] font-mono font-bold">{head.batch_no}</td>
            <th className="w-[15%]">지시서번호</th>
            <td className="w-[35%] font-mono">{head.wo_no}</td>
          </tr>
          <tr>
            {/*
              * 이 요청서는 배치 하나의 여러 형명을 함께 담는다. 머리글에 대표
              * 형명을 적으면 아래 표의 다른 형명과 어긋나 보인다. 여기는 최상위
              * 제품 코드 자리다 (DX2401). 형명은 줄마다 따로 적힌다.
              */}
            <th>제품</th>
            <td>
              {head.product_code
                ? <><b className="font-mono">{head.product_code}</b>
                    {head.product_name && <> · {head.product_name}</>}</>
                : head.item_name}
            </td>
            <th>두께 구간</th>
            <td>{head.thickness_band ?? ''}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-5 text-sm font-bold text-black">요청 내역</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[18%]">제조번호</th>
            <th className="w-[18%]">모델명</th>
            <th className="w-[26%]">규격</th>
            <th className="w-[10%] text-right">생산</th>
            <th className="w-[10%] text-right">샘플</th>
            <th className="w-[18%] text-right">라벨 수량</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((l) => (
            <tr key={l.lot_no}>
              <td className="font-mono font-bold">{l.lot_no}</td>
              <td className="font-mono">{l.item_code}</td>
              <td>{l.spec}</td>
              <td className="text-right tnum">{l.qty_produced}</td>
              <td className="text-right tnum">{l.qty_sample || ''}</td>
              <td className="text-right tnum font-bold">{l.qty_produced}</td>
            </tr>
          ))}
          <tr>
            <th colSpan={5} className="text-right">합계</th>
            <td className="text-right tnum font-bold">
              {lots.reduce((s, l) => s + l.qty_produced, 0)}
            </td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-5 text-sm font-bold text-black">라벨 표기 내용</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[16%]">제조번호</th>
            <th className="w-[28%]">제품명 / 모델명</th>
            <th className="w-[24%]">개체 번호</th>
            <th className="w-[16%]">제조일</th>
            <th className="w-[16%]">유효기한</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((l) => (
            <tr key={l.lot_no}>
              <td className="font-mono font-bold">{l.lot_no}</td>
              <td>{l.item_name}<div className="font-mono text-[9px]">{l.item_code}</div></td>
              {/*
                * 라벨은 개체마다 다른 번호를 답니다. 한 장씩 무엇을 찍을지
                * 알아야 하므로 번호를 범위로 적는다.
                */}
              <td className="font-mono">
                {l.lot_no}-{String(1).padStart(3, '0')}
                {' ~ '}
                {l.lot_no}-{String(l.qty_produced).padStart(3, '0')}
              </td>
              <td className="tnum">{fmtDate(l.manufactured_on)}</td>
              <td className="tnum">{fmtDate(l.expiry_date)}
                <div className="text-[9px] leading-tight">{l.shelf_basis}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-[10px] leading-relaxed text-black">
        라벨은 개체마다 다른 번호를 답니다. 제조번호 뒤에 001 부터 생산 수량까지
        세 자리로 붙이며, 앞 번호부터 완제품검사 시료로 빠집니다.
        유효기한은 제조번호를 부여한 시점의 사용기간으로 확정된 값입니다. 이후 사용기간이
        바뀌어도 이 로트에는 소급되지 않습니다.
      </p>

      <SignRow roles={['요청자', '확인자']} />
    </PrintFrame>
  );
}
