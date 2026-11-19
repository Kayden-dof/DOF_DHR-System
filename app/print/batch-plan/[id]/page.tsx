import { notFound } from 'next/navigation';
import { requireUser, blocksScreen } from '@/lib/session';
import Denied from '@/components/denied';
import { withActor } from '@/lib/db';
import { loadCalendar, loadDmHead } from '@/lib/timeline-db';
import {
  DAY, LUNCH, addDays, carried, dayIndex, dur, hhmm, isHands, isOff, md, planBatch, procColor, rangeText,
  workDays, DOW, weekday, type PlanRow, type Step,
} from '@/lib/timeline';
import PrintBar from '../../docs-check/print-bar';
import b from '../book.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: '배치 작업 일정표' };

/* ---------------------------------------------------------------------------
   배치 작업 일정표 (0137 · 사용자 2026-11-19)

   «DX2401 공정 타임라인» 아티팩트의 일정표 PDF 를 옮겼다. 표지 한 장(전체 흐름 ·
   작업일 목록 · 승인 칸) + 손작업이 있는 날마다 시트(그날 작은 간트 · 할 일 표). 할 일
   표는 메모 한 칸과 맨 끝 확인 □ 를 비워 둔다 - 실제 시각 · 작업자는 제조기록서에 적는다
   (아티팩트 2026-11-19 개정).

   계획표다. 제조기록서가 아니므로 인쇄 대장에 남지 않고 아무것도 잠그지 않는다.
   몇 번을 뽑아도 바뀌는 것이 없다.
--------------------------------------------------------------------------- */

const ROW_H = 41;

