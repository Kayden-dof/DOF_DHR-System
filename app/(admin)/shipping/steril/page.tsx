import { requireUser, blocksReadOnly } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { SHIPPING_NAV } from '../../sections';
import { Panel, Empty } from '@/components/ui';
import { SterilForm, SterilRow, type PlOpt, type SbRow } from '../shipping-forms';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '멸균 위탁' };

export default async function SterilPage() {
  const user = await requireUser();
  /* 열람자에게 열어 둔 화면이 아니다. 주소를 직접 쳐도 들어가지 못한다 */
  if (blocksReadOnly(user)) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;


  const d = await withActor(user.id, async (db) => ({
    lots: await db.rows<PlOpt>(
      `select pl.id, pl.lot_no, i.code as item_code, i.name as item_name,
              pl.qty_available, wo.batch_no, pl.status::text as status,
              pl.expiry_date, pl.manufactured_on,
              pl.release_approved_by, pl.release_approved_on::text as release_approved_on,
              0 as shipped
         from product_lot pl
         join item i on i.id = pl.item_id
         join work_order wo on wo.id = pl.work_order_id
        where pl.status = 'PACKED' and pl.qty_available > 0
        order by pl.manufactured_on, pl.lot_no`),
    batches: await db.rows<SbRow>(
      `select sb.id, sb.batch_no, sb.request_no, sb.vendor_name,
              sb.shipped_at::text as shipped_at, sb.received_at::text as received_at,
              sb.cert_no,
              coalesce((
                select json_agg(json_build_object(
                  'lot_no', pl.lot_no, 'item_code', i.code,
                  'item_name', i.name, 'qty', sbl.qty)
                  order by pl.lot_no)
                  from steril_batch_lot sbl
                  join product_lot pl on pl.id = sbl.product_lot_id
                  join item i on i.id = pl.item_id
                 where sbl.steril_batch_id = sb.id), '[]'::json) as lots,
              coalesce((select sum(sbl.qty)::int from steril_batch_lot sbl
                         where sbl.steril_batch_id = sb.id), 0) as total
         from steril_batch sb
        order by sb.shipped_at desc nulls first, sb.batch_no desc
        limit 100`),
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
    /*
     * 박스 수량은 제품표준서가 정한다 (0069). 그런데 **어느 제품표준서인가**
     * 를 전역으로 골랐다 (6차 감사 N4) - 제품이 둘이면 한쪽 값이 다른 쪽
     * 로트에도 쓰인다.
     *
     * 보낼 수 있는 로트들이 실제로 어느 값을 갖는지 세어 본다. 하나로
     * 모이면 그 값을 쓰고, 갈리면 지어내지 않고 세지 않는다.
     */
    boxQtys: await db.rows<{ qty: number }>(
      `select distinct dm.steril_box_qty as qty
         from product_lot pl
         join work_order wo on wo.id = pl.work_order_id
         join device_master dm on dm.id = wo.device_master_id
        where dm.steril_box_qty is not null
          and pl.status in ('PACKED','STERILIZING')`),
  }));

  return (
    <PageShell
      section="출하"
      title="멸균 위탁"
      /*
       * 박스 수량을 여기 적지 않는다 (5차 감사 B3).
       *
       * 전에는 "50개(25ea 2줄)" 이 박혀 있었다. 바로 아래 SterilForm 은 같은
       * 값을 제품표준서에서 읽어(0069) 없으면 "박스 수는 세지 않습니다" 라고
       * 말하는데, 그 폼 위에서 안내문은 50이라고 단언하고 있었다. 같은 화면의
       * 두 곳이 서로 다른 출처를 쓰면 갈라진다 (§10).
       *
       * 50은 DX2401 의 값이지 프로그램의 성질이 아니다.
       */
      lede={(d.boxQtys.length === 1
              ? `${Number(d.boxQtys[0].qty)}개 박스 단위로 발송합니다. `
              : '박스 단위로 발송합니다. ')
            + '한 박스에 여러 제품 로트가 들어갈 수 있습니다.'}
      action={<SterilForm lots={d.lots} today={d.today ?? ''}
                          boxQty={d.boxQtys.length === 1 ? Number(d.boxQtys[0].qty) : null} />}
      nav={<SubNav items={SHIPPING_NAV} />}
    >

      <Panel>
        {d.batches.length === 0 ? (
          <Empty>멸균 배치가 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">멸균 배치</th>
                  <th className="th">위탁 업체</th>
                  <th className="th">의뢰서</th>
                  <th className="th">동봉 로트</th>
                  <th className="th text-right">수량</th>
                  <th className="th">발송일</th>
                  <th className="th">회수일</th>
                  <th className="th">성적서</th>
                  <th className="th">단계</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {d.batches.map((sb) => (
                  <SterilRow key={sb.id} sb={sb} today={d.today ?? ''} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <section className="card p-4">
        <h3 className="text-xs font-bold text-ink">이 화면이 하는 일과 하지 않는 일</h3>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>· 발송·회수 시점과 성적서 번호를 기록합니다.</li>
          <li>· 발송하면 제품 로트가 멸균 중으로, 회수하면 멸균 회수로 넘어갑니다.</li>
          <li>
            · <b className="text-ink">적합 여부는 판정하지 않습니다.</b> 서면 멸균 성적서로
            판정하며, 시스템은 그 번호를 붙들어 두는 역할만 합니다.
          </li>
          <li>
            · 파괴검사용 2개는 재단 시 샘플 수량에 이미 반영되어 있어 출하 가능 수량에서
            빠져 있습니다. 회수되어도 복귀하지 않습니다.
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
