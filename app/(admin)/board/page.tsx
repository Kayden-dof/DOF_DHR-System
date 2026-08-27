import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { withUser } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { PageShell, StatStrip, type StatItem } from '@/components/shell';
import { Panel, Empty, Tag } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: '경영 현황' };

/* ---------------------------------------------------------------------------
   경영 현황

   보는 사람이 알고 싶은 것은 넷뿐이다 (사용자 지시).

     오늘 몇 개가 만들어졌고 어떤 제품인가
     이번 달 얼마나 만들었고 얼마나 썼나
     되돌린 것이 얼마나 되나
     이 개체 번호가 무엇인가

   그 밖의 것은 두지 않는다. 화면에 자리가 남는다고 채우면 정작 봐야 할 넷이
   묻힌다.

   ── 불량률의 정의 ─────────────────────────────────────────────────────────
   품질이 정한 정의를 그대로 쓴다 (사용자).

     발생 수량 = 재작업 + 특채 + 불량
     불량      = 재작업을 했는데도 제품이 되지 못한 수량
     불량률    = 불량 ÷ 생산 수량
     재작업률  = 재작업 ÷ 생산 수량
     특채      = 부적합인 채로 내보낸 수량. 비율로 섞지 않고 개수로 따라간다

   시스템이 무엇을 불량으로 볼지 정하지 않는다. 사람이 서면으로 정한 결과가
   product_nonconformity 에 적히고, 여기서는 그것을 세기만 한다 (§1).
--------------------------------------------------------------------------- */

interface DayRow {
  made_on: string; item_code: string; item_name: string;
  product_code: string | null; product_name: string | null;
  lots: number; produced: number; sampled: number; available: number;
}
interface MonthRow {
  month: string; lots: number; produced: number; sampled: number;
  shipped: number; rework: number;
}
interface QualRow {
  month: string; produced: number;
  rework: number; concession: number; scrap: number; found: number;
  scrap_pct: string | null; rework_pct: string | null;
}
interface SpendRow { month: string; amount: string }
interface Unit {
  product_lot_id: string; lot_no: string; seq: number | null;
  item_code: string; item_name: string;
  product_code: string | null; product_name: string | null;
  batch_no: string; work_order_id: string;
  raw_lot_no: string; manufactured_on: string; expiry_date: string;
  qty_produced: number; qty_sample: number;
  standing: string; customer_name: string | null; shipped_at: string | null;
}

type Search = Promise<{ sn?: string }>;