export default async function BatchPlanPrint({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (blocksScreen(user, '/production/plan')) return <Denied what="이 인쇄물" need="생산관리자 또는 시스템관리자" />;
  const { id } = await params;

  const d = await withActor(user.id, async (db) => {
    const p = await db.one<{
      id: string; label: string; dm: string; start_on: string; start_min: number; wo_no: string | null; note: string;
    }>(
      `select p.id, p.label, p.device_master_id as dm, to_char(p.start_on, 'YYYY-MM-DD') as start_on,
              p.start_min, wo.wo_no, p.note
         from batch_plan p left join work_order wo on wo.id = p.work_order_id
        where p.id::text = $1`, [id]);
    if (!p) return null;
    const tl = await db.one<{ steps: Step[]; basis: string }>(
      `select steps, basis from dmr_timeline where device_master_id = $1`, [p.dm]);
    return { p, tl, head: await loadDmHead(db, p.dm), cal: await loadCalendar(db) };
  });
  if (!d || !d.head) notFound();
  const { p, head, cal } = d;
  const steps = (d.tl?.steps ?? []).map((x) => ({ ...x, a: x.a ?? [], m: x.m ?? '' }));
  const plan = planBatch(steps, p.start_on, p.start_min, cal);
  if (!plan) notFound();

  const opName = (q: string) => head.ops.find((o) => o.seq === q)?.name ?? '';
  const procs = head.ops.map((o) => o.seq).filter((q) => plan.rows.some((r) => r.x.p === q));
  const ws = cal.dayStart, we = cal.dayEnd, spanMin = we - ws;
  const maxK = dayIndex(plan.last);
  const nD = maxK + 1;
  const colW = 100 / nD;
  const kOf = dayIndex;
  const inDay = (m: number) => m - kOf(m) * DAY;
  const xp = (m: number) => (kOf(m) + (Math.min(we, Math.max(ws, inDay(m))) - ws) / spanMin) * colW;
  const hands = plan.rows.filter((r) => isHands(r.x));
  const handsMin = hands.reduce((a, r) => a + r.x.d, 0);
  const days = workDays(plan);
  const flags = plan.rows.flatMap((r) => r.flags.map((f) => `${r.x.p} ${r.x.n}: ${f.text}`));
  const dateOf = (k: number) => addDays(p.start_on, k);

  const top = (
    <div className={b.top}>
      <span><b>{head.product}</b> · 배치 작업 일정표</span>
      <span>배치 <b>{p.label}</b></span>
    </div>
  );

  /* --- 표지 ---------------------------------------------------------------- */
  const pages: React.ReactNode[] = [];
  pages.push(
    <>
      {top}
      <div className={b.sg}><div>승인</div></div>
      <div className={b.h1}>{p.label}</div>
      <div className={b.st}>배치 작업 일정표 · {head.label} 공정 시간표 기준{d.tl?.basis ? ` (${d.tl.basis})` : ''}</div>
      <div className={b.kp}>
        <div className={b.ac}><span>시작</span><b>{md(p.start_on)} {hhmm(p.start_min)}</b></div>
        <div><span>멸균 발송</span><b>{md(dateOf(kOf(plan.sendEnd)))} {hhmm(plan.sendEnd)}</b></div>
        <div><span>멸균 성적서 수령</span><b>{md(dateOf(kOf(plan.last)))}</b></div>
        <div><span>전체 기간 · 작업일</span><b>{nD}일 · {days.length}일</b></div>
        <div><span>손작업 합계</span><b>{dur(handsMin)}</b></div>
      </div>
      <div className={b.fill}>
        <div>작업지시번호<span>{p.wo_no ?? 'WO-'}</span></div>
        <div>투입 원재료<span style={{ minWidth: 70 }} /> 장</div>
        <div>배치 책임자<span /></div>
      </div>
      <div className={b.gh}>전체 흐름<i>진한 막대 = 손작업, 옅은 막대 = 대기 · 외부 멸균, 회색 칸 = 휴무일, 하루 폭 = 근무시간 {hhmm(ws)}~{hhmm(we)}</i></div>
      <div className={b.bg}>
        <div className={b.dh}>
          {Array.from({ length: nD }, (_, k) => {
            const dt = dateOf(k);
            return <div key={k} className={isOff(dt, cal) ? b.we : ''}><b>{Number(dt.slice(5, 7))}/{Number(dt.slice(8))}</b>{DOW[weekday(dt)]}</div>;
          })}
        </div>
        {procs.map((q) => (
          <div key={q} className={b.rw}>
            <div className={b.rl}><i style={{ background: procColor(q) }} />{q} {opName(q)}</div>
            <div className={b.rt}>
              {Array.from({ length: nD }, (_, k) => (
                <div key={k} className={`${b.cl} ${isOff(dateOf(k), cal) ? b.we : ''}`} style={{ left: `${k * colW}%`, width: `${colW}%` }} />
              ))}
              {plan.rows.filter((r) => r.x.p === q).map((r) => {
                const a = xp(r.s), c = xp(r.e);
                if (c - a < 0.05 && r.x.k === 'wait') return null;
                return <div key={r.x.id} className={`${b.seg} ${r.x.k === 'wait' || r.x.k === 'ext' ? b.w : ''}`}
                            style={{ left: `${a}%`, width: `${Math.max(0.35, c - a)}%`, background: procColor(q) }} />;
              })}
            </div>
          </div>
        ))}
      </div>
      <div className={b.gh} style={{ marginTop: 14 }}>작업일 시트<i>시트를 마치면 □ 에 표시</i></div>
      <div className={b.dl}>
        {days.map((k) => {
          const rs = hands.filter((r) => kOf(r.s) === k);
          const s0 = Math.min(...rs.map((r) => r.s));
          const e0 = Math.max(...rs.map((r) => (kOf(r.e) === k ? r.e : r.s)));
          return (
            <div key={k}><i className={b.bx} /><b>{md(dateOf(k))}</b>
              <span>{[...new Set(rs.map((r) => r.x.p))].join('·')} · {hhmm(s0)}~{hhmm(e0)}</span></div>
          );
        })}
      </div>
      {flags.length > 0 && <div className={b.warnb}>확인할 곳: {flags.join(' / ')}</div>}
    </>,
  );

  /* --- 작업일 시트 ---------------------------------------------------------- */
  const row = (r: PlanRow, k: number) => {
    const eK = kOf(r.e);
    const waitish = r.x.k === 'wait' || r.x.k === 'ext';
    return (
      <tr key={r.x.id} className={waitish ? b.wt : ''}>
        <td className={b.c0}><i className={b.stripe} style={{ background: procColor(r.x.p) }} /></td>
        <td className={b.tm}><b>{hhmm(r.s)}</b><span>~ {eK === k ? hhmm(r.e) : `${md(dateOf(eK))} ${hhmm(r.e)}`}</span></td>
        <td className={b.pc} style={{ color: procColor(r.x.p) }}>{r.x.p}</td>
        <td className={b.nm}>
          <b>{r.x.n}
            {r.x.k === 'prep' && <span className={`${b.tg} ${b.pr}`} style={{ display: 'inline' }}>병행 준비</span>}
            {r.x.k === 'wait' && <span className={b.tg} style={{ display: 'inline' }}>대기</span>}
            {r.x.k === 'ext' && <span className={b.tg} style={{ display: 'inline' }}>외부</span>}
          </b>
          {r.flags.length ? <span className={b.fl}>! {r.flags.map((f) => f.text).join(' / ')}</span> : <span>{r.x.m}</span>}
        </td>
        <td className={b.cr}>{dur(r.eff)}{rangeText(r.x) && <span>기준 {rangeText(r.x)}</span>}</td>
        <td className={b.wr} />
        <td className={b.ce}><div className={b.bx2} /></td>
      </tr>
    );
  };
  const thead = (
    <>
      <colgroup>
        <col style={{ width: 12 }} /><col style={{ width: 96 }} /><col style={{ width: 46 }} /><col />
        <col style={{ width: 140 }} /><col style={{ width: 190 }} /><col style={{ width: 46 }} />
      </colgroup>
      <thead><tr>
        <th /><th>예정 시각</th><th>공정</th><th>작업</th><th>소요 · 기준</th><th>메모</th><th style={{ textAlign: 'center' }}>확인</th>
      </tr></thead>
    </>
  );
  for (const k of days) {
    const dt = dateOf(k);
    const rs = plan.rows.filter((r) => kOf(r.s) === k);
    const cont = carried(plan, k);
    const dayProcs = [...new Set(rs.map((r) => r.x.p))];
    const hrs = rs.filter((r) => isHands(r.x));
    const s0 = Math.min(...rs.map((r) => r.s));
    const e0 = Math.max(...rs.map((r) => (kOf(r.e) === k ? r.e : r.s)));
    const xd = (m: number) => (Math.min(we, Math.max(ws, m - k * DAY)) - ws) / spanMin * 100;
    const hoursAx: number[] = [];
    for (let h = Math.ceil(ws / 60) * 60; h <= we; h += 60) hoursAx.push(h);
    const first = Math.floor((794 - 58 - 82 - (dayProcs.length * 17 + 40) - (cont.length ? 24 : 0) - 26 - 46) / ROW_H);
    const more = Math.floor((794 - 58 - 46 - 26 - 46) / ROW_H);
    for (let i = 0, n = 0; i < rs.length || n === 0; n++) {
      const take = n === 0 ? first : more;
      const chunk = rs.slice(i, i + take);
      i += take;
      pages.push(
        <>
          {top}
          {n === 0 ? (
            <>
              <div className={b.dyh}>
                <div className={b.dd}>{Number(dt.slice(5, 7))}/{Number(dt.slice(8))}</div>
                <div className={b.dw}><b>{DOW[weekday(dt)]}요일</b>{k + 1}일차</div>
                <div className={b.ch}>
                  {dayProcs.map((q) => <span key={q} className={b.chip} style={{ background: procColor(q) }}>{q} {opName(q)}</span>)}
                </div>
                <div className={b.sm}>작업 <b>{hhmm(s0)} ~ {hhmm(e0)}</b><br />손작업 약 {dur(hrs.reduce((a, r) => a + r.x.d, 0))}</div>
              </div>
              <div className={b.mg}>
                {hoursAx.map((h) => <div key={`v${h}`} className={b.vl} style={{ left: `calc(92px + (100% - 102px) * ${(h - ws) / spanMin})` }} />)}
                {cal.lunch && <div className={b.lun} style={{ left: `calc(92px + (100% - 102px) * ${(LUNCH[0] - ws) / spanMin})`, width: `calc((100% - 102px) * ${60 / spanMin})` }} />}
                <div className={b.ax}>{hoursAx.map((h) => <span key={h} style={{ left: `${(h - ws) / spanMin * 100}%` }}>{String(h / 60).padStart(2, '0')}</span>)}</div>
                {dayProcs.map((q) => (
                  <div key={q} className={b.mr}>
                    <div className={b.ml} style={{ color: procColor(q) }}>{q} {opName(q)}</div>
                    {rs.filter((r) => r.x.p === q).map((r) => (
                      <div key={r.x.id} className={`${b.seg} ${r.x.k === 'wait' || r.x.k === 'ext' ? b.w : ''}`}
                           style={{ left: `${xd(r.s)}%`, width: `${Math.max(0.6, xd(r.e) - xd(r.s))}%`, background: procColor(q), opacity: r.x.k === 'prep' ? 0.65 : undefined }} />
                    ))}
                  </div>
                ))}
              </div>
              {cont.length > 0 && (
                <div className={b.ct}>이어서 진행 중: {cont.map((r, j) => (
                  <span key={r.x.id}>{j ? ', ' : ''}<b>{r.x.p} {r.x.n}</b> (~{md(dateOf(kOf(r.e)))} {hhmm(r.e)})</span>
                ))}</div>
              )}
            </>
          ) : (
            <div className={b.dyh} style={{ margin: '12px 0 8px' }}><div className={b.dw}><b>{md(dt)} · {k + 1}일차 (이어서)</b></div></div>
          )}
          <table className={b.tk}>{thead}<tbody>{chunk.map((r) => row(r, k))}</tbody></table>
        </>,
      );
    }
  }

  const N = pages.length;
  return (
    <>
      <PrintBar back={`/production/plan?id=${p.id}`} title={`${p.label} 배치 작업 일정표 · ${N}쪽 · 계획표라 대장에 남지 않습니다`} />
      {pages.map((body, i) => (
        <div key={i} className="sheet sheet--form relative mx-auto mb-4 shadow-sm print:mb-0 print:shadow-none">
          <div className={b.pg} style={{ height: '100%' }}>
            {body}
            <div className={b.foot}>
              <span>계획표입니다. 실제 시각 · 판정 · 서명은 제조기록서에 기록 · 회색 줄 = 대기 시간</span>
              <span>{i + 1} / {N}</span>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
