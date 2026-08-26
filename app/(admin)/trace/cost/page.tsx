import React from 'react';
import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import Denied from '@/components/denied';
import { PageHead, Panel, Empty } from '@/components/ui';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   원가 (§9 M4 "제품 원가와 자재 지출이 분리 산출")

   두 가지는 다른 물건이다. 한 화면에 두되 절대 합치지 않는다.
     제품 원가  제품 로트에 실제로 들어간 자재의 매입가. 폐기분은 넣지 않는다 (§10)
     자재 지출  기간에 사들인 자재 금액. 어디에 쓰였는지와 무관하다
--------------------------------------------------------------------------- */

interface BatchCost {
  work_order_id: string; batch_no: string;
  raw_cost: string; pre_cut_cost: string; post_cut_cost: string;
  status: string; issued_at: Date; lot_count: number;
}
interface LotCost {
  product_lot_id: string; lot_no: string; item_code: string; item_name: string;
  qty_produced: number; shared_cost: string; own_cost: string; batch_no: string;
}
interface Spend {
  month: string; item_code: string; item_name: string; type: string;
  qty: string; amount: string;
}

const won = (v: string | number) => Math.round(Number(v)).toLocaleString();

export default async function CostPage() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="원가 조회" need="생산관리자 또는 시스템관리자" />;
  }

  const d = await withActor(user.id, async (db) => ({
    batches: await db.rows<BatchCost>(
      `select bc.*, wo.status::text as status, wo.issued_at,
              (select count(*)::int from product_lot pl
                where pl.work_order_id = wo.id) as lot_count
         from v_batch_cost bc
         join work_order wo on wo.id = bc.work_order_id
        order by wo.issued_at desc limit 50`),
    lots: await db.rows<LotCost>(
      `select c.product_lot_id, pl.lot_no, i.code as item_code, i.name as item_name,
              c.qty_produced, c.shared_cost, c.own_cost, wo.batch_no
         from v_product_lot_cost c
         join product_lot pl on pl.id = c.product_lot_id
         join item i on i.id = c.item_id
         join work_order wo on wo.id = c.work_order_id
        order by wo.issued_at desc, i.code limit 100`),
    spend: await db.rows<Spend>(
      `select month::text as month, code as item_code, name as item_name,
              type::text as type, qty, amount
         from v_material_spend order by month desc, amount desc limit 100`),
  }));

  const spendByMonth = new Map<string, Spend[]>();
  for (const s of d.spend) spendByMonth.set(s.month, [...(spendByMonth.get(s.month) ?? []), s]);

  return (
    <PageShell
      section="조회"
      title="원가"
      lede="제품 원가는 실제로 들어간 자재의 매입가입니다. 자재 지출은 기간에 사들인 금액입니다. 두 값은 성격이 달라 합치지 않습니다."
      nav={
        <SubNav
          items={[
            { href: '/trace', label: '계보 추적' },
            { href: '/trace/verify', label: '인쇄물' },
            { href: '/trace/cost', label: '원가' },
          ]}
        />
      }
    >

      <PageHead
        title="원가"
        note={
          <>
            <b className="text-ink">제품 원가</b>는 실제로 들어간 자재의 매입가입니다.
            폐기분은 포함하지 않습니다. <b className="text-ink">자재 지출</b>은 기간에
            사들인 금액이며 어디에 쓰였는지와 무관합니다. 두 값은 성격이 다르므로 합치지 않습니다.
          </>
        }
      />

      <Panel title="배치별 자재 원가">
        {d.batches.length === 0 ? (
          <Empty>배치가 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">배치</th>
                  <th className="th">발행일</th>
                  <th className="th text-right">원재료</th>
                  <th className="th text-right">재단 전 공정</th>
                  <th className="th text-right">재단 후 공정</th>
                  <th className="th text-right">합계</th>
                  <th className="th text-right">제품 로트</th>
                </tr>
              </thead>
              <tbody>
                {d.batches.map((b) => {
                  const sum = Number(b.raw_cost) + Number(b.pre_cut_cost) + Number(b.post_cut_cost);
                  return (
                    <tr key={b.work_order_id}>
                      <td className="td font-mono text-xs font-semibold">{b.batch_no}</td>
                      <td className="td tnum text-xs text-muted">{fmtDate(b.issued_at)}</td>
                      <td className="td tnum text-right">{won(b.raw_cost)}</td>
                      <td className="td tnum text-right">{won(b.pre_cut_cost)}</td>
                      <td className="td tnum text-right">{won(b.post_cut_cost)}</td>
                      <td className="td tnum text-right font-semibold">{won(sum)}</td>
                      <td className="td tnum text-right text-muted">{b.lot_count || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="제품 로트별 원가"
        note="배치 공통분은 생산 수량 비율로 배분한다"
      >
        {d.lots.length === 0 ? (
          <Empty>제품 로트가 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">제조번호</th>
                  <th className="th">형명</th>
                  <th className="th">배치</th>
                  <th className="th text-right">생산 수량</th>
                  <th className="th text-right">배치 공통분</th>
                  <th className="th text-right">전용 자재</th>
                  <th className="th text-right">합계</th>
                  <th className="th text-right">개당</th>
                </tr>
              </thead>
              <tbody>
                {d.lots.map((l) => {
                  const sum = Number(l.shared_cost) + Number(l.own_cost);
                  return (
                    <tr key={l.product_lot_id}>
                      <td className="td font-mono text-xs font-semibold">{l.lot_no}</td>
                      <td className="td">
                        <div className="text-sm">{l.item_name}</div>
                        <div className="font-mono text-xs text-faint">{l.item_code}</div>
                      </td>
                      <td className="td font-mono text-xs text-muted">{l.batch_no}</td>
                      <td className="td tnum text-right">{l.qty_produced}</td>
                      <td className="td tnum text-right text-muted">{won(l.shared_cost)}</td>
                      <td className="td tnum text-right text-muted">{won(l.own_cost)}</td>
                      <td className="td tnum text-right font-semibold">{won(sum)}</td>
                      <td className="td tnum text-right">
                        {l.qty_produced ? won(sum / l.qty_produced) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="자재 지출" note="매입 기준. 제품 원가와 섞지 않는다">
        {d.spend.length === 0 ? (
          <Empty>입고 기록이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">월</th>
                  <th className="th">품목</th>
                  <th className="th text-right">수량</th>
                  <th className="th text-right">금액</th>
                </tr>
              </thead>
              <tbody>
                {[...spendByMonth.entries()].map(([month, rows]) => (
                  // 조각에도 키가 있어야 한다. 없으면 월이 늘었을 때 React가
                  // 행을 잘못 이어 붙여 다른 달 금액이 섞여 보인다.
                  <React.Fragment key={month}>
                    {rows.map((s, i) => (
                      <tr key={`${month}-${s.item_code}`}>
                        {i === 0 && (
                          <td className="td tnum align-top font-semibold" rowSpan={rows.length + 1}>
                            {month.slice(0, 7)}
                          </td>
                        )}
                        <td className="td">
                          <div className="text-sm">{s.item_name}</div>
                          <div className="font-mono text-xs text-faint">{s.item_code}</div>
                        </td>
                        <td className="td tnum text-right text-muted">{Number(s.qty)}</td>
                        <td className="td tnum text-right">{won(s.amount)}</td>
                      </tr>
                    ))}
                    <tr key={`${month}-sum`}>
                      <th className="th text-right" colSpan={2}>{month.slice(0, 7)} 합계</th>
                      <td className="td tnum text-right font-bold">
                        {won(rows.reduce((a, r) => a + Number(r.amount), 0))}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <section className="card p-4">
        <h3 className="text-xs font-bold text-ink">계산 방식</h3>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>
            · <b className="text-ink">원재료</b>는 로트 단가 x 장입 장수입니다.
          </li>
          <li>
            · <b className="text-ink">재단 전 공정 자재</b>는 배치 전체에 걸리므로 제품 로트에
            생산 수량 비율로 배분합니다.
          </li>
          <li>
            · <b className="text-ink">재단 후 공정 자재</b>는 제품 로트별로 이미 갈려 있어 그대로 붙습니다.
          </li>
          <li>
            · <b className="text-ink">폐기분은 제품 원가에 넣지 않습니다.</b> 재고 증감으로 빠진
            자재는 그 제품에 들어간 것이 아니기 때문입니다.
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
