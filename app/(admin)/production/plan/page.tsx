import Link from 'next/link';
import { requireUser, hasRole, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { Panel, Empty, Tag } from '@/components/ui';
import { Table, Th, Td } from '@/components/table';
import { RowLink } from '@/components/row-link';
import { withActor } from '@/lib/db';
import { loadCalendar } from '@/lib/timeline-db';
import {
  DAY, KIND_LABEL, addDays, carried, dayIndex, daysBetween, dur, hhmm, isHands, isOff, md, planBatch,
  procColor, weekday, type Plan, type Step, type WorkCalendar,
} from '@/lib/timeline';
import { SubNav } from '../../nav';
import { PRODUCTION_NAV } from '../../sections';
import { PlanForm, DeletePlan, CalendarForm, type DmOption, type WoOption } from './plan-forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: '일정' };

/* ---------------------------------------------------------------------------
   생산 > 일정 (0137 · 사용자 2026-11-19 «타임라인 프로그램의 기능을 DHR 에»)

   배치 계획(예정 배치번호 · 제품표준서 판 · 시작일 · 시각)을 넣으면 그 판의 공정
   시간표를 날짜에 얹는다. 손작업이 휴무일에 걸리면 다음 근무일로 미루고, 그 때문에
   늘어난 대기가 허용 상한을 넘으면 짚는다. 계획이라 기록이 아니다 - 일정표 인쇄도
   대장에 남지 않고 아무것도 잠그지 않는다.
--------------------------------------------------------------------------- */

interface PlanRowDb {
  id: string; label: string; dm: string; dm_label: string; start_on: string; start_min: number;
  wo: string | null; wo_no: string | null; batch_no: string | null; note: string;
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await requireUser();
  if (blocksScreen(user, '/production/plan')) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;
  const sp = await searchParams;
  const writable = hasRole(user, 'SYS_ADMIN', 'PROD_MGR');

  const d = await withActor(user.id, async (db) => {
    const plans = await db.rows<PlanRowDb>(
      `select p.id, p.label, p.device_master_id as dm,
              coalesce(dm.product_code, i.code) || ' ' || dm.revision as dm_label,
              to_char(p.start_on, 'YYYY-MM-DD') as start_on, p.start_min,
              p.work_order_id as wo, wo.wo_no, wo.batch_no, p.note
         from batch_plan p
         join device_master dm on dm.id = p.device_master_id
         join item i on i.id = dm.item_id
         left join work_order wo on wo.id = p.work_order_id
        order by p.start_on desc, p.label`);
    const tls = await db.rows<{ dm: string; steps: Step[] }>(
      `select device_master_id as dm, steps from dmr_timeline`);
    const dms = await db.rows<DmOption>(
      `select dm.id, coalesce(dm.product_code, i.code) || ' ' || dm.revision as label,
              case when dm.verified_at is null or dm.status <> 'ACTIVE' then '작성 중'
                   when dm.effective_from is null or dm.effective_from > current_date then '시행 전'
                   else '' end as note
         from dmr_timeline t join device_master dm on dm.id = t.device_master_id
         join item i on i.id = dm.item_id
        where jsonb_array_length(t.steps) > 0
        order by 2 desc`);
    const wos = await db.rows<WoOption>(
      `select wo.id, wo.device_master_id as dm, wo.wo_no || ' · ' || wo.batch_no as label
         from work_order wo where wo.status not in ('DONE', 'CANCELLED')
        order by wo.issued_at desc limit 100`);
    const today = (await db.val<string>(`select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD')`)) ?? '';
    return { plans, tls, dms, wos, today, cal: await loadCalendar(db) };
  });

  /*
   * 고를 판은 시행 중인 것만 (사용자 2026-11-25 «제품 표준서 판있잖아.. 시행전인게 뜨면 안될거같은데??»).
   * 이미 그 판으로 잡아 둔 계획을 고칠 때는 그 판만 꼬리표와 함께 남긴다 - 빼면 저장할 때 판이 말없이 바뀐다.
   */
  const liveDms = d.dms.filter((o) => !o.note);
  const dmsFor = (keep: string | null) =>
    keep && !liveDms.some((o) => o.id === keep) ? [...liveDms, ...d.dms.filter((o) => o.id === keep)] : liveDms;
  const stepsOf = new Map(d.tls.map((t) => [t.dm, t.steps]));
  const planOf = new Map<string, Plan | null>(
    d.plans.map((p) => [p.id, planBatch(stepsOf.get(p.dm) ?? [], p.start_on, p.start_min, d.cal)]));
  /* 고른 계획: 주소의 것, 없으면 오늘 이후 가장 이른 것, 그것도 없으면 가장 나중 것 */
  const upcoming = [...d.plans].reverse().find((p) => p.start_on >= d.today);
  const cur = d.plans.find((p) => p.id === sp.id) ?? upcoming ?? d.plans[0] ?? null;
  const plan = cur ? planOf.get(cur.id) ?? null : null;
  const flags = plan ? plan.rows.flatMap((r) => r.flags) : [];
  /* 새 계획 칸: 지난 계획 + 7일, 번호 끝자리 + 1 */
  const last = d.plans[0];
  const suggest = last ? (() => {
    const m = last.label.match(/^(.*-)(\d+)$/);
    return {
      label: m ? m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') : '',
      start_on: addDays(last.start_on, 7), start_time: hhmm(last.start_min), dm: last.dm,
    };
  })() : undefined;

  return (
    <PageShell
      section="생산"
      title="일정"
      lede="배치 계획을 넣으면 그 판의 공정 시간표를 날짜에 얹습니다. 계획표라 인쇄해도 대장에 남지 않고 아무것도 잠기지 않습니다. 실제 시각 · 작업자 · 판정은 제조기록서에 적습니다."
      nav={<SubNav items={PRODUCTION_NAV} />}
    >
      <Panel title="배치 계획" note={`${d.plans.length}건 · 시간표는 설정 > 제품표준서 > 공정 시간표에서 고칩니다`}>
        {d.plans.length === 0 ? (
          <Empty hint={writable ? '아래 «새 계획» 에서 넣습니다.' : undefined}>배치 계획이 없습니다</Empty>
        ) : (
          <Table grow={0}>
            <thead><tr>
              <Th>배치 (예정)</Th><Th>제품표준서</Th><Th>시작</Th><Th>멸균 발송</Th><Th>끝 (멸균 보고서)</Th>
              <Th>확인할 곳</Th><Th>작업 지시</Th>
            </tr></thead>
            <tbody>
              {d.plans.map((p) => {
                const pl = planOf.get(p.id);
                const n = pl ? pl.rows.reduce((a, r) => a + r.flags.length, 0) : 0;
                return (
                  <RowLink key={p.id} href={`/production/plan?id=${p.id}`}>
                    <Td><span className="font-mono">{p.label}</span>{cur?.id === p.id && <> <Tag tone="info">보는 중</Tag></>}</Td>
                    <Td>{p.dm_label}</Td>
                    <Td nowrap><span className="tnum">{md(p.start_on)} {hhmm(p.start_min)}</span></Td>
                    <Td nowrap>{pl ? <span className="tnum">{md(addDays(p.start_on, dayIndex(pl.sendEnd)))} {hhmm(pl.sendEnd)}</span> : '시간표 없음'}</Td>
                    <Td nowrap>{pl ? <span className="tnum">{md(addDays(p.start_on, dayIndex(pl.last)))}</span> : ''}</Td>
                    <Td>{n ? <Tag tone="warn">{n}건</Tag> : '없음'}</Td>
                    <Td>{p.wo_no ? <span className="font-mono">{p.wo_no}</span> : '아직 없음'}</Td>
                  </RowLink>
                );
              })}
            </tbody>
          </Table>
        )}
        {writable && (
          <div className="border-t border-line-soft">
            <p className="px-4 pt-3 text-xs font-semibold text-ink">새 계획</p>
            <PlanForm dms={liveDms} wos={d.wos} suggest={suggest} />
          </div>
        )}
      </Panel>

      {cur && (
        <Panel title={`${cur.label} 일정표`}
               note={`${cur.dm_label} 공정 시간표 기준${cur.wo_no ? ` · 작업 지시 ${cur.wo_no}` : ''}${cur.note ? ` · ${cur.note}` : ''}`}
               /* 계획 지우기는 판 머리에 (사용자 2026-11-25 «배치 계획 삭제는 불가능한가?» - 전에는 12일치 공정표 맨 아래에 있었다) */
               action={(writable || plan) && (
                 <span className="inline-flex items-center gap-3">
                   {writable && <DeletePlan id={cur.id} label={cur.label} />}
                   {plan && <Link href={`/print/batch-plan/${cur.id}`} className="btn-ghost">일정표 인쇄</Link>}
                 </span>
               )}>
          {!plan ? (
            <Empty hint="설정 > 제품표준서 > 공정 시간표에서 이 판의 시간표를 먼저 만듭니다.">이 판에는 공정 시간표가 없습니다</Empty>
          ) : (
            <>
              <dl className="qd-grid-kpi px-4 pt-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                {[
                  ['시작', `${md(cur.start_on)} ${hhmm(cur.start_min)}`],
                  ['멸균 발송', `${md(addDays(cur.start_on, dayIndex(plan.sendEnd)))} ${hhmm(plan.sendEnd)}`],
                  ['멸균 보고서 수령', md(addDays(cur.start_on, dayIndex(plan.last)))],
                  ['전체 기간', `${dayIndex(plan.last) + 1}일`],
                  ['확인할 곳', `${flags.length}건`],
                ].map(([l, v]) => (
                  <div key={l} className="qd-kpi">
                    <dt className="qd-kpi-label" data-hangul="">{l}</dt>
                    <dd className="qd-kpi-value tnum">{v}</dd>
                  </div>
                ))}
              </dl>
              <ScheduleTable start={cur.start_on} plan={plan} cal={d.cal} />
            </>
          )}
          {writable && (
            <div className="border-t border-line-soft">
              <PlanForm dms={dmsFor(cur.dm)} wos={d.wos} value={{
                id: cur.id, label: cur.label, dm: cur.dm, start_on: cur.start_on,
                start_time: hhmm(cur.start_min), wo: cur.wo, note: cur.note,
              }} />
            </div>
          )}
        </Panel>
      )}

      {d.plans.length > 0 && (
        <Panel title="달력" note="손작업이 있는 날에 공정 번호, 대기만 이어지는 날에 «대기». 회색 칸은 휴무일">
          <MonthGrid plans={d.plans} planOf={planOf} cal={d.cal} today={d.today} />
        </Panel>
      )}

      <Panel title="근무 달력" note="근무 요일 · 시각 · 점심 · 공휴일. 모든 배치 일정이 따릅니다">
        {writable ? (
          <CalendarForm value={{
            workdays: d.cal.workdays, day_start: hhmm(d.cal.dayStart), day_end: d.cal.dayEnd >= DAY ? '23:59' : hhmm(d.cal.dayEnd),
            lunch: d.cal.lunch, skip_off: d.cal.skipOff, holidays: d.cal.holidays.join(', '),
          }} />
        ) : (
          <p className="px-4 py-3 text-sm">
            {d.cal.workdays.map((w) => ['일', '월', '화', '수', '목', '금', '토'][w]).join(' · ')} ·
            {' '}{hhmm(d.cal.dayStart)}~{hhmm(d.cal.dayEnd)}{d.cal.lunch ? ' · 점심 12~13시' : ''}
            {d.cal.holidays.length ? ` · 공휴일 ${d.cal.holidays.join(', ')}` : ''}
          </p>
        )}
      </Panel>
    </PageShell>
  );
}

