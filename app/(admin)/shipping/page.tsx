import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { PL_STATUS_LABEL } from '@/lib/forms';
import { PageHead, Panel, Empty, Tag } from '@/components/ui';
import { ApproveForm, type PlOpt } from './shipping-forms';

export const dynamic = 'force-dynamic';

export default async function ReleasePage() {
  const user = await requireUser();

  const d = await withActor(user.id, async (db) => ({
    lots: await db.rows<PlOpt>(
      `select pl.id, pl.lot_no, i.code as item_code, i.name as item_name,
              pl.qty_available, wo.batch_no, pl.status::text as status,
              pl.expiry_date, pl.manufactured_on,
              pl.release_approved_by, pl.release_approved_on::text as release_approved_on,
              coalesce((select sum(sh.qty)::int from shipment sh
                         where sh.product_lot_id = pl.id), 0) as shipped
         from product_lot pl
         join item i on i.id = pl.item_id
         join work_order wo on wo.id = pl.work_order_id
        where pl.status in ('PACKED','STERILIZING','TESTED','RELEASE_APPROVED')
        order by (pl.release_approved_by is not null), pl.expiry_date, pl.lot_no`),
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
  }));

  const pending = d.lots.filter((l) => !l.release_approved_by);
  const approved = d.lots.filter((l) => l.release_approved_by);

  return (
    <div className="space-y-5">
      <PageHead
        title="출하 승인"
        note="요청서를 인쇄해 품질책임자의 서면 승인을 받고, 그 내용을 여기에 옮겨 적습니다. 시스템은 판정하지 않습니다."
      />

      <Panel title="승인 대기" note="유효기한이 이른 것부터">
        {pending.length === 0 ? (
          <Empty>승인을 기다리는 제품 로트가 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th">배치</th>
                  <th className="th text-right">출하 가능</th>
                  <th className="th">제조일</th>
                  <th className="th">유효기한</th>
                  <th className="th">상태</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {pending.map((l) => (
                  <tr key={l.id}>
                    <td className="td font-mono text-xs font-semibold">{l.lot_no}</td>
                    <td className="td">
                      <div className="text-sm">{l.item_name}</div>
                      <div className="font-mono text-xs text-faint">{l.item_code}</div>
                    </td>
                    <td className="td font-mono text-xs text-muted">{l.batch_no}</td>
                    <td className="td tnum text-right font-semibold">{l.qty_available}</td>
                    <td className="td tnum text-xs">{fmtDate(l.manufactured_on)}</td>
                    <td className="td tnum text-xs">{fmtDate(l.expiry_date)}</td>
                    <td className="td">
                      <Tag tone={l.status === 'TESTED' ? 'ok' : 'quiet'}>
                        {PL_STATUS_LABEL[l.status] ?? l.status}
                      </Tag>
                    </td>
                    <td className="td">
                      <ApproveForm lot={l} today={d.today ?? ''} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="승인 완료">
        {approved.length === 0 ? (
          <Empty>승인된 제품 로트가 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th text-right">출하 가능</th>
                  <th className="th text-right">기출고</th>
                  <th className="th">유효기한</th>
                  <th className="th">품질책임자</th>
                  <th className="th">승인일</th>
                </tr>
              </thead>
              <tbody>
                {approved.map((l) => (
                  <tr key={l.id}>
                    <td className="td font-mono text-xs font-semibold">{l.lot_no}</td>
                    <td className="td text-sm">{l.item_name}</td>
                    <td className="td tnum text-right font-semibold">{l.qty_available}</td>
                    <td className="td tnum text-right text-muted">{l.shipped || ''}</td>
                    <td className="td tnum text-xs">{fmtDate(l.expiry_date)}</td>
                    <td className="td text-sm">{l.release_approved_by}</td>
                    <td className="td tnum text-xs text-muted">
                      {fmtDate(l.release_approved_on)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
