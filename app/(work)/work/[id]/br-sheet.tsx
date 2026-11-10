'use client';

/* ---------------------------------------------------------------------------
   제조기록서 칸 적기 (0132 · 사용자 2026-11-10)

   "지금 제조기록서 상에 체크와 적어야 하는 부분들은 모두 생산자가 체크 하거나
   기록 할수 있도록 작업기록지에 기능 구현해줄것"

   종이 제조기록서와 같은 모양을 그대로 보이고, 적어야 하는 칸을 누르면 그
   칸에 맞는 입력이 아래에 뜬다. 현장에는 키보드가 없다 - 고르기는 큰 단추,
   수치는 숫자판, 시각은 "지금" 단추로 찍는다. 적은 값은 바로 저장되고 종이에
   파란 글씨로 찍힌다. 일차를 마감하면 더 바뀌지 않는다 (DB 가 막는다).

   판정하지 않는다 - 허용범위 밖이어도 적힌 대로 둔다 (§1).
--------------------------------------------------------------------------- */
import { useEffect, useRef, useState, useTransition } from 'react';
import { FormBody } from '@/components/print-frame';
import NumPad from '@/components/num-pad';
import { optionBlank, type FormCell } from '@/lib/br-form';
import type { BrSheet } from '@/lib/br-sheet';
import { loadBrSheet, saveBrEntry } from '../actions';

const PX = 4 / 3; // 1pt = 4/3 px

const hhmm = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const ymd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const mmdd = (iso: string) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : '');
const isoOf = (mmddText: string, base: string) =>
  mmddText ? `${base.slice(0, 4)}-${mmddText.slice(0, 2)}-${mmddText.slice(3, 5)}` : '';

export function BrSheetButton({ recordId }: { recordId: string }) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<BrSheet | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () => start(async () => {
    const r = await loadBrSheet(recordId);
    if ('error' in r) { setErr(r.error); setSheet(null); } else { setErr(null); setSheet(r); }
  });

  /* 단추에 몇 칸 적었는지 보이려고 처음에 한 번 읽는다 */
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [recordId]);

  if (!sheet && err) return null;   // 양식이 없는 공정
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); load(); }} className="btn-ghost w-full">
        제조기록서 칸 적기
        {sheet && <span className="tnum text-muted">{sheet.done} / {sheet.total}</span>}
      </button>
      {open && sheet && (
        <BrSheetView sheet={sheet} onSheet={setSheet} onClose={() => setOpen(false)} busy={pending} />
      )}
    </>
  );
}