/* 날짜별 일정표. 그날 이어지는 대기는 «계속» 줄로 */
function ScheduleTable({ start, plan, cal }: { start: string; plan: Plan; cal: WorkCalendar }) {
  const maxK = dayIndex(plan.last);
  const body: React.ReactNode[] = [];
  for (let k = 0; k <= maxK; k++) {
    const date = addDays(start, k);
    const rs = plan.rows.filter((r) => dayIndex(r.s) === k);
    const cont = carried(plan, k);
    const off = isOff(date, cal);
    body.push(
      <tr key={`d${k}`} className="bg-surface-sub">
        <td colSpan={5} className={`td font-semibold ${off ? 'text-danger' : 'text-ink'}`}>
          {md(date)} · {k + 1}일차{off ? ' · 휴무' : ''}
        </td>
      </tr>);
    if (!rs.length && !cont.length) {
      body.push(<tr key={`e${k}`}><td className="td text-muted" colSpan={5}>작업 없음</td></tr>);
    }
    for (const r of cont) {
      body.push(
        <tr key={`c${k}-${r.x.id}`} className="text-muted">
          <td className="td whitespace-nowrap">계속</td>
          <td className="td">{r.x.p}</td>
          <td className="td">{r.x.n} 진행 중</td>
          <td className="td whitespace-nowrap tnum">~{md(addDays(start, dayIndex(r.e)))} {hhmm(r.e)}</td>
          <td className="td" />
        </tr>);
    }
    for (const r of rs) {
      const endTxt = dayIndex(r.e) === k ? hhmm(r.e) : `${md(addDays(start, dayIndex(r.e)))} ${hhmm(r.e)}`;
      body.push(
        <tr key={r.x.id}>
          <td className="td whitespace-nowrap tnum">{hhmm(r.s)}~{endTxt}</td>
          <td className="td whitespace-nowrap">
            <i className="mr-1.5 inline-block size-2.5 rounded-sm align-middle" style={{ background: procColor(r.x.p) }} />{r.x.p}
          </td>
          <td className="td">{r.x.n}{r.x.k !== 'work' && <span className="text-muted"> ({KIND_LABEL[r.x.k]})</span>}</td>
          <td className="td whitespace-nowrap tnum">{dur(r.eff)}</td>
          <td className="td">
            {r.x.m}
            {r.flags.map((f, i) => (
              <span key={i} className={`block ${f.level === 'r' ? 'text-danger' : 'text-warn'}`}>{f.text}</span>
            ))}
          </td>
        </tr>);
    }
  }
  return (
    <Table grow={3}>
      <thead><tr><Th>시간</Th><Th>공정</Th><Th>작업</Th><Th>소요</Th><Th>비고</Th></tr></thead>
      <tbody>{body}</tbody>
    </Table>
  );
}

