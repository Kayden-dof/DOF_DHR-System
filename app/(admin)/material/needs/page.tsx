import Link from 'next/link';
import { requireUser, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { withUser } from '@/lib/db';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { MATERIAL_NAV } from '../../sections';
import { Panel, Empty, Tag } from '@/components/ui';
import { todayKST, daysUntilKST } from '@/lib/kst';

export const dynamic = 'force-dynamic';

export const metadata = { title: '소요 · 부족' };

const DAYS = [30, 60, 90];

interface ShortRow {
  item_id: string; item_code: string; item_name: string; item_type: string; usage_uom: string;
  band: string | null; need_qty: string | null; unknown: boolean; first_need_on: string | null;
  stock_qty: string; on_order_qty: string; next_expected_on: string | null;
  short_qty: string | null; lead_days: number | null; order_by: string | null;
}
interface NeedRow {
  item_id: string; band: string | null; need_on: string; qty: string | null;
  unit_known: boolean; source: string; source_id: string | null; source_label: string;
}

/* 두께 구간 코드를 사람이 읽는 말로. 0510 → 0.5~1.0mm */
function bandLabel(band: string | null) {
  if (!band) return '구간 미정';
  if (/^\d{4}$/.test(band)) {
    const a = Number(band.slice(0, 2)) / 10, b = Number(band.slice(2)) / 10;
    return `${a.toFixed(1)}~${b.toFixed(1)}mm`;
  }
  return band;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const qty = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const md = (d: string | null) => (d ? d.slice(5, 10) : '');

export default async function NeedsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireUser();
  /* 열람자에게 열어 둔 화면이 아니다. 주소를 직접 쳐도 들어가지 못한다 */
  if (blocksScreen(user, '/material/needs')) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;

  const sp = await searchParams;
  const asked = Number(sp.days);
  const days = DAYS.includes(asked) ? asked : 60;
  const from = todayKST();

  /* 한 트랜잭션에서 두 함수를 한 번씩만 읽는다 (줄마다 묻지 않는다) */
  const d = await withUser(user, async (db) => ({
    short: await db.rows<ShortRow>(
      `select * from material_shortage($1::date, $1::date + $2::int)
        order by item_type, item_code, band nulls last`, [from, days]),
    needs: await db.rows<NeedRow>(
      `select * from material_needs($1::date, $1::date + $2::int)
        order by need_on, source_label`, [from, days]),
  }));

  const byKey = new Map<string, NeedRow[]>();
  for (const n of d.needs) {
    const k = `${n.item_id}|${n.band ?? ''}`;
    byKey.set(k, [...(byKey.get(k) ?? []), n]);
  }

  return (
    <PageShell
      section="자재"
      title="소요 · 부족"
      lede="계획된 생산에 들어갈 자재를 재고와 발주중 수량에 견주어 보여 줍니다."
      action={
        <span className="inline-flex items-center gap-2 text-sm text-muted">
          오늘부터
          {DAYS.map((n) => (
            <Link key={n} href={`/material/needs?days=${n}`}
                  className={n === days ? 'qd-text-action font-semibold text-ink' : 'qd-text-action'}>
              {n}일
            </Link>
          ))}
        </span>
      }
      nav={<SubNav items={MATERIAL_NAV} />}
    >
      <Panel>
        {d.short.length === 0 ? (
          <Empty hint="일정에서 주문으로 계획을 올리면 여기에 자재 소요가 나타납니다.">
            앞으로 {days}일 안에 계획된 자재 소요가 없습니다.
          </Empty>
        ) : (
          <div className="qd-table-scroll">
            <table className="qd-table qd-table--hangul" data-grow="1">
              <thead>
                <tr>
                  <th className="th">품목</th>
                  <th className="th text-right">필요</th>
                  <th className="th">첫 필요일</th>
                  <th className="th text-right">재고</th>
                  <th className="th text-right">발주중(예정)</th>
                  <th className="th text-right">부족</th>
                  <th className="th">발주 마감</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {d.short.map((r) => {
                  const k = `${r.item_id}|${r.band ?? ''}`;
                  const src = byKey.get(k) ?? [];
                  const short = r.short_qty == null ? 0 : num(r.short_qty);
                  const solution = r.item_type === 'SOLUTION';
                  const left = daysUntilKST(r.order_by);
                  const tone = left == null ? '' : left < 0 ? 'text-danger' : left <= 7 ? 'text-warn' : '';
                  const onOrder = num(r.on_order_qty);
                  return (
                    <tr key={k}>
                      <td className="td">
                        <details>
                          <summary className="cursor-pointer text-sm">
                            {r.item_name}
                            {r.item_type === 'RAW' && (
                              <span className="ml-1.5 text-muted">{bandLabel(r.band)}</span>
                            )}
                          </summary>
                          <ul className="mt-1.5 grid gap-0.5 text-xs text-muted">
                            {src.map((n, i) => (
                              <li key={i} className="tnum">
                                {n.source_label} · {md(n.need_on)} · {n.qty == null ? '개수 미정' : `${qty(num(n.qty))} ${r.usage_uom}`}
                              </li>
                            ))}
                          </ul>
                        </details>
                        <div className="font-mono text-xs text-faint">{r.item_code}</div>
                      </td>
                      <td className="td tnum text-right">
                        {r.need_qty == null ? '-' : `${qty(num(r.need_qty))} ${r.usage_uom}`}
                        {r.unknown && <div className="text-xs text-warn">개수 미정 몫 있음</div>}
                      </td>
                      <td className="td tnum text-muted">{md(r.first_need_on)}</td>
                      <td className="td tnum text-right">{qty(num(r.stock_qty))} {r.usage_uom}</td>
                      <td className="td tnum text-right text-muted">
                        {onOrder > 0
                          ? <>{qty(onOrder)}{r.next_expected_on ? ` (${md(r.next_expected_on)})` : ''}</>
                          : '-'}
                      </td>
                      <td className="td tnum text-right font-semibold">
                        {short > 0 ? <span className="text-warn">{qty(short)} {r.usage_uom}</span> : '-'}
                      </td>
                      <td className="td">
                        {short <= 0 ? '-' : solution ? (
                          <Tag tone="warn">자체 제조 필요</Tag>
                        ) : (
                          <span className={`tnum ${tone}`}>
                            {r.order_by ? md(r.order_by) : '-'}
                            {r.lead_days == null
                              ? <span className="ml-1 text-xs text-muted">리드타임 미설정</span>
                              : <span className="ml-1 text-xs text-muted">리드타임 {r.lead_days}일</span>}
                          </span>
                        )}
                      </td>
                      <td className="td text-right">
                        {short > 0 && (solution ? (
                          <Link href="/material/movement" className="qd-text-action">원액 제조</Link>
                        ) : (
                          <Link href={`/material/orders?item=${r.item_id}&qty=${Number(short.toFixed(6))}`}
                                className="qd-text-action">발주</Link>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
