import Link from 'next/link';
import { requireUser, hasRole } from '@/lib/session';
import { withUser } from '@/lib/db';
import { fmtDate } from '@/lib/fmt';
import { PageShell, StatStrip, type StatItem } from '@/components/shell';
import { statRows as rows, mono } from '@/components/stat-rows';
import { Panel, Empty, Tag } from '@/components/ui';
import { SubNav } from '../nav';
import { boardNav } from '../sections';

export const dynamic = 'force-dynamic';

export const metadata = { title: '경영 현황' };

/* ---------------------------------------------------------------------------
   경영 현황

   ── 읽는 순서가 곧 화면 순서다 ────────────────────────────────────────────
   가까운 것부터 먼 것으로 내려간다 (사용자 요청).

     오늘    지금 무슨 일이 있었나
     이번 주 이번 주가 어떻게 흘러왔나. 날마다 한 줄
     달별    지난 달들과 견주어 어디쯤인가

   같은 표를 세 벌 두지 않는다. 기간마다 궁금한 것이 다르다. 오늘은 무엇이
   나왔는지 (제품별), 이번 주는 흐름이 (날마다), 달은 견주는 것이 (달마다).

   ── 재단 전과 후를 더하지 않는다 ──────────────────────────────────────────
   재단 전은 장이고 재단 후는 개다 (0047). 한 장에서 여러 개가 나오므로 더하면
   뜻을 잃는다. 열을 나누고 머리에 단위를 적는다.

   ── 불량률의 정의 ─────────────────────────────────────────────────────────
   품질이 정한 정의를 그대로 쓴다 (사용자).

     발생 = 재작업 + 특채 + 불량
     불량 = 재작업을 했는데도 제품이 되지 못한 수량
     불량률 = 불량 ÷ 생산 · 재작업률 = 재작업 ÷ 생산

   시스템이 무엇을 불량으로 볼지 정하지 않는다. 사람이 서면으로 정한 결과가
   적히고 여기서는 세기만 한다 (§1).
--------------------------------------------------------------------------- */

interface DayRow {
  made_on: string; item_code: string; item_name: string;
  product_code: string | null; product_name: string | null;
  lots: number; produced: number; sampled: number; available: number;
}
interface Bucket {
  period: string; bucket: string;
  lots: number; produced: number; sampled: number; shipped: number;
  rework: number; concession: number; scrap: number; found: number;
  scrap_pct: string | null; rework_pct: string | null;
  sheets: number; sheet_scrap: number; sheet_rework: number;
  sheet_scrap_pct: string | null;
  spend: string;
}
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

interface ItemCost {
  item_code: string; item_name: string; spec: string;
  qty: number; shared_cost: string; own_cost: string;
}

