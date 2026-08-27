import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { SubNav } from '../nav';
import { SHIPPING_NAV } from '../sections';
import { fmtDate } from '@/lib/fmt';
import { PL_STATUS_LABEL } from '@/lib/forms';
import Link from 'next/link';
import { Panel, Empty, Tag } from '@/components/ui';
import { ApproveForm, RequestBuilder, type PlOpt } from './shipping-forms';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '출하' };

export default async function ReleasePage() {
  const user = await requireUser();

  const d = await withActor(user.id, async (db) => ({
    lots: await db.rows<PlOpt>(
      `select pl.id, pl.lot_no, i.code as item_code, i.name as item_name,
              pl.qty_available, wo.batch_no, wo.id as wo_id, pl.status::text as status,
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

  /*
   * 요청서 발행용 묶음. 배치에서 생산된 규격 중 미출고 잔여가 있는 것만
   * 배치별로 모은다. 요청은 배치 안에서 고르는 것이므로 화면도 그 단위다.
   */
  const groups: { wo_id: string; batch_no: string; item_name: string; lots: PlOpt[] }[] = [];
  for (const l of d.lots) {
    if (l.qty_available <= 0) continue;
    let g = groups.find((x) => x.wo_id === l.wo_id);
    if (!g) {
      g = { wo_id: l.wo_id, batch_no: l.batch_no, item_name: l.item_name, lots: [] };
      groups.push(g);
    }
    g.lots.push(l);
  }

  return (
    <PageShell
      section="출하"
      title="출하 승인"
      lede="요청서를 인쇄해 품질책임자의 서면 승인을 받고, 그 내용을 여기에 옮겨 기재합니다. 시스템은 판정하지 않습니다."
      nav={<SubNav items={SHIPPING_NAV} />}
    >

      <Panel
        title="요청서 발행"
        note="배치에서 생산된 규격 중 미출고 잔여를 선택해 발행합니다. 요청서 번호는 발행되는 순간 종이에 찍힙니다."
      >
        {groups.length === 0 ? (
          <Empty>요청할 잔여가 있는 제품 로트가 없습니다.</Empty>
        ) : (
          <RequestBuilder groups={groups} />
        )}
      </Panel>

      <Panel title="승인 기록" note="서면 요청서에 서명받은 내용을 옮겨 기재합니다. 유효기한이 이른 것부터.">
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
                  <th className="th" />
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
                    {/*
                      * 승인이 끝난 뒤에도 요청서는 다시 뽑을 일이 있다 - 편철에
                      * 끼우거나 서면 원본을 분실했을 때다. 2회차부터는 종이에
                      * 재발행 표시가 찍히므로 원본과 섞이지 않는다.
                      *
                      * 시연 자료가 전부 승인 완료 상태라, 이 링크가 없으면 요청서
                      * 인쇄가 화면 어디에도 보이지 않는 문제도 있었다.
                      */}
                    <td className="td text-right">
                      {l.qty_available > 0 && (
                        <Link
                          href={`/print/release-request/${l.wo_id}?sel=${l.id}:${l.qty_available}`}
                          className="btn-ghost h-8 px-3 text-xs"
                        >
                          요청서
                        </Link>
                      )}
                    </td>
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
