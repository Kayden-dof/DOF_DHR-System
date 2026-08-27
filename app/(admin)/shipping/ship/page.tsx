import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { SHIPPING_NAV } from '../../sections';
import { fmtDate } from '@/lib/fmt';
import { Panel, Empty, Tag } from '@/components/ui';
import { ShipList, type PlOpt } from '../shipping-forms';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '출고' };

interface ShipRow {
  id: string; customer_name: string; qty: number; shipped_at: string;
  lot_no: string; item_code: string; item_name: string;
  batch_no: string; shipped_by_name: string;
  release_request_no: string | null;
}

export default async function ShipPage() {
  const user = await requireUser();

  const d = await withActor(user.id, async (db) => ({
    lots: await db.rows<PlOpt>(
      `select pl.id, pl.lot_no, i.code as item_code, i.name as item_name,
              pl.qty_available, pl.qty_sample, wo.batch_no, pl.status::text as status,
              pl.expiry_date, pl.manufactured_on,
              pl.release_approved_by, pl.release_approved_on::text as release_approved_on,
              coalesce((select sum(sh.qty)::int from shipment sh
                         where sh.product_lot_id = pl.id), 0) as shipped,
              /* 다음에 내보낼 첫 개체 순번. 시료 다음부터 세고 나간 범위는 건너뛴다 */
              next_unit_seq(pl.id) as next_unit
         from product_lot pl
         join item i on i.id = pl.item_id
         join work_order wo on wo.id = pl.work_order_id
        where pl.release_approved_by is not null and pl.qty_available > 0
        order by pl.expiry_date, pl.lot_no`),
    shipments: await db.rows<ShipRow>(
      `select sh.release_request_no, sh.id, sh.customer_name, sh.qty, sh.shipped_at::text as shipped_at,
              sh.unit_from, sh.unit_to,
              pl.lot_no, i.code as item_code, i.name as item_name,
              wo.batch_no, u.full_name as shipped_by_name
         from shipment sh
         join product_lot pl on pl.id = sh.product_lot_id
         join item i on i.id = pl.item_id
         join work_order wo on wo.id = pl.work_order_id
         join app_user u on u.id = sh.shipped_by
        order by sh.shipped_at desc, sh.id desc limit 100`),
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
  }));

  return (
    <PageShell
      section="출하"
      title="출고"
      lede="출하 승인이 기록된 제품 로트만 출고할 수 있습니다. 출하 가능 수량을 넘길 수 없습니다."
      nav={<SubNav items={SHIPPING_NAV} />}
    >

      <Panel title="출고 가능" note="유효기한이 이른 것부터">
        {d.lots.length === 0 ? (
          <Empty>
            출고할 수 있는 제품 로트가 없습니다. 출하 승인을 먼저 기록하십시오.
          </Empty>
        ) : (
          <ShipList lots={d.lots} today={d.today ?? ''} />
        )}
      </Panel>

      <Panel title="출고 이력">
        {d.shipments.length === 0 ? (
          <Empty>출고 기록이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">출고일</th>
                  <th className="th">거래처</th>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th">배치</th>
                  <th className="th">승인서 번호</th>
                  <th className="th text-right">수량</th>
                  <th className="th">기록자</th>
                </tr>
              </thead>
              <tbody>
                {d.shipments.map((s) => (
                  <tr key={s.id}>
                    <td className="td tnum text-xs">{fmtDate(s.shipped_at)}</td>
                    <td className="td text-sm">{s.customer_name}</td>
                    <td className="td font-mono text-xs font-semibold">{s.lot_no}</td>
                    <td className="td text-sm">{s.item_name}</td>
                    <td className="td font-mono text-xs text-muted">{s.batch_no}</td>
                    <td className="td font-mono text-xs">
                      {s.release_request_no ?? <span className="text-faint">-</span>}
                    </td>
                    <td className="td tnum text-right font-semibold">{s.qty}</td>
                    <td className="td text-xs text-muted">{s.shipped_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
