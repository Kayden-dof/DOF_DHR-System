'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { FormState } from '@/lib/forms';
import { Msg } from '@/components/ui';
import {
  DAY, KINDS, KIND_LABEL, KIND_NOTE, LUNCH, at, dur, endOf, hhmm, issues, procColor, pushAfter,
  rangeText, span, summary, toMin, dayIndex, type Step, type StepKind, type WorkCalendar,
} from '@/lib/timeline';
import { saveTimeline } from './actions';
import s from './timeline.module.css';

/* ---------------------------------------------------------------------------
   공정 시간표 편집 (0137 · 사용자 2026-11-19)

   «DX2401 공정 타임라인» 아티팩트를 옮겼다. 막대를 끌면 시작이, 오른쪽 끝을
   끌면 소요가 5분 단위로 바뀐다. 앞 작업이 끝나기 전에 시작하는 뒤 작업은
   자동으로 민다(끌 수 있다). 고친 것은 «저장» 을 눌러야 DB 에 간다.

   근무시간 · 점심은 회사 근무 달력(생산 > 일정)을 따른다. 퇴근 시간을 접으면
   하루가 근무시간 폭만큼만 그려지고 밤은 빗금 한 줄이 된다.
--------------------------------------------------------------------------- */

interface Op { seq: string; code: string; name: string }

const LW = 280;
const HEAD = 56;
const ZOOMS = [20, 40, 80, 120, 160, 200];

function mapper(px: number, cal: WorkCalendar, fold: boolean, days: number) {
  const ws = cal.dayStart, we = cal.dayEnd;
  if (!fold) {
    return {
      G: 0, Dw: DAY * px, W: days * DAY * px,
      X: (m: number) => m * px,
      M: (x: number) => Math.max(0, x / px),
      d0: (d: number) => Math.max(0, (d * DAY + ws - 30) * px),
    };
  }
  const G = 22, Dw = (we - ws) * px + G;
  return {
    G, Dw, W: days * Dw,
    X: (m: number) => {
      const d = Math.floor(m / DAY), r = m - d * DAY;
      return d * Dw + G + (Math.min(we, Math.max(ws, r)) - ws) * px;
    },
    M: (x: number) => {
      const d = Math.max(0, Math.floor(x / Dw)), off = x - d * Dw - G;
      return d * DAY + ws + Math.min(we - ws, Math.max(0, off / px));
    },
    d0: (d: number) => d * Dw,
  };
}

