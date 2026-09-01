import React from 'react';
import { requireUser, hasRole } from '@/lib/session';
import Link from 'next/link';
import { withUser } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import Denied from '@/components/denied';
import { Panel, Empty } from '@/components/ui';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { TRACE_NAV } from '../../sections';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '원가' };

/* ---------------------------------------------------------------------------
   원가 (§9 M4 "제품 원가와 자재 지출이 분리 산출")

   두 가지는 다른 물건이다. 한 화면에 두되 절대 합치지 않는다.
     제품 원가  제품 로트에 실제로 들어간 자재의 매입가. 폐기분은 넣지 않는다 (§10)
     자재 지출  기간에 사들인 자재 금액. 어디에 쓰였는지와 무관하다
--------------------------------------------------------------------------- */

interface BatchCost {
  work_order_id: string; batch_no: string;
  raw_cost: string; pre_cut_cost: string; post_cut_cost: string;
  /* 공수 · 설비 (0076) */
  pre_cut_labour: string; pre_cut_equip: string;
  post_cut_labour: string; post_cut_equip: string;
  /* 무엇이 빠졌는가 */
  untimed_records: number; no_rate_records: number; no_equip_cost: number;
  status: string; issued_at: Date; lot_count: number;
}
interface LotCost {
  product_lot_id: string; lot_no: string; item_code: string; item_name: string;
  qty_produced: number; shared_cost: string; own_cost: string; batch_no: string;
  shared_conv_cost: string; own_conv_cost: string;
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

  const d = await withUser(user, async (db) => ({
    batches: await db.rows<BatchCost>(
      `select bc.*, wo.status::text as status, wo.issued_at,
              (select count(*)::int from product_lot pl
                where pl.work_order_id = wo.id) as lot_count
         from v_batch_cost bc
         join work_order wo on wo.id = bc.work_order_id
        order by wo.issued_at desc limit 50`),
    lots: await db.rows<LotCost>(
      `select c.product_lot_id, pl.lot_no, i.code as item_code, i.name as item_name,
              c.qty_produced, c.shared_cost, c.own_cost,
              c.shared_conv_cost, c.own_conv_cost, wo.batch_no
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
      lede={
        <>
          <b className="text-ink">제품 원가</b>는 들어간 자재의 매입가에 공수와 설비
          감가상각을 더한 값입니다. 폐기분과 전기 · 멸균 위탁비는 아직 들어 있지
          않습니다. <b className="text-ink">자재 지출</b>은 기간에 사들인 금액이며
          어디에 쓰였는지와 무관합니다.
        </>
      }
      nav={<SubNav items={TRACE_NAV} />}
    >

      {/*
        * 무엇이 빠졌는지 먼저 말한다 (0076).
        *
        * 시각이 없는 기록은 0 시간이고, 단가가 없는 역할은 0원이고, 상각 정보가
        * 없는 설비는 0원이다. 그 셋이 있으면 아래 숫자는 실제보다 적다. 조용히
        * 빼면 적게 나온 줄 모른다.
        *
        * 빠진 것이 없으면 아무것도 적지 않는다 - "이상 없음" 을 쓰지 않는
        * §8.5 와 같은 규율이다.
        */}
      {(() => {
        const untimed = d.batches.reduce((a, b) => a + b.untimed_records, 0);
        const noRate  = d.batches.reduce((a, b) => a + b.no_rate_records, 0);
        const noEquip = d.batches.reduce((a, b) => a + b.no_equip_cost, 0);
        if (!untimed && !noRate && !noEquip) return null;
        return (
          <div className="card border-warn/40 bg-warn-bg p-4">
            <h3 className="text-xs font-bold text-ink">아래 숫자에서 빠진 것</h3>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-ink">
              {untimed > 0 && (
                <li>
                  · 시작 · 종료 시각이 비어 있는 기록 <b className="tnum">{untimed}</b>건.
                  그 기록은 0시간으로 잡혀 공수와 설비 몫이 얹히지 않습니다.
                </li>
              )}
              {noRate > 0 && (
                <li>
                  · 그 날짜에 공수 단가가 없는 기록 <b className="tnum">{noRate}</b>건.{' '}
                  <Link href="/settings/users" className="underline">설정 · 사용자</Link>
                  에서 역할별 단가를 넣습니다.
                </li>
              )}
              {noEquip > 0 && (
                <li>
                  · 취득원가 · 내용연수 · 기준 월 가동시간이 비어 있는 설비{' '}
                  <b className="tnum">{noEquip}</b>대.{' '}
                  <Link href="/equipment" className="underline">설비</Link>
                  에서 넣습니다.
                </li>
              )}
            </ul>
          </div>
        );
      })()}

      <Panel title="배치별 원가">
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
                  <th className="th text-right">공수</th>
                  <th className="th text-right">설비</th>
                  <th className="th text-right">합계</th>
                  <th className="th text-right">제품 로트</th>
                </tr>
              </thead>
              <tbody>
                {d.batches.map((b) => {
                  const mat = Number(b.raw_cost) + Number(b.pre_cut_cost) + Number(b.post_cut_cost);
                  const lab = Number(b.pre_cut_labour) + Number(b.post_cut_labour);
                  const eqp = Number(b.pre_cut_equip) + Number(b.post_cut_equip);
                  return (
                    <tr key={b.work_order_id}>
                      <td className="td font-mono text-xs font-semibold">{b.batch_no}</td>
                      <td className="td tnum text-xs text-muted">{fmtDate(b.issued_at)}</td>
                      <td className="td tnum text-right">{won(b.raw_cost)}</td>
                      <td className="td tnum text-right">{won(b.pre_cut_cost)}</td>
                      <td className="td tnum text-right">{won(b.post_cut_cost)}</td>
                      <td className="td tnum text-right">{lab ? won(lab) : ''}</td>
                      <td className="td tnum text-right">{eqp ? won(eqp) : ''}</td>
                      <td className="td tnum text-right font-semibold">{won(mat + lab + eqp)}</td>
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
        note="배치 공통분은 생산 수량 비율로 배분합니다"
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
                  <th className="th text-right">공수 · 설비</th>
                  <th className="th text-right">합계</th>
                  <th className="th text-right">개당</th>
                </tr>
              </thead>
              <tbody>
                {d.lots.map((l) => {
                  const conv = Number(l.shared_conv_cost) + Number(l.own_conv_cost);
                  const sum = Number(l.shared_cost) + Number(l.own_cost) + conv;
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
                      <td className="td tnum text-right text-muted">{conv ? won(conv) : ''}</td>
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

      <Panel title="자재 지출" note="매입 기준">
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