function BrSheetView({ sheet, onSheet, onClose, busy }: {
  sheet: BrSheet; onSheet: (s: BrSheet) => void; onClose: () => void; busy: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [cell, setCell] = useState<FormCell | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, start] = useTransition();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1.2, (el.clientWidth - 16) / (sheet.size.w * PX)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet.size.w]);

  /* 다시 읽은 양식에서 고른 칸을 새 값으로 바꿔 든다 */
  const find = (id: string) => {
    for (const p of sheet.pages) for (const t of p.tables) for (const r of t.rows)
      for (const c of r.cells) if (c.id === id) return c;
    return null;
  };

  const save = (value: string) => {
    if (!cell?.id) return;
    const id = cell.id;
    start(async () => {
      const r = await saveBrEntry(sheet.recordId, sheet.docId, id, value);
      if ('error' in r) { setErr(r.error); return; }
      setErr(null);
      onSheet(r);
      setCell(null);
    });
  };

  /*
   * 보기가 하나뿐인 고르기 칸(«□ 확인» 같은)은 누르면 바로 ■ 로 저장하고, 다시 누르면
   * 지운다 (사용자 2026-11-11 «확인은 한번에 체크 되게 해줘. 손이 한번 더 가는데»).
   * 아래 적는 칸을 열고 ■ 확인을 다시 누르던 두 번 손을 한 번으로 줄인다.
   * 빈칸이 딸린 보기(시각 · 수치)는 적을 것이 있어 그대로 연다.
   */
  const oneTap = (c: FormCell) =>
    c.k === 'choice' && (c.o?.length ?? 0) === 1 && !optionBlank(c.o![0]);
  const toggle = (c: FormCell) => {
    const id = c.id!;
    const next = c.v ? '' : c.o![0];
    setCell(null);
    start(async () => {
      const r = await saveBrEntry(sheet.recordId, sheet.docId, id, next);
      if ('error' in r) { setErr(r.error); setCell(c); return; }
      setErr(null);
      onSheet(r);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-ink">{sheet.title}</p>
          <p className="text-sm text-muted">
            적을 칸 <b className="tnum text-ink">{sheet.total}</b> · 적은 칸{' '}
            <b className="tnum text-brand">{sheet.done}</b>
            {sheet.locked && <span className="ml-2 font-semibold text-warn">일차가 마감되어 고칠 수 없습니다</span>}
          </p>
        </div>
        <button type="button" onClick={onClose} className="btn-ghost">닫기</button>
      </header>

      <div ref={wrap} className="flex-1 overflow-auto px-2 py-3">
        <p className="mb-2 px-1 text-sm text-muted">
          노란 칸을 누르면 아래에 적는 칸이 나옵니다. □ 확인 칸은 누르면 바로 체크되고, 다시 누르면 지워집니다.
          적은 값은 파란 글씨로 바로 저장됩니다.
        </p>
        {sheet.pages.map((pg, i) => (
          <div key={i} className="mx-auto mb-3 overflow-hidden rounded-md border border-line bg-white"
               style={{ width: sheet.size.w * PX * scale, height: sheet.size.h * PX * scale }}>
            <div className="sheet--form relative bg-white"
                 style={{ width: `${sheet.size.w}pt`, height: `${sheet.size.h}pt`,
                          transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <FormBody page={pg} size={sheet.size} formPage={{ n: i + 1, of: sheet.pages.length }}
                        onCell={sheet.locked ? undefined : (c) => {
                          setErr(null);
                          if (oneTap(c)) toggle(c); else setCell(c);
                        }}
                        active={cell?.id} />
            </div>
          </div>
        ))}
      </div>

      {cell && !sheet.locked && (
        <FieldEditor key={cell.id} cell={find(cell.id!) ?? cell} workDate={sheet.workDate}
                     busy={saving || busy} error={err}
                     onSave={save} onCancel={() => setCell(null)} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   칸 하나 적기 - 칸의 종류에 맞는 입력
--------------------------------------------------------------------------- */
function FieldEditor({ cell, workDate, busy, error, onSave, onCancel }: {
  cell: FormCell; workDate: string; busy: boolean; error: string | null;
  onSave: (v: string) => void; onCancel: () => void;
}) {
  const [pick, setPick] = useState(() => (cell.v ?? '').split('|')[0] ?? '');
  const [extra, setExtra] = useState(() => (cell.v ?? '').split('|')[1] ?? '');
  const [num, setNum] = useState(() => (cell.k === 'number' ? cell.v ?? '' : ''));
  const [neg, setNeg] = useState(() => (cell.v ?? '').startsWith('-'));
  const [text, setText] = useState(() => (cell.k === 'text' ? cell.v ?? '' : ''));
  const parts = (cell.v ?? '').split('~').map((x) => x.trim());
  const split = (p: string) => {
    const m = p.match(/^(\d\d\/\d\d)\s+(\d\d:\d\d)$/);
    return m ? { d: isoOf(m[1], workDate), t: m[2] } : { d: workDate, t: p };
  };
  const [s, setS] = useState(() => split(parts[0] ?? ''));
  const [e, setE] = useState(() => split(parts[1] ?? ''));

  const timeValue = (a: { d: string; t: string }, b: { d: string; t: string }) => {
    const one = (x: { d: string; t: string }) => (cell.dt && x.t ? `${mmdd(x.d)} ${x.t}` : x.t);
    return `${one(a)}~${one(b)}`;
  };
  const blank = pick ? optionBlank(pick) : null;

  return (
    <section className="max-h-[55vh] overflow-auto border-t-2 border-brand bg-surface px-4 py-4 shadow-lg">
      <p className="text-sm text-muted">적을 칸</p>
      <p className="text-base font-semibold text-ink">{cell.lb ?? '칸'}</p>

      {cell.k === 'choice' && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {(cell.o ?? []).map((o) => (
              <button key={o} type="button" disabled={busy}
                      onClick={() => {
                        setPick(o);
                        if (!optionBlank(o)) onSave(o);
                      }}
                      data-on={pick === o} className="tile justify-start text-left">
                {pick === o ? '■' : '□'} {o}
              </button>
            ))}
          </div>
          {blank === 'time' && (
            <TimePair s={{ d: workDate, t: extra.split('~')[0] ?? '' }} e={{ d: workDate, t: extra.split('~')[1] ?? '' }}
                      dated={false}
                      onDone={(a, b) => onSave(`${pick}|${a.t}~${b.t}`)} busy={busy} />
          )}
          {blank === 'number' && (
            <div>
              <NumPad name="extra" label="빈칸에 적을 수" initial={extra} onChange={setExtra} />
              <button type="button" disabled={busy || !extra} onClick={() => onSave(`${pick}|${extra}`)}
                      className="btn-primary mt-3 w-full">저장</button>
            </div>
          )}
        </div>
      )}

      {cell.k === 'time' && (
        <div className="mt-3">
          <TimePair s={s} e={e} dated={!!cell.dt} busy={busy}
                    onChange={(a, b) => { setS(a); setE(b); }}
                    onDone={(a, b) => onSave(timeValue(a, b))} />
        </div>
      )}

      {cell.k === 'number' && (
        <div className="mt-3">
          <NumPad name="num" label={`값${cell.u ? ` (${cell.u})` : ''}`} unit={cell.u}
                  initial={num.replace(/^-/, '')} onChange={setNum} />
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setNeg((x) => !x)} data-on={neg} className="tile w-24 justify-center">
              {neg ? '− 영하' : '+'}
            </button>
            <button type="button" disabled={busy || !num.replace(/^-/, '')}
                    onClick={() => onSave(`${neg ? '-' : ''}${num.replace(/^-/, '')}`)}
                    className="btn-primary flex-1">저장</button>
          </div>
        </div>
      )}

      {cell.k === 'text' && (
        <div className="mt-3">
          <textarea value={text} onChange={(ev) => setText(ev.target.value)} rows={3}
                    placeholder={cell.u ? `${cell.u} 로 시작하는 번호` : '적을 내용'}
                    className="input min-h-24 w-full py-2" />
          <button type="button" disabled={busy} onClick={() => onSave(text.trim())}
                  className="btn-primary mt-3 w-full">저장</button>
        </div>
      )}

      {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}

      <div className="mt-4 flex gap-2">
        {cell.v && (
          <button type="button" disabled={busy} onClick={() => onSave('')} className="btn-danger">비우기</button>
        )}
        <button type="button" onClick={onCancel} className="btn-ghost flex-1">닫기</button>
      </div>
    </section>
  );
}

/* 시작 · 종료 - "지금" 으로 찍거나 고친다. 여러 날에 걸치는 칸은 날짜도 */
function TimePair({ s, e, dated, busy, onDone, onChange }: {
  s: { d: string; t: string }; e: { d: string; t: string }; dated: boolean; busy: boolean;
  onDone: (a: { d: string; t: string }, b: { d: string; t: string }) => void;
  onChange?: (a: { d: string; t: string }, b: { d: string; t: string }) => void;
}) {
  const [a, setA] = useState(s);
  const [b, setB] = useState(e);
  useEffect(() => { onChange?.(a, b); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [a, b]);
  const row = (label: string, v: { d: string; t: string }, set: (x: { d: string; t: string }) => void) => (
    <div className="flex flex-wrap items-end gap-2">
      <span className="w-12 pb-3 text-base font-semibold text-ink">{label}</span>
      {dated && (
        <input type="date" value={v.d} onChange={(ev) => set({ ...v, d: ev.target.value })} className="input w-44 tnum" />
      )}
      <input type="time" value={v.t} onChange={(ev) => set({ ...v, t: ev.target.value })} className="input w-36 tnum" />
      <button type="button" onClick={() => set({ d: ymd(), t: hhmm() })} className="btn-ghost">지금</button>
    </div>
  );
  return (
    <div className="space-y-2">
      {row('시작', a, setA)}
      {row('종료', b, setB)}
      <button type="button" disabled={busy || (!a.t && !b.t)} onClick={() => onDone(a, b)}
              className="btn-primary w-full">저장</button>
    </div>
  );
}