export default async function BoardPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const sn = ((await searchParams).sn || '').trim();

  const d = await withUser(user, async (db) => ({
    today: await db.val<string>(`select to_char(timezone('Asia/Seoul', now()),'YYYY-MM-DD')`),
    weekFrom: await db.val<string>(
      `select date_trunc('week', timezone('Asia/Seoul', now()))::date::text`),

    /* 일 · 주 · 달을 한 뷰에서 가져온다. 같은 셈이 세 벌이 되지 않게 (0048) */
    buckets: await db.rows<Bucket>(
      `select period, bucket::text as bucket, lots, produced, sampled, shipped,
              rework, concession, scrap, found,
              scrap_pct::text as scrap_pct, rework_pct::text as rework_pct,
              sheets, sheet_scrap, sheet_rework,
              sheet_scrap_pct::text as sheet_scrap_pct, spend::text as spend
         from v_board_period
        where bucket >= (timezone('Asia/Seoul', now()))::date - 400
        order by bucket desc`),

    /* 오늘은 무엇이 나왔는지가 궁금하다 */
    days: await db.rows<DayRow>(
      `select made_on::text as made_on, item_code, item_name,
              product_code, product_name, lots, produced, sampled, available
         from v_output_daily
        where made_on >= (timezone('Asia/Seoul', now()))::date - 30
        order by made_on desc, item_code`),
    todayLots: await db.rows<{ lot_no: string; item_code: string; produced: number }>(
      `select pl.lot_no, i.code as item_code, pl.qty_produced as produced
         from product_lot pl join item i on i.id = pl.item_id
        where pl.manufactured_on = (timezone('Asia/Seoul', now()))::date
        order by i.code`),
    todayShip: await db.rows<{ customer_name: string; lot_no: string; qty: number }>(
      `select sh.customer_name, pl.lot_no, sh.qty
         from shipment sh join product_lot pl on pl.id = sh.product_lot_id
        where sh.shipped_at = (timezone('Asia/Seoul', now()))::date
        order by pl.lot_no`),

    /* 부적합 내역. 어디서 발견했는지가 함께 온다 (0047) */
    nc: await db.rows<{
      made_on: string; lot_no: string; outcome: string; qty: number;
      reason_code: string; op_name: string | null; concession_doc_no: string | null;
    }>(
      `select pl.manufactured_on::text as made_on, pl.lot_no,
              n.outcome::text as outcome, n.qty, n.reason_code,
              o.name as op_name, n.concession_doc_no
         from product_nonconformity n
         join product_lot pl on pl.id = n.product_lot_id
         left join dmr_operation o on o.id = n.operation_id
        where pl.manufactured_on >= (timezone('Asia/Seoul', now()))::date - 40
        order by pl.manufactured_on desc, pl.lot_no`),
    wipNc: await db.rows<{
      batch_no: string; op_name: string; outcome: string;
      sheets: number; reason_code: string;
    }>(
      `select wo.batch_no, v.op_name, v.outcome, v.sheets, v.reason_code
         from v_wo_wip_nc v
         join work_order wo on wo.id = v.work_order_id
        where (timezone('Asia/Seoul', wo.issued_at))::date
              >= (timezone('Asia/Seoul', now()))::date - 40
        order by wo.batch_no, v.seq`),

    spendItems: await db.rows<{ code: string; name: string; won: string }>(
      `select code, name, amount::text as won from v_material_spend
        where month = date_trunc('month', (timezone('Asia/Seoul', now()))::date)
        order by amount desc limit 8`),

    unit: sn ? await db.rows<Unit>(`select * from find_unit($1)`, [sn]) : [],
    /*
     * 제품코드별 자재 원가 (사용자 요청). 배분과 반올림은 v_item_cost 가
     * 한 번만 한다 - 화면이 각자 나누면 갈라진다 (§10).
     */
    itemCost: await db.rows<ItemCost>(
      `select item_code, item_name, spec_label(item_code) as spec,
              sum(qty)::int                as qty,
              sum(shared_cost)::numeric    as shared_cost,
              sum(own_cost)::numeric       as own_cost
         from v_item_cost
        group by 1, 2, 3
        order by 1`),
  }));

  const today = d.today ?? '';
  const weekFrom = d.weekFrom ?? '';
  const thisMonth = today.slice(0, 7);

  const pick = (period: string, bucket: string) =>
    d.buckets.find((b) => b.period === period && b.bucket === bucket);
  const list = (period: string, n: number) =>
    d.buckets.filter((b) => b.period === period).slice(0, n);

  const day = pick('day', today);
  const week = pick('week', weekFrom);
  const month = d.buckets.find(
    (b) => b.period === 'month' && b.bucket.slice(0, 7) === thisMonth);

  const todayRows = d.days.filter((r) => r.made_on === today);
  const won = (v?: string | null) =>
    v ? `${Math.round(Number(v)).toLocaleString('ko-KR')}원` : '0원';
  const pct = (v?: string | null) => (v ? `${Number(v)}%` : '0%');

  /*
   * 요약 띠의 툴팁은 전부 내역이다. 어떤 칸은 내역이고 어떤 칸은 설명이면 보는
   * 사람이 매번 무엇이 나올지 짐작해야 한다 (사용자 지적). 설명은 아래 정의
   * 칸이 맡는다.
   */

  const ncOf = (kind: string, from: string) =>
    d.nc.filter((n) => n.outcome === kind && n.made_on >= from);

  const stats: StatItem[] = [
    { label: '오늘 생산', value: day?.produced ?? 0, unit: '개',
      detail: rows(todayRows.map((r) => ({
        left: mono(r.item_code), sub: r.item_name, right: `${r.produced}개`,
      })), '오늘 재단한 제품이 없습니다.') },
    { label: '오늘 제조번호', value: day?.lots ?? 0, unit: '건',
      detail: rows(d.todayLots.map((l) => ({
        left: <b className="font-mono">{l.lot_no}</b>, sub: l.item_code,
        right: `${l.produced}개`,
      })), '오늘 붙은 제조번호가 없습니다.') },
    { label: '오늘 출고', value: day?.shipped ?? 0, unit: '개',
      detail: rows(d.todayShip.map((r) => ({
        left: r.customer_name, sub: r.lot_no, right: `${r.qty}개`,
      })), '오늘 나간 것이 없습니다.') },
    { label: '이번 주 생산', value: week?.produced ?? 0, unit: '개',
      detail: rows(list('day', 10)
        .filter((b) => b.bucket >= weekFrom && b.produced > 0)
        .map((b) => ({ left: fmtDate(b.bucket), right: `${b.produced}개` })),
        '이번 주 생산이 없습니다.') },
    { label: '이번 달 생산', value: month?.produced ?? 0, unit: '개',
      detail: rows(list('day', 40)
        .filter((b) => b.bucket.slice(0, 7) === thisMonth && b.produced > 0)
        .map((b) => ({ left: fmtDate(b.bucket), right: `${b.produced}개` })),
        '이번 달 생산이 없습니다.') },
    { label: '이번 달 불량률', value: pct(month?.scrap_pct),
      tone: Number(month?.scrap_pct ?? 0) > 0 ? 'danger' : undefined,
      detail: rows(ncOf('SCRAP', `${thisMonth}-01`).map((n) => ({
        left: <b className="font-mono">{n.lot_no}</b>,
        sub: `${n.op_name ?? '공정 미기재'} · ${n.reason_code}`, right: `${n.qty}개`,
      })), '이번 달 불량이 없습니다.') },
    { label: '이번 달 특채', value: month?.concession ?? 0, unit: '개',
      tone: (month?.concession ?? 0) > 0 ? 'warn' : undefined,
      detail: rows(ncOf('CONCESSION', `${thisMonth}-01`).map((n) => ({
        left: <b className="font-mono">{n.concession_doc_no ?? ''}</b>,
        sub: `${n.lot_no} · ${n.reason_code}`, right: `${n.qty}개`,
      })), '이번 달 특채가 없습니다.') },
    { label: '이번 달 자재 지출', value: won(month?.spend),
      detail: rows(d.spendItems.map((r) => ({
        left: mono(r.code), sub: r.name, right: won(r.won),
      })), '이번 달 입고가 없습니다.') },
  ];

  return (
    <PageShell
      section="경영"
      title="경영 현황"
      lede="오늘 · 이번 주 · 달별 순서로 놓았습니다. 개체 번호로 그 제품이 어디서 나와 어디로 갔는지 찾을 수 있습니다."
      stats={<StatStrip items={stats} />}
      nav={<SubNav items={boardNav(hasRole(user, 'SYS_ADMIN', 'PROD_MGR', 'VIEWER'))} />}
    >

      {/* ------------------------------------------------------------------
        * 개체 번호 찾기 결과
        *
        * 입력 칸은 머리줄로 옮겼다 (components/find-unit.tsx). 여기 큰 판으로
        * 두었더니 평소에는 빈 칸 하나만 덩그러니 떠 있었고, 자리를 많이 먹으면서
        * 하는 일이 없었다 (사용자 지적 2026-09-01).
        *
        * 결과는 여기서만 그린다. 두 곳이 같은 것을 그리면 갈라진다 (§10).
        * 찾은 것이 없으면 이 판 자체가 나오지 않는다.
        * ---------------------------------------------------------------- */}
      {sn && (
      <Panel title="개체 번호 찾기"
             note={<span className="font-mono">{sn}</span>}>
        {(
          d.unit.length === 0 ? (
            <p className="border-t border-line-soft px-4 py-3 text-sm text-muted">
              <span className="font-mono text-ink">{sn}</span> 에 해당하는 제조번호가 없습니다.
            </p>
          ) : (
            <div className="border-t border-line-soft">
              {d.unit.map((u, i) => (
                <div key={i}
                     className="grid gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  <Field label="제조일">
                    <span className="tnum">{fmtDate(u.manufactured_on)}</span>
                  </Field>
                  <Field label="유효기한">
                    <span className="tnum">{fmtDate(u.expiry_date)}</span>
                  </Field>
                </div>
              ))}
            </div>
          )
        )}
      </Panel>
      )}

      {/* 오늘 ── 무엇이 나왔나 --------------------------------------------- */}
      <Panel title="오늘" note={fmtDate(today)}>
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

      {/* 이번 주 ── 어떻게 흘러왔나 ---------------------------------------- */}
      <Panel title="이번 주" note={<>{fmtDate(weekFrom)}부터 · 월요일 시작</>}>
        <PeriodTable rows={list('day', 10).filter((b) => b.bucket >= weekFrom)}
                     label={(b) => fmtDate(b.bucket)}
                     total={week} won={won} pct={pct}
                     empty="이번 주 기록이 없습니다." />
      </Panel>

      {/* 달별 ── 어디쯤인가 ------------------------------------------------ */}
      <Panel title="달별">
        <PeriodTable rows={list('month', 6)}
                     label={(b) => b.bucket.slice(0, 7)}
                     won={won} pct={pct}
                     empty="기록이 없습니다." />

        <div className="border-t border-line-soft bg-canvas px-4 py-3">
          <dl className="grid gap-x-6 gap-y-1.5 text-xs leading-relaxed sm:grid-cols-2">
            <Def term="생산">재단에서 제조번호가 붙은 개수입니다. 시료를 포함합니다.</Def>
            <Def term="재작업">다시 해서 제품이 된 수량입니다. 생산 수량으로 나눕니다.</Def>
            <Def term="특채">
              부적합인 채로 서면 승인을 받아 내보낸 수량입니다.
              특채 기록지 문서 코드가 있어야 잡힙니다.
            </Def>
            <Def term="불량">
              재작업을 했는데도 제품이 되지 못한 수량입니다. 생산 수량으로 나눕니다.
            </Def>
            <Def term="재단 전">
              아직 제품이 아닌 단계의 부적합이라 단위가 <b className="text-ink">장</b>입니다.
              제품 개수와 더하지 않습니다.
            </Def>
            <Def term="자재 지출">
              그 기간에 입고한 자재의 매입 금액입니다. 쓴 금액이 아니라 들인 금액입니다.
            </Def>
          </dl>
          <p className="mt-2.5 text-xs leading-relaxed text-faint">
            발생 수량은 재작업 · 특채 · 불량의 합입니다. 한 개체는 셋 중 하나로만
            끝나므로 재작업이나 특채로 살아난 만큼 불량은 줄어듭니다.
            시스템이 무엇을 불량으로 볼지 정하지 않습니다. 서면으로 정해진 결과를 셀 뿐입니다.
          </p>
        </div>
      </Panel>

      {/* ------------------------------------------------------------------
        * 제품코드별 자재 원가
        *
        * 배치 공통분과 형명 자체 자재를 한 줄로 합치지 않는다 (사용자 결정
        * 2026-09-01). 합쳐 놓으면 어디서 온 값인지 알 수 없고, 배분 기준을
        * 나중에 되짚을 수도 없다.
        * ---------------------------------------------------------------- */}
      <Panel title="제품코드별 자재 원가"
             note="배치 공통분은 면적으로 나눕니다">
        {d.itemCost.length === 0 ? (
          <Empty>원가를 낼 자료가 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">형명</th>
                  <th className="th">규격</th>
                  <th className="th text-right">생산</th>
                  <th className="th text-right">배치 공통</th>
                  <th className="th text-right">형명 자체</th>
                  <th className="th text-right">한 장</th>
                </tr>
              </thead>
              <tbody>
                {d.itemCost.map((r) => {
                  const per = (Number(r.shared_cost) + Number(r.own_cost)) / (r.qty || 1);
                  return (
                    <tr key={r.item_code}>
                      <td className="td font-mono font-bold">{r.item_code}</td>
                      <td className="td text-xs text-muted">{r.spec}</td>
                      <td className="td text-right tnum">{r.qty}</td>
                      <td className="td text-right tnum">{won(r.shared_cost)}</td>
                      <td className="td text-right tnum">{won(r.own_cost)}</td>
                      <td className="td text-right tnum font-bold">{won(String(per))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-line-soft bg-canvas px-4 py-3">
          <dl className="grid gap-x-6 gap-y-1.5 text-xs leading-relaxed sm:grid-cols-2">
            <Def term="배치 공통">
              원재료와 재단 전 공정 자재입니다. 배치 안에서 <b className="text-ink">조각
              면적에 비례해</b> 나눕니다. 개수로 나누면 5x5 한 장과 10x10 한 장이
              같은 값을 집니다.
            </Def>
            <Def term="형명 자체">
              재단 뒤에 이 형명에만 들어간 자재입니다. 포장재와 라벨이 여기 옵니다.
            </Def>
          </dl>
          <p className="mt-2.5 text-xs leading-relaxed text-faint">
            <b className="text-ink">자재 원가입니다. 제조원가가 아닙니다.</b>{' '}
            인건비 · 전기 · 멸균 위탁비가 들어 있지 않습니다. 가죽 한 장에서 조각을
            떼고 남는 자투리의 면적은 기록되지 않아, 그 몫이 나온 조각들에 비례해
            얹혀 있습니다.
          </p>
        </div>
      </Panel>

      {/* 재단 전 부적합 ── 단위가 달라 따로 둔다 --------------------------- */}
      {d.wipNc.length > 0 && (
        <Panel title="재단 전 부적합"
               note="단위가 장입니다. 제품 개수와 더하지 않습니다">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">배치</th>
                  <th className="th">발견 공정</th>
                  <th className="th">사유</th>
                  <th className="th">결말</th>
                  <th className="th text-right">장수</th>
                </tr>
              </thead>
              <tbody>
                {d.wipNc.map((w, i) => (
                  <tr key={i}>
                    <td className="td font-mono text-xs">{w.batch_no}</td>
                    <td className="td text-sm">{w.op_name}</td>
                    <td className="td text-sm text-muted">{w.reason_code}</td>
                    <td className="td">
                      <Tag tone={w.outcome === 'SCRAP' ? 'danger'
                        : w.outcome === 'CONCESSION' ? 'warn' : 'quiet'}>
                        {w.outcome === 'SCRAP' ? '불량'
                          : w.outcome === 'CONCESSION' ? '특채' : '재작업'}
                      </Tag>
                    </td>
                    <td className="td tnum text-right font-bold">{w.sheets}장</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </PageShell>
  );
}

/* ---------------------------------------------------------------------------
   기간 표

   일 · 주 · 달이 같은 열을 쓴다. 기간마다 표를 따로 그리면 열이 조금씩 달라져
   견주기 어려워진다.

   재단 전(장)과 재단 후(개)를 나란히 두되 더하지 않는다. 열 머리에 단위를
   적어 둔다.
--------------------------------------------------------------------------- */
function PeriodTable({ rows, label, total, won, pct, empty }: {
  rows: Bucket[];
  label: (b: Bucket) => string;
  total?: Bucket;
  won: (v?: string | null) => string;
  pct: (v?: string | null) => string;
  empty: string;
}) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className="th">기간</th>
            <th className="th text-right">생산 (개)</th>
            <th className="th text-right">출고 (개)</th>
            <th className="th text-right">재작업</th>
            <th className="th text-right">특채</th>
            <th className="th text-right">불량</th>
            <th className="th text-right">불량률</th>
            <th className="th text-right">재단 전 폐기 (장)</th>
            <th className="th text-right">자재 지출</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={`${b.period}-${b.bucket}`}>
              <td className="td tnum">{label(b)}</td>
              <td className="td tnum text-right font-bold">{b.produced || ''}</td>
              <td className="td tnum text-right">{b.shipped || ''}</td>
              <td className="td tnum text-right">{b.rework || ''}</td>
              <td className="td tnum text-right">{b.concession || ''}</td>
              <td className="td tnum text-right">{b.scrap || ''}</td>
              <td className={`td tnum text-right ${
                Number(b.scrap_pct ?? 0) > 0 ? 'font-bold text-danger' : 'text-faint'}`}>
                {b.produced > 0 ? pct(b.scrap_pct) : ''}
              </td>
              <td className="td tnum text-right text-muted">
                {b.sheet_scrap ? `${b.sheet_scrap} / ${b.sheets}` : ''}
              </td>
              <td className="td tnum text-right">{Number(b.spend) ? won(b.spend) : ''}</td>
            </tr>
          ))}
          {total && (
            <tr className="bg-canvas">
              <th className="td text-left text-xs font-bold text-ink">합계</th>
              <td className="td tnum text-right font-bold">{total.produced}</td>
              <td className="td tnum text-right font-bold">{total.shipped}</td>
              <td className="td tnum text-right">{total.rework || ''}</td>
              <td className="td tnum text-right">{total.concession || ''}</td>
              <td className="td tnum text-right">{total.scrap || ''}</td>
              <td className={`td tnum text-right ${
                Number(total.scrap_pct ?? 0) > 0 ? 'font-bold text-danger' : 'text-faint'}`}>
                {total.produced > 0 ? pct(total.scrap_pct) : ''}
              </td>
              <td className="td tnum text-right text-muted">
                {total.sheet_scrap ? `${total.sheet_scrap} / ${total.sheets}` : ''}
              </td>
              <td className="td tnum text-right">
                {Number(total.spend) ? won(total.spend) : ''}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Def({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 font-semibold text-ink">{term}</dt>
      <dd className="text-muted">{children}</dd>
    </div>
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
