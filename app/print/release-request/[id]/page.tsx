import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { logPrint } from '@/lib/print';
import PrintFrame from '@/components/print-frame';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   출하 승인 요청서 (§7)

   출하 전 · 배치 안에서 고른 제품 로트 묶음 단위.

   처음에는 로트 하나에 잔여 전량을 자동으로 실어 발행했는데, 실제 업무는
   배치에서 생산된 규격들을 보고 미출고 잔여 중 무엇을 몇 개 요청할지 골라서
   품질책임자에게 가져간다 (사용자 지시 2026-08-27). 화면에서 고른 선택이
   이 주소의 sel 에 실려 오고, 그 내용 그대로 한 장에 발행된다.

   요청서 번호는 RR-{배치번호}-{발행회차} 다. 인쇄 회차가 배치·양식별로
   원자적으로 증가하므로 별도 채번 없이 유일하다. 출고를 기록할 때 이 번호를
   옮겨 적어, 어느 종이로 승인된 출고인지가 이어진다.

   판정란은 비워서 인쇄한다. 시스템은 판정하지 않는다 (§1).
--------------------------------------------------------------------------- */

interface Head {
  batch_no: string; wo_no: string; item_name: string; raw_lot_no: string;
}

interface Row {
  id: string; lot_no: string; item_code: string; item_name: string;
  qty_produced: number; qty_sample: number; qty_available: number;
  manufactured_on: string; expiry_date: string;
  shipped: number; steril_cert: string | null;
}