export default function TimelineEditor({
  dm, ops, initial, basis: basis0, cal, writable,
}: {
  dm: string;
  ops: Op[];
  initial: Step[];
  basis: string;
  cal: WorkCalendar;
  writable: boolean;
}) {
  const [steps, setSteps] = useState<Step[]>(initial);
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [autoPush, setAutoPush] = useState(true);
  const [zoom, setZoom] = useState(120);
  const [fold, setFold] = useState(true);
  const [basis, setBasis] = useState(basis0);
  const [msg, setMsg] = useState<FormState>({});
  const [live, setLive] = useState('');
  const [pending, start] = useTransition();
  const hist = useRef<string[]>([]);
  const drag = useRef<{ id: string; mode: 'move' | 'size'; x0: number; s: number; d: number; moved: boolean } | null>(null);
  const gRef = useRef<HTMLDivElement>(null);

  const days = Math.max(1, Math.ceil((Math.max(0, ...steps.map(endOf)) + 60) / DAY));
  const px = zoom / 60;
  const P = useMemo(() => mapper(px, cal, fold, days), [px, cal, fold, days]);
  const sum = summary(steps, cal);
  const opName = (p: string) => ops.find((o) => o.seq === p)?.name ?? '';

  /* 저장하지 않은 채 떠나면 묻는다 */
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const snap = () => {
    hist.current.push(JSON.stringify(steps));
    if (hist.current.length > 80) hist.current.shift();
  };
  const commit = (next: Step[]) => {
    setSteps(autoPush ? pushAfter(next) : next);
    setDirty(true);
    setMsg({});
  };
  const undo = () => {
    const prev = hist.current.pop();
    if (!prev) return;
    setSteps(JSON.parse(prev));
    setDirty(true);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z'
          && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement?.tagName ?? ''))) {
        e.preventDefault();
        undo();
      }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });

  /* --- 끌기 ------------------------------------------------------------- */
  const down = (e: React.PointerEvent<HTMLDivElement>, x: Step) => {
    setSel(x.id);
    if (!writable) return;
    const onHandle = (e.target as HTMLElement).dataset.handle === '1' && e.currentTarget.offsetWidth >= 28;
    drag.current = { id: x.id, mode: onHandle || e.altKey ? 'size' : 'move', x0: e.clientX, s: x.s, d: x.d, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g) return;
    const dx = e.clientX - g.x0;
    if (!g.moved && Math.abs(dx) < 3) return;
    if (!g.moved) { snap(); g.moved = true; }
    const r5 = (m: number) => Math.round(m / 5) * 5;
    setSteps((T) => T.map((x) => {
      if (x.id !== g.id) return x;
      if (g.mode === 'move') return { ...x, s: Math.max(0, r5(P.M(P.X(g.s) + dx))) };
      return { ...x, d: Math.max(5, r5(P.M(P.X(g.s + g.d) + dx)) - g.s) };
    }));
  };
  const up = () => {
    const g = drag.current;
    drag.current = null;
    setLive('');
    if (g?.moved) {
      setSteps((T) => (autoPush ? pushAfter(T) : T));
      setDirty(true);
      setMsg({});
    }
  };
  useEffect(() => {
    const x = steps.find((t) => t.id === sel);
    if (x && drag.current?.moved) setLive(`${at(x.s)} 시작 · ${dur(x.d)}`);
  }, [steps, sel]);

  /* --- 편집 ------------------------------------------------------------- */
  const x = sel ? steps.find((t) => t.id === sel) ?? null : null;
  const apply = (form: HTMLFormElement) => {
    if (!x) return;
    const f = new FormData(form);
    const n = String(f.get('n') ?? '').trim() || x.n;
    const day = Math.max(1, Number(f.get('day')) || 1);
    const time = String(f.get('time') ?? '') || '08:00';
    const num = (k: string) => (String(f.get(k) ?? '') === '' ? null : Math.max(0, Math.round(Number(f.get(k)))));
    const next: Step = {
      ...x, n,
      p: String(f.get('p') ?? x.p),
      k: String(f.get('k') ?? x.k) as StepKind,
      s: (day - 1) * DAY + toMin(time),
      d: Math.max(1, Math.round(Number(f.get('d')) || x.d)),
      mn: num('mn'), mx: num('mx'),
      a: f.getAll('a').map(String).filter((id) => id !== x.id),
      m: String(f.get('m') ?? ''),
    };
    if (next.mn != null && next.mx != null && next.mn > next.mx) {
      setMsg({ error: '허용 최소가 최대보다 큽니다' });
      return;
    }
    snap();
    commit(steps.map((t) => (t.id === x.id ? next : t)));
  };
  const remove = () => {
    if (!x) return;
    snap();
    commit(steps.filter((t) => t.id !== x.id).map((t) => ({ ...t, a: t.a.filter((i) => i !== x.id) })));
    setSel(null);
  };
  const add = () => {
    snap();
    const id = `n${Date.now().toString(36)}`;
    const base = x;
    commit([...steps, {
      id, p: base ? base.p : ops[0]?.seq ?? '01', n: '새 작업', k: 'work',
      s: base ? endOf(base) : cal.dayStart, d: 15, mn: null, mx: null, a: base ? [base.id] : [], m: '',
    }]);
    setSel(id);
  };
  const save = () => {
    start(async () => {
      const r = await saveTimeline({ dm, steps, basis });
      setMsg(r);
      if (r.ok) setDirty(false);
    });
  };
  const goDay = (d: number) => gRef.current?.scrollTo({ left: P.d0(d), behavior: 'smooth' });
  const goStep = (id: string) => {
    setSel(id);
    requestAnimationFrame(() => {
      gRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    });
  };

  /* --- 그리기 ----------------------------------------------------------- */
  const tickStep = px * 60 >= 60 ? 60 : px * 60 >= 30 ? 120 : 180;
  const bg: React.ReactNode[] = [];
  const dayHead: React.ReactNode[] = [];
  const ticks: React.ReactNode[] = [];
  for (let d = 0; d < days; d++) {
    const o = d * DAY;
    if (fold) bg.push(<div key={`n${d}`} className={`${s.shade} ${s.night}`} style={{ left: d * P.Dw, width: P.G }} />);
    else {
      bg.push(<div key={`a${d}`} className={`${s.shade} ${s.off}`} style={{ left: P.X(o), width: cal.dayStart * px }} />);
      bg.push(<div key={`b${d}`} className={`${s.shade} ${s.off}`} style={{ left: P.X(o + cal.dayEnd), width: (DAY - cal.dayEnd) * px }} />);
    }
    if (cal.lunch) {
      bg.push(<div key={`l${d}`} className={`${s.shade} ${s.lunch}`}
                   style={{ left: P.X(o + LUNCH[0]), width: P.X(o + LUNCH[1]) - P.X(o + LUNCH[0]) }} />);
    }
    dayHead.push(<div key={d} className={s.dayb} style={{ left: fold ? d * P.Dw : P.X(o), width: P.Dw }}>{d + 1}일차</div>);
    const from = fold ? cal.dayStart : 0, to = fold ? cal.dayEnd : DAY;
    for (let m = Math.ceil(from / tickStep) * tickStep; m < to; m += tickStep) {
      if (!fold && m === 0) continue;
      ticks.push(<div key={`${d}-${m}`} className={s.tick} style={{ left: P.X(o + m) }}>{hhmm(m)}</div>);
      bg.push(<div key={`v${d}-${m}`} className={s.vline} style={{ left: P.X(o + m) }} />);
    }
  }

  const groups = ops.map((op) => ({
    op, items: steps.filter((t) => t.p === op.seq).sort((a, b) => a.s - b.s || a.id.localeCompare(b.id)),
  })).filter((g) => g.items.length);
  const orphans = steps.filter((t) => !ops.some((o) => o.seq === t.p));
  const allIssues = steps.map((t) => [t, issues(steps, t, cal)] as const).filter(([, i]) => i.length);

  return (
    <div>
      <dl className="qd-grid-kpi" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {[
          ['멸균 발송까지', dur(sum.elapsed)],
          ['발송 날', `${sum.sendDay}일차`],
          ['손작업 합계', dur(sum.hands)],
          ['범위 밖', String(sum.bad)],
          ['순서 · 시간 확인', String(sum.late)],
        ].map(([l, v]) => (
          <div key={l} className="qd-kpi">
            <dt className="qd-kpi-label" data-hangul="">{l}</dt>
            <dd className="qd-kpi-value tnum">{v}</dd>
          </div>
        ))}
      </dl>

      <div className={s.bar}>
        {writable && <>
          <button type="button" className="btn-ghost" onClick={undo} disabled={!hist.current.length}>되돌리기</button>
          <button type="button" className="btn-ghost" onClick={add}>작업 추가</button>
          <label className={s.chk}><input type="checkbox" checked={autoPush} onChange={(e) => setAutoPush(e.target.checked)} /> 뒤 작업 자동 밀기</label>
        </>}
        <label className={s.chk}>확대
          <select className="input" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: 'auto' }}>
            {ZOOMS.map((z) => <option key={z} value={z}>{z} px/시간</option>)}
          </select>
        </label>
        <label className={s.chk}><input type="checkbox" checked={fold} onChange={(e) => setFold(e.target.checked)} /> 퇴근 시간 접기</label>
        <span className={s.chk}>
          {Array.from({ length: days }, (_, d) => (
            <button key={d} type="button" className="qd-text-action" onClick={() => goDay(d)}>{d + 1}일</button>
          ))}
        </span>
        {writable && (
          <>
            <span className={s.status} aria-live="polite">{live || (dirty ? '저장 안 된 변경 있음' : '')}</span>
            <button type="button" className="btn-primary" onClick={save} disabled={pending || !dirty}>
              {pending ? '저장 중' : '시간표 저장'}
            </button>
          </>
        )}
      </div>
      {writable && dirty && (
        <p className="pb-2 text-xs text-muted">
          끌고 고친 것은 «시간표 저장» 을 눌러야 남습니다. 저장한 시간표는 계획이라 서면 대조 확인을 풀지 않고,
          이전 값은 감사추적에 남습니다.
        </p>
      )}
      <Msg state={msg} className="mb-2" />

      <div className={s.legend}>
        {KINDS.map((k) => (
          <span key={k}>
            <i className={s.sw} style={k === 'prep' ? { border: '2px solid #555' }
              : k === 'wait' ? { background: 'repeating-linear-gradient(135deg,#888 0 4px,#ddd 4px 7px)' }
              : { background: '#555', opacity: k === 'ext' ? 0.45 : 1 }} />
            {KIND_LABEL[k]} ({KIND_NOTE[k]})
          </span>
        ))}
        <span>막대 아래 옅은 줄 = 허용범위</span>
        <span className={s.r}>빨간 테두리 = 범위 밖</span>
        <span className={s.a}>주황 테두리 = 앞 작업보다 먼저 · 근무시간 밖</span>
        <span>근무 {hhmm(cal.dayStart)}~{hhmm(cal.dayEnd)}{cal.lunch ? ' · 점심 12~13시' : ''} (생산 &gt; 일정의 근무 달력)</span>
      </div>

      <div className={s.body}>
        <div className={s.gantt} ref={gRef}>
          <div className={s.grid}>
            <div className={s.head}>
              <div className={s.row}>
                <div className={s.lab}>공정 · 작업</div>
                <div className={s.track} style={{ width: P.W }}>{dayHead}</div>
              </div>
              <div className={s.row}>
                <div className={s.lab}>{fold ? '근무시간만 (퇴근 시간 접음)' : '하루 24시간'}</div>
                <div className={s.track} style={{ width: P.W }}>{ticks}</div>
              </div>
            </div>
            <div className={s.bg} style={{ top: HEAD, left: LW, width: P.W }}>{bg}</div>

            {groups.map(({ op, items }) => {
              const c = procColor(op.seq);
              const s0 = Math.min(...items.map((t) => t.s)), e0 = Math.max(...items.map(endOf));
              return (
                <div key={op.seq}>
                  <div className={`${s.row} ${s.grp}`}>
                    <div className={s.lab} title={`${op.code} ${op.name}`}>
                      <span className={s.nm}><i className={s.sw} style={{ background: c }} />{op.seq} {op.name}</span>
                      <span className={s.tm}>{dayIndex(s0) + 1}일차 {span(s0, e0)}</span>
                    </div>
                    <div className={s.track} style={{ width: P.W }}>
                      <div className={s.span} style={{ left: P.X(s0), width: Math.max(4, P.X(e0) - P.X(s0)), background: c }} />
                    </div>
                  </div>
                  {items.map((t) => {
                    const iss = issues(steps, t, cal);
                    const L = P.X(t.s), w = Math.max(8, P.X(endOf(t)) - L);
                    const txt = `${hhmm(t.s)}~${hhmm(endOf(t))} · ${dur(t.d)}`;
                    const inside = w >= 150, mid = w >= 60;
                    const cls = [s.task, s[t.k], !writable && s.ro, sel === t.id && s.sel,
                      iss.some((i) => i.level === 'r') ? s.bad : iss.length ? s.late : ''].filter(Boolean).join(' ');
                    const rg = t.mn != null || t.mx != null
                      ? { a: t.s + (t.mn ?? 0), b: t.s + (t.mx ?? Math.max(t.mn ?? 0, t.d) * 1.25) } : null;
                    return (
                      <div key={t.id} className={s.row}>
                        <div className={s.lab} title={t.m ? `${t.n} · ${t.m}` : t.n}>
                          <span className={s.nm}>{t.n}</span>
                          <span className={s.tm}>
                            {dayIndex(t.s) + 1}일차 {span(t.s, endOf(t))} · {dur(t.d)}
                            {rangeText(t) && ` (기준 ${rangeText(t)})`}
                          </span>
                        </div>
                        <div className={s.track} style={{ width: P.W }}>
                          {rg && <div className={s.range} style={{ left: P.X(rg.a), width: Math.max(2, P.X(rg.b) - P.X(rg.a)), background: c }} />}
                          <div data-id={t.id} className={cls}
                               style={{ left: L, width: w, ...(t.k === 'prep' ? { borderColor: c } : { backgroundColor: c }) }}
                               title={`${t.n} · ${at(t.s)} · ${dur(t.d)}`}
                               onPointerDown={(e) => down(e, t)} onPointerMove={move}
                               onPointerUp={up} onPointerCancel={up}>
                            {inside ? txt : mid ? dur(t.d) : ''}
                            {writable && <span className={s.handle} data-handle="1" />}
                          </div>
                          {!inside && (
                            <div className={s.out} style={{ left: L + w + 6 }}>{mid ? `${hhmm(t.s)}~${hhmm(endOf(t))}` : txt}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <aside className={s.side}>
          {x ? (
            writable ? (
              <form key={x.id + x.s + x.d} onSubmit={(e) => { e.preventDefault(); apply(e.currentTarget); }}>
                <h3>{x.p} {x.n}</h3>
                <div className={s.f}>
                  <label htmlFor="tl-n">이름</label>
                  <input id="tl-n" name="n" className="input" defaultValue={x.n} maxLength={80} />
                  <label htmlFor="tl-p">공정</label>
                  <select id="tl-p" name="p" className="input" defaultValue={x.p}>
                    {ops.map((o) => <option key={o.seq} value={o.seq}>{o.seq} {o.name}</option>)}
                  </select>
                  <label htmlFor="tl-k">구분</label>
                  <select id="tl-k" name="k" className="input" defaultValue={x.k}>
                    {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                  <span>시작</span>
                  <div className={s.two}>
                    <input name="day" type="number" min={1} className="input" aria-label="일차" defaultValue={dayIndex(x.s) + 1} />
                    <input name="time" type="time" className="input" aria-label="시각" defaultValue={hhmm(x.s)} />
                  </div>
                  <label htmlFor="tl-d">소요(분)</label>
                  <input id="tl-d" name="d" type="number" min={1} step={5} className="input" defaultValue={x.d} />
                  <span>범위(분)</span>
                  <div className={s.two}>
                    <input name="mn" type="number" min={0} className="input" placeholder="최소" aria-label="허용 최소" defaultValue={x.mn ?? ''} />
                    <input name="mx" type="number" min={0} className="input" placeholder="최대" aria-label="허용 최대" defaultValue={x.mx ?? ''} />
                  </div>
                  <label htmlFor="tl-a">앞 작업</label>
                  <select id="tl-a" name="a" multiple size={5} className="input" defaultValue={x.a} style={{ height: 'auto' }}>
                    {steps.filter((t) => t.id !== x.id).sort((a, b) => a.s - b.s)
                      .map((t) => <option key={t.id} value={t.id}>{t.p} {t.n}</option>)}
                  </select>
                  <label htmlFor="tl-m">메모</label>
                  <textarea id="tl-m" name="m" className="input" rows={3} defaultValue={x.m} style={{ height: 'auto' }} />
                </div>
                <p className={s.note}>{at(x.s)} ~ {at(endOf(x))} ({dur(x.d)}) · {opName(x.p)}</p>
                <div className={`${s.two} mt-2`}>
                  <button type="submit" className="btn-primary">적용</button>
                  <button type="button" className="btn-ghost" onClick={remove}>지우기</button>
                  <button type="button" className="btn-quiet" onClick={() => setSel(null)}>닫기</button>
                </div>
                <p className={s.note}>적용 · 지우기는 화면 안에서만 바뀝니다. 되돌리기로 돌릴 수 있고, «시간표 저장» 을 눌러야 남습니다.</p>
              </form>
            ) : (
              <div>
                <h3>{x.p} {x.n}</h3>
                <p>{KIND_LABEL[x.k]} · {at(x.s)} ~ {at(endOf(x))} · {dur(x.d)}</p>
                {rangeText(x) && <p>허용 {rangeText(x)}</p>}
                {x.m && <p className={s.note}>{x.m}</p>}
              </div>
            )
          ) : (
            <>
              <h3>작업 선택</h3>
              <p className={s.note}>
                막대를 누르면 여기서 이름 · 시작 · 소요 · 허용범위 · 앞 작업 · 메모를 고칩니다.
                {writable && ' 막대를 끌면 시작이, 오른쪽 끝을 끌면 소요가 5분 단위로 바뀝니다. 짧은 막대는 Alt 를 누른 채 끌어 소요를 바꿉니다.'}
              </p>
            </>
          )}
          {writable && (
            <div className="mt-3">
              <label className="label" htmlFor="tl-basis">근거 문서</label>
              <input id="tl-basis" className="input" value={basis} maxLength={200}
                     onChange={(e) => { setBasis(e.target.value); setDirty(true); }}
                     placeholder="예: 작업표준서 개정안 v5 · 제조기록서 개정안 v16" />
            </div>
          )}
          <div className={s.warns}>
            <b>확인할 곳 {allIssues.reduce((a, [, i]) => a + i.length, 0)}건</b>
            <ul>
              {allIssues.flatMap(([t, is]) => is.map((i, k) => (
                <li key={`${t.id}-${k}`} className={s[i.level]}>
                  <button type="button" className={s.linkish} onClick={() => goStep(t.id)}>{t.p} {t.n}</button>: {i.text}
                </li>
              )))}
            </ul>
            {orphans.length > 0 && (
              <p className={s.r}>이 제품표준서에 없는 공정의 작업 {orphans.length}개는 그리지 못했습니다.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