/* 여러 배치를 한 달력에. 월요일부터 */
function MonthGrid({ plans, planOf, cal, today }: {
  plans: PlanRowDb[]; planOf: Map<string, Plan | null>; cal: WorkCalendar; today: string;
}) {
  const live = plans.filter((p) => planOf.get(p.id));
  if (!live.length) return <Empty>시간표가 있는 계획이 없습니다</Empty>;
  const first = live.map((p) => p.start_on).sort()[0];
  const lastDay = live.map((p) => addDays(p.start_on, dayIndex(planOf.get(p.id)!.last))).sort().at(-1)!;
  const st0 = addDays(first, -((weekday(first) + 6) % 7));
  const n = Math.min(70, Math.ceil((daysBetween(st0, lastDay) + 1) / 7) * 7);
  const cells = Array.from({ length: n }, (_, c) => addDays(st0, c));
  return (
    <div className="grid grid-cols-7 gap-1 px-4 py-3 text-xs">
      {['월', '화', '수', '목', '금', '토', '일'].map((w) => (
        <div key={w} className="text-center font-semibold text-muted">{w}</div>
      ))}
      {cells.map((date) => {
        const items = live.flatMap((p) => {
          const pl = planOf.get(p.id)!;
          const k = daysBetween(p.start_on, date);
          if (k < 0) return [];
          const procs = [...new Set(pl.rows.filter((r) => isHands(r.x) && dayIndex(r.s) === k).map((r) => r.x.p))];
          if (procs.length) return [{ p, text: `${p.label} ${procs.join('·')}`, color: procColor(procs[0]), wait: false }];
          const waiting = pl.rows.some((r) => !isHands(r.x) && dayIndex(r.s) <= k && dayIndex(r.e - 1) >= k);
          return waiting ? [{ p, text: `${p.label} 대기`, color: '', wait: true }] : [];
        });
        const off = isOff(date, cal);
        return (
          <div key={date} className={`min-h-16 rounded-md border p-1.5 ${off ? 'bg-surface-sub' : ''} ${date === today ? 'border-info' : 'border-line'}`}>
            <b className="tnum">{Number(date.slice(5, 7))}/{Number(date.slice(8))}</b>
            {items.map((x) => (
              <Link key={x.p.id} href={`/production/plan?id=${x.p.id}`}
                    className={`block truncate ${x.wait ? 'text-muted' : 'text-ink'}`}>
                {!x.wait && <i className="mr-1 inline-block size-2 rounded-sm" style={{ background: x.color }} />}{x.text}
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}