function spec(code: string): string {
  const m = code.match(/^PD(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return '';
  const mm = (s: string) => (Number(s) / 10).toFixed(1);
  return `${mm(m[1])}x${mm(m[2])}cm · ${mm(m[3])}~${mm(m[4])}mm`;
}

/** sel=로트id:수량,로트id:수량 를 푼다. 형식이 어긋난 조각은 버린다. */
function parseSel(sel: string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of (sel ?? '').split(',')) {
    const m = part.match(/^([0-9a-f-]{36}):(\d+)$/);
    if (m && Number(m[2]) > 0) out.set(m[1], Number(m[2]));
  }
  return out;
}

export default async function ReleaseRequestSheet({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sel?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sel = parseSel((await searchParams).sel);
  if (sel.size === 0) notFound();

  const d = await withActor(user.id, async (db) => {
    const head = await db.one<Head>(
      `select wo.batch_no, wo.wo_no, i.name as item_name, ml.lot_no as raw_lot_no
         from work_order wo
         join device_master dm on dm.id = wo.device_master_id
         join item i on i.id = dm.item_id
         join material_lot ml on ml.id = wo.material_lot_id
        where wo.id = $1`, [id]);
    if (!head) return null;

    // 이 배치의 로트만 받는다. 다른 배치 로트가 섞여 들어오면 조용히 떨어진다
    const rows = await db.rows<Row>(
      `select pl.id, pl.lot_no, i.code as item_code, i.name as item_name,
              pl.qty_produced, pl.qty_sample, pl.qty_available,
              pl.manufactured_on, pl.expiry_date,
              coalesce((select sum(sh.qty)::int from shipment sh
                         where sh.product_lot_id = pl.id), 0) as shipped,
              (select sb.cert_no from steril_batch_lot sbl
                 join steril_batch sb on sb.id = sbl.steril_batch_id
                where sbl.product_lot_id = pl.id and sb.cert_no is not null
                order by sb.received_at desc limit 1) as steril_cert
         from product_lot pl
         join item i on i.id = pl.item_id
        where pl.work_order_id = $1 and pl.id = any($2::uuid[])
        order by i.code`, [id, [...sel.keys()]]);
    return { head, rows };
  });

  if (!d || d.rows.length === 0) notFound();
  const { head, rows } = d;
  const total = rows.reduce((a, r) => a + (sel.get(r.id) ?? 0), 0);

  const meta = await logPrint({
    actorId: user.id, actorName: user.full_name, kind: 'RELEASE_REQUEST',
    workOrderId: id,
    payload: { head, rows: rows.map((r) => ({ lot: r.lot_no, qty: sel.get(r.id) })) },
  });

  /*
   * 요청서 번호. 회차가 이 발행에서 막 정해졌으므로 여기서 조합한다.
   * 출고 기록 화면이 같은 형식을 안내한다.
   */
  const requestNo = `RR-${head.batch_no}-${String(meta.seq).padStart(2, '0')}`;

  return (
    <PrintFrame
      meta={meta}
      title="출하 승인 요청서"
      subtitle={<>요청서 번호 <b className="font-mono">{requestNo}</b> · 배치 {head.batch_no}</>}
      back="/shipping"
    >
      <table className="print-table">
        <tbody>
          <tr>
            <th className="w-[18%]">요청서 번호</th>
            <td className="w-[32%] font-mono text-base font-bold">{requestNo}</td>
            <th className="w-[18%]">배치번호</th>
            <td className="w-[32%] font-mono font-bold">{head.batch_no}</td>
          </tr>
          <tr>
            <th>제품명</th>
            <td className="font-bold">{head.item_name}</td>
            <th>지시서번호</th>
            <td className="font-mono">{head.wo_no}</td>
          </tr>
          <tr>
            <th>원재료 로트</th>
            <td className="font-mono">{head.raw_lot_no}</td>
            <th>요청 로트 수</th>
            <td className="tnum">{rows.length}건 · 합계 {total}개</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-5 text-sm font-bold text-black">요청 내용</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[15%]">제조번호</th>
            <th className="w-[21%]">모델명 · 규격</th>
            <th className="w-[10%]">제조일</th>
            <th className="w-[10%]">유효기한</th>
            <th className="w-[8%] text-right">생산</th>
            <th className="w-[8%] text-right">기출고</th>
            <th className="w-[8%] text-right">잔여</th>
            <th className="w-[9%] text-right">요청 수량</th>
            <th className="w-[11%]">멸균 성적서</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="font-mono font-bold">{r.lot_no}</td>
              <td>
                <div className="font-mono font-bold">{r.item_code}</div>
                <div className="text-[10px]">{spec(r.item_code)}</div>
              </td>
              <td className="tnum">{fmtDate(r.manufactured_on)}</td>
              <td className="tnum font-bold">{fmtDate(r.expiry_date)}</td>
              <td className="text-right tnum">{r.qty_produced}</td>
              <td className="text-right tnum">{r.shipped || ''}</td>
              <td className="text-right tnum">{r.qty_available}</td>
              <td className="text-right tnum text-base font-bold">{sel.get(r.id)}</td>
              <td className="font-mono text-[10px]">{r.steril_cert ?? ''}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={7} className="text-right font-bold">요청 합계</td>
            <td className="text-right tnum text-base font-bold">{total}</td>
            <td />
          </tr>
        </tbody>
      </table>

      <h2 className="mt-6 text-sm font-bold text-black">품질책임자 판정</h2>
      <table className="print-table mt-1.5">
        <thead>
          <tr>
            <th className="w-[25%]">판정</th>
            <th className="w-[25%]">판정 일자</th>
            <th className="w-[25%]">품질책임자 성명</th>
            <th className="w-[25%]">서명</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sign-box" />
            <td className="sign-box" />
            <td className="sign-box" />
            <td className="sign-box" />
          </tr>
        </tbody>
      </table>

      <p className="mt-2 text-[10px] leading-relaxed text-black">
        판정란은 비워서 발행합니다. 시스템은 적합 여부를 판정하지 않으며 전자서명을 받지
        않습니다. 승인된 내용은 관리자가 시스템에 옮겨 적고, 출고를 기록할 때 이 요청서
        번호를 함께 기재합니다.
      </p>
    </PrintFrame>
  );
}