export default async function BoardPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const sn = ((await searchParams).sn || '').trim();

  const d = await withUser(user, async (db) => ({
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
    days: await db.rows<DayRow>(
      `select made_on::text as made_on, item_code, item_name,
              product_code, product_name, lots, produced, sampled, available
         from v_output_daily
        where made_on >= (timezone('Asia/Seoul', now()))::date - 6
        order by made_on desc, item_code`),
    months: await db.rows<MonthRow>(
      `select month::text as month, lots, produced, sampled, shipped, rework
         from v_output_monthly order by month desc limit 6`),
    spend: await db.rows<SpendRow>(
      `select month::text as month, sum(amount)::text as amount
         from v_material_spend group by month order by month desc limit 6`),
    /*
     * 달별 품질. 불량률의 정의는 품질이 정했다 (사용자).
     *
     *   발생 = 재작업 + 특채 + 불량
     *   불량 = 재작업해도 제품이 안 된 수량
     *   불량률 = 불량 ÷ 생산 · 재작업률 = 재작업 ÷ 생산
     *
     * 비율은 뷰에서 한 번만 낸다. 두 곳에서 나누면 반올림이 갈린다.
     */
    qual: await db.rows<QualRow>(
      `select month::text as month, produced, rework, concession, scrap, found,
              scrap_pct::text as scrap_pct, rework_pct::text as rework_pct
         from v_quality_monthly order by month desc limit 6`),
    /* 자재 폐기. 자재 단위라 제품 개수와 섞지 않고 따로 센다 */
    scrap: await db.rows<{ month: string; qty: string }>(
      `select date_trunc('month', sm.registered_at)::date::text as month,
              sum(abs(sm.qty))::text as qty
         from stock_movement sm
        where sm.type = 'DISPOSAL_WIP'
        group by 1 order by 1 desc limit 6`),
    unit: sn
      ? await db.rows<Unit>(`select * from find_unit($1)`, [sn])
      : [],
  }));

  const thisMonth = (d.today ?? '').slice(0, 7);
  const cur = d.months.find((m) => m.month.slice(0, 7) === thisMonth);
  const todayRows = d.days.filter((r) => r.made_on === d.today);
  const todayQty = todayRows.reduce((a, r) => a + r.produced, 0);
  const curSpend = d.spend.find((s) => s.month.slice(0, 7) === thisMonth);
  const curQ = d.qual.find((q) => q.month.slice(0, 7) === thisMonth);
  const curScrap = d.scrap.find((s) => s.month.slice(0, 7) === thisMonth);

  const won = (v?: string | null) =>
    v ? `${Math.round(Number(v)).toLocaleString('ko-KR')}원` : '0원';

  const stats: StatItem[] = [
    { label: '오늘 생산', value: todayQty, unit: '개' },
    { label: '오늘 제조번호', value: todayRows.reduce((a, r) => a + r.lots, 0), unit: '건' },
    { label: '이번 달 생산', value: cur?.produced ?? 0, unit: '개' },
    { label: '이번 달 출고', value: cur?.shipped ?? 0, unit: '개' },
    { label: '이번 달 불량률', value: curQ?.scrap_pct ? `${Number(curQ.scrap_pct)}%` : '0%',
      tone: Number(curQ?.scrap_pct ?? 0) > 0 ? 'danger' : undefined },
    { label: '이번 달 재작업률', value: curQ?.rework_pct ? `${Number(curQ.rework_pct)}%` : '0%',
      tone: Number(curQ?.rework_pct ?? 0) > 0 ? 'warn' : undefined },
    { label: '이번 달 특채', value: curQ?.concession ?? 0, unit: '개',
      tone: (curQ?.concession ?? 0) > 0 ? 'warn' : undefined },
  ];

  return (
    <PageShell
      section="경영"
      title="경영 현황"
      lede="오늘과 이번 달의 생산 · 출고 · 자재 지출입니다. 개체 번호로 그 제품이 어디서 나와 어디로 갔는지 찾을 수 있습니다."
      stats={<StatStrip items={stats} />}
    >

      {/* 개체 번호 찾기 ---------------------------------------------------- */}
      <Panel title="개체 번호 찾기"
             note="라벨의 번호를 그대로 적으십시오. 제조번호만 적어도 됩니다">
        <form className="flex flex-wrap gap-2 px-4 py-3">
          <input name="sn" defaultValue={sn} autoComplete="off"
                 placeholder="P2608-0004-007 또는 P2608-0004"
                 className="input w-72 font-mono" />
          <button className="btn-primary">찾기</button>
        </form>

        {sn && (
          d.unit.length === 0 ? (
            <p className="border-t border-line-soft px-4 py-3 text-sm text-muted">
              <span className="font-mono text-ink">{sn}</span> 에 해당하는 제조번호가 없습니다.
            </p>
          ) : (
            <div className="border-t border-line-soft">
              {d.unit.map((u, i) => (
                <div key={i} className="grid gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="제품">
                    {u.product_code ?? u.item_code}
                    <div className="text-xs text-muted">{u.product_name ?? u.item_name}</div>
                  </Field>
                  <Field label="형명"><span className="font-mono">{u.item_code}</span></Field>
                  <Field label="제조번호">
                    <span className="font-mono font-bold">{u.lot_no}</span>
                    {u.seq !== null && (
                      <span className="font-mono"> · {String(u.seq).padStart(3, '0')}</span>
                    )}
                  </Field>
                  <Field label="상태">
                    <Tag tone={u.standing === '출고됨' ? 'brand'
                      : u.standing === '완제품검사 시료' ? 'quiet'
                      : u.standing === '이 제조번호에 없는 번호' ? 'danger' : 'ok'}>
                      {u.standing}
                    </Tag>
                    {u.customer_name && (
                      <div className="text-xs text-muted">
                        {u.customer_name} · {fmtDate(u.shipped_at)}
                      </div>
                    )}
                  </Field>

                  <Field label="배치">
                    <Link href={`/production/${u.work_order_id}`}
                          className="font-mono text-brand hover:underline">
                      {u.batch_no}
                    </Link>
                  </Field>
                  <Field label="원재료 로트">
                    <span className="font-mono">{u.raw_lot_no}</span>
                  </Field>
                  <Field label="제조일"><span className="tnum">{fmtDate(u.manufactured_on)}</span></Field>
                  <Field label="유효기한"><span className="tnum">{fmtDate(u.expiry_date)}</span></Field>
                </div>
              ))}
            </div>
          )
        )}
      </Panel>

      {/* 오늘 만든 것 ------------------------------------------------------ */}
      <Panel title="오늘 만든 제품" note={fmtDate(d.today)}>
        {todayRows.length === 0 ? (
          <Empty>오늘 재단한 제품이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">제품</th>
                  <th className="th">형명</th>
                  <th className="th text-right">제조번호</th>
                  <th className="th text-right">생산</th>
                  <th className="th text-right">시료</th>
                  <th className="th text-right">출하 가능</th>
                </tr>
              </thead>
              <tbody>
                {todayRows.map((r, i) => (
                  <tr key={i}>
                    <td className="td">{r.product_code ?? r.item_code}</td>
                    <td className="td font-mono text-xs">{r.item_code}</td>
                    <td className="td tnum text-right text-muted">{r.lots}</td>
                    <td className="td tnum text-right font-bold">{r.produced}</td>
                    <td className="td tnum text-right text-muted">{r.sampled || ''}</td>
                    <td className="td tnum text-right">{r.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* 달별 ------------------------------------------------------------- */}
      <Panel title="달별 생산 · 출고 · 자재 지출">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">달</th>
                <th className="th text-right">제조번호</th>
                <th className="th text-right">생산</th>
                <th className="th text-right">출고</th>
                <th className="th text-right">재작업</th>
                <th className="th text-right">특채</th>
                <th className="th text-right">불량</th>
                <th className="th text-right">불량률</th>
                <th className="th text-right">자재 지출</th>
              </tr>
            </thead>
            <tbody>
              {d.months.map((m) => {
                const sp = d.spend.find((s) => s.month === m.month);
                const q = d.qual.find((x) => x.month === m.month);
                return (
                  <tr key={m.month}>
                    <td className="td tnum">{m.month.slice(0, 7)}</td>
                    <td className="td tnum text-right text-muted">{m.lots}</td>
                    <td className="td tnum text-right font-bold">{m.produced}</td>
                    <td className="td tnum text-right">{m.shipped}</td>
                    <td className="td tnum text-right">{q?.rework || ''}</td>
                    <td className="td tnum text-right">{q?.concession || ''}</td>
                    <td className="td tnum text-right">{q?.scrap || ''}</td>
                    <td className={`td tnum text-right ${
                      Number(q?.scrap_pct ?? 0) > 0 ? 'font-bold text-danger' : 'text-faint'}`}>
                      {q?.scrap_pct ? `${Number(q.scrap_pct)}%` : '0%'}
                    </td>
                    <td className="td tnum text-right">{won(sp?.amount)}</td>
                  </tr>
                );
              })}
              {d.months.length === 0 && (
                <tr><td colSpan={9} className="td text-center text-xs text-faint">기록이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/*
          * 무엇을 센 것인지 적는다. 이 숫자를 불량률로 읽으면 안 되기 때문이다.
          * 정의는 품질이 정하고, 정해지면 그 식을 넣는다.
          */}
        <div className="border-t border-line-soft bg-canvas px-4 py-3">
          <dl className="grid gap-x-6 gap-y-1.5 text-xs leading-relaxed sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold text-ink">생산</dt>
              <dd className="text-muted">재단에서 제조번호가 붙은 개수입니다. 시료를 포함합니다.</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold text-ink">재작업</dt>
              <dd className="text-muted">다시 해서 제품이 된 수량입니다. 재작업률은 생산 수량으로 나눕니다.</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold text-ink">특채</dt>
              <dd className="text-muted">부적합인 채로 서면 승인을 받아 내보낸 수량입니다. 비율로 섞지 않고 개수로 따로 봅니다.</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold text-ink">불량</dt>
              <dd className="text-muted">재작업을 했는데도 제품이 되지 못한 수량입니다. 불량률은 생산 수량으로 나눕니다.</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-semibold text-ink">자재 지출</dt>
              <dd className="text-muted">그 달에 입고한 자재의 매입 금액입니다. 쓴 금액이 아니라 들인 금액입니다.</dd>
            </div>
          </dl>
          <p className="mt-2.5 text-xs leading-relaxed text-faint">
            발생 수량은 재작업 · 특채 · 불량의 합입니다. 한 개체는 셋 중 하나로만
            끝나므로 재작업이나 특채로 살아난 만큼 불량은 줄어듭니다.
            시스템이 무엇을 불량으로 볼지 정하지 않습니다. 서면으로 정해진 결과를 셀 뿐입니다.
          </p>
        </div>
      </Panel>
    </PageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label mb-0.5">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}
