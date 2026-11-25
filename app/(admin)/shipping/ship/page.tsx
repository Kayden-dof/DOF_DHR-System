import { requireUser, blocksScreen } from '@/lib/session';
import { fixAt } from '@/lib/unblock';
import { Unblock } from '@/components/unblock';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { SHIPPING_NAV } from '../../sections';
import { fmtDate } from '@/lib/fmt';
import { PL_STATUS_LABEL } from '@/lib/forms';
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
  /** 그 로트의 멸균 보고서 번호 (0160) */
  report: string | null;
}

export default async function ShipPage() {
  const user = await requireUser();
  /* 열람자에게 열어 둔 화면이 아니다. 주소를 직접 쳐도 들어가지 못한다 */
  if (blocksScreen(user, '/shipping/ship')) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;


  const d = await withActor(user.id, async (db) => ({
    /*
     * 포장 이후 출하 가능 수량이 남은 로트 (0160 · 사용자 2026-11-25 «멸균 입고가 되면 멸균보고서를
     * 넣어야지만 출하가 가능»). 멸균 보고서(회수된 멸균 위탁의 번호)가 있으면 출고할 수 있고, 없으면
     * 아래 «멸균 보고서 대기» 에 무엇이 남았는지 보인다. 막는 자리는 DB 다 (shipment_needs_steril_report).
     */
    lots: await db.rows<PlOpt>(
      `select pl.id, pl.lot_no, i.code as item_code, i.name as item_name,
              pl.qty_available, pl.qty_sample, wo.batch_no, wo.id as wo_id, pl.status::text as status,
              pl.expiry_date, pl.manufactured_on,
              pl.release_approved_by, pl.release_approved_on::text as release_approved_on,
              coalesce((select sum(sh.qty)::int from shipment sh
                         where sh.product_lot_id = pl.id), 0) as shipped,
              lot_steril_report(pl.id) as report
         from product_lot pl
         join item i on i.id = pl.item_id
         join work_order wo on wo.id = pl.work_order_id
        where pl.qty_available > 0
          and pl.status in ('PACKED','STERILIZING','TESTED','RELEASE_APPROVED')
        order by pl.expiry_date, pl.lot_no`),
    shipments: await db.rows<ShipRow>(
      `select lot_steril_report(sh.product_lot_id) as report, sh.id, sh.customer_name, sh.qty,
              sh.shipped_at::text as shipped_at,
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

  const ready = d.lots.filter((l) => l.report);
  const waiting = d.lots.filter((l) => !l.report);

  return (
    <PageShell
      section="출하"
      title="출고"
      lede="멸균 보고서가 적힌 제품 로트만 출고할 수 있습니다. 출하 가능 수량을 넘길 수 없습니다."
      nav={<SubNav items={SHIPPING_NAV} />}
    >

      <Panel title="출고 가능" note="유효기한이 이른 것부터">
        {ready.length === 0 ? (
          <Empty hint="멸균 위탁에서 회수일과 멸균 보고서 번호를 적으면 여기 나옵니다."
                 action={<Unblock fix={fixAt(user, '/shipping/steril')} todo="멸균 위탁 보기" />}>
            출고할 수 있는 제품 로트가 없습니다.
          </Empty>
        ) : (
          <ShipList lots={ready} today={d.today ?? ''} />
        )}
      </Panel>

      {waiting.length > 0 && (
        <Panel title="멸균 보고서 대기" note="멸균 위탁에서 회수일과 멸균 보고서 번호를 적으면 출고할 수 있습니다">
          <div className="qd-table-scroll">
            <table className="qd-table qd-table--hangul" data-grow="2">
              <thead>
                <tr>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th">배치</th>
                  <th className="th text-right">출하 가능</th>
                  <th className="th">상태</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((l) => (
                  <tr key={l.id}>
                    <td className="td font-mono font-semibold">{l.lot_no}</td>
                    <td className="td">
                      <div className="text-sm">{l.item_name}</div>
                      <div className="font-mono text-xs text-faint">{l.item_code}</div>
                    </td>
                    <td className="td font-mono text-muted">{l.batch_no}</td>
                    <td className="td tnum text-right">{l.qty_available}</td>
                    <td className="td">
                      <Tag tone="quiet">{PL_STATUS_LABEL[l.status] ?? l.status}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="출고 이력">
        {d.shipments.length === 0 ? (
          <Empty hint="위에서 거래처와 수량을 적어 출고하면 여기 남습니다.">
            출고 기록이 없습니다.
          </Empty>
        ) : (
          <div className="qd-table-scroll">
            <table className="qd-table qd-table--hangul" data-grow="4">
              <thead>
                <tr>
                  <th className="th">출고일</th>
                  <th className="th">거래처</th>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th">배치</th>
                  <th className="th">멸균 보고서</th>
                  <th className="th text-right">수량</th>
                  <th className="th">기록자</th>
                </tr>
              </thead>
              <tbody>
                {d.shipments.map((s) => (
                  <tr key={s.id}>
                    <td className="td tnum ">{fmtDate(s.shipped_at)}</td>
                    <td className="td text-sm">{s.customer_name}</td>
                    <td className="td font-mono font-semibold">{s.lot_no}</td>
                    <td className="td text-sm">{s.item_name}</td>
                    <td className="td font-mono text-muted">{s.batch_no}</td>
                    <td className="td font-mono ">
                      {s.report ?? <span className="text-faint">-</span>}
                    </td>
                    <td className="td tnum text-right font-semibold">{s.qty}</td>
                    <td className="td text-muted">{s.shipped_by_name}</td>
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
