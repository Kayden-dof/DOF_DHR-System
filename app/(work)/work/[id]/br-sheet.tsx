'use client';

/* ---------------------------------------------------------------------------
   제조기록서 칸 적기 (0132 · 사용자 2026-11-10) · 기록서 중심 화면 (2026-11-11)

   "지금 제조기록서 상에 체크와 적어야 하는 부분들은 모두 생산자가 체크 하거나
   기록 할수 있도록 작업기록지에 기능 구현해줄것"

   "작업 시작하면 제조기록서가 바로 뜨고 거기에서 장비 시약 이런게 다 입력 가능한
   형태로 … 해당 공정에 미리 배치된 설비나 자재만 팝업에 뜰수 있도록 해주고, 만약
   기록에 없는경우라면 버튼 한번 더 눌러서 전체 리스트가 나오게끔"

   종이 제조기록서와 같은 모양을 그대로 보이고, 적어야 하는 칸을 누르면 그 칸에
   맞는 입력이 아래에 뜬다. 현장에는 키보드가 없다 - 고르기는 큰 단추, 수치는
   숫자판, 시각은 "지금" 단추로 찍는다. 적은 값은 바로 저장되고 종이에 파란
   글씨로 찍힌다. 일차를 마감하면 더 바뀌지 않는다 (DB 가 막는다).

     기기번호 칸      그 공정에 걸린 설비를 고른다 (여럿). 없으면 «전체 설비 보기»
     부여로트번호 칸  그 자재의 로트를 고르고 양을 적는다. 없으면 «전체 자재 로트 보기»
                      별첨에서는 로트 번호를 적기만 한다 (lib/br-form FieldKind lotno)
     아래 막대        빈 칸 수 · 닫기 · 공정 마감
     머리의 양식 줄   한 공정에 양식이 둘 이상이면 (본 기록서 + 별첨, 2026-11-12) 고른다

   판정하지 않는다 - 허용범위 밖이어도 적힌 대로 둔다 (§1).
--------------------------------------------------------------------------- */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { FormBody } from '@/components/print-frame';
import NumPad from '@/components/num-pad';
import { optionBlank, type FormCell } from '@/lib/br-form';
import type { BrSheet, BrFormTab } from '@/lib/br-sheet';
import { daysUntilKST, todayKST } from '@/lib/kst';
import { fmtDate } from '@/lib/fmt';
import { isNoExpiry } from '@/lib/equipment-check';
import { loadBrSheet, saveBrEntry, setRecordEquipment, issueFromSheet } from '../actions';

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
/* 자재 이름 맞대기 (lib/br-form 의 sameThing 과 같은 규칙) */
const key = (s: string | undefined) => (s ?? '').replace(/[\s\-()%.·,]/g, '').toLowerCase();
const same = (a?: string, b?: string) => {
  const A = key(a), B = key(b);
  return A.length >= 2 && B.length >= 2 && (A.includes(B) || B.includes(A));
};

/* --- 기록서 창이 고르는 데 쓰는 것 (현장 화면이 넘긴다) ------------------------ */
export interface EquipOpt {
  id: string; code: string; name: string; valid_until: string | null;
  check_cycle?: string | null;
}
export interface SheetLot {
  id: string; lot_no: string; item_id: string; item_code: string; item_name: string;
  usage_uom: string; qty_available: string; expiry_date: string | null;
}
export interface SheetCtx {
  woId: string;
  /** 이 공정에 걸린 설비 (제품표준서) */
  linked: EquipOpt[];
  /** 대장의 쓰는 설비 전부 («전체 설비 보기») */
  allEquipment: EquipOpt[];
  /** 이 공정의 자재 구성표 */
  bom: { item_id: string; item_code: string; item_name: string; usage_uom: string;
         required: string | null; required_max?: string | null; lot_tracked?: boolean }[];
  /** 쓸 수 있는 자재 로트 (품목 · 유효기한 차례) */
  lots: SheetLot[];
  /** 이 기록에 이미 넣은 것 */
  issues: { item_code: string; item_name: string; lot_no: string; qty: string; usage_uom: string }[];
  expiryWarnDays: number;
  sheets: number;
  loadUnit: string | null;
}

/* ---------------------------------------------------------------------------
   기록 하나의 기록서를 읽어 둔다. 양식이 없는 공정이면 noForm
--------------------------------------------------------------------------- */
export function useBrSheet(recordId: string | null) {
  const [sheet, setSheet] = useState<BrSheet | null>(null);
  const [noForm, setNoForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = useCallback(() => {
    if (!recordId) return;
    start(async () => {
      const r = await loadBrSheet(recordId);
      if ('error' in r) { setSheet(null); setNoForm(true); } else { setNoForm(false); setSheet(r); }
    });
  }, [recordId]);
  useEffect(() => { setSheet(null); setNoForm(false); setError(null); load(); }, [load]);
  const mine = sheet && sheet.recordId === recordId ? sheet : null;
  /* 양식 하나를 골라 읽고 (본 기록서 · 별첨), 다 읽으면 then */
  const pick = useCallback((docId: string, then?: () => void) => {
    if (!recordId) return;
    if (mine?.docId === docId) { setError(null); then?.(); return; }
    start(async () => {
      const r = await loadBrSheet(recordId, docId);
      if ('error' in r) { setError(r.error); return; }
      setError(null);
      setSheet(r);
      then?.();
    });
  }, [recordId, mine?.docId]);
  return { sheet: mine, setSheet, noForm, pending, load, pick, error };
}

/** 빈 칸 수 - 본 기록서와 적기 시작한 별첨을 합친다 (lib/br-sheet emptyOfForms) */
export function emptyOf(s: BrSheet) { return s.empty; }

/** 양식 하나의 빈 칸 수. 적기 시작하지 않은 별첨은 세지 않는다 */
export function formEmpty(f: BrFormTab) { return f.inUse ? Math.max(0, f.total - f.done) : 0; }

/* ---------------------------------------------------------------------------
   기록서 창
--------------------------------------------------------------------------- */
export function BrSheetView({ sheet, onSheet, onClose, busy, ctx, endSlot }: {
  sheet: BrSheet; onSheet: (s: BrSheet) => void; onClose: () => void; busy: boolean;
  ctx: SheetCtx;
  /** 공정 마감 자리. 진행 중인 기록일 때만 준다. 그만두면 cancel 을 부른다 */
  endSlot?: (cancel: () => void) => React.ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [cell, setCell] = useState<FormCell | null>(null);
  const [ending, setEnding] = useState(false);
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

  const take = (r: BrSheet | { error: string }, keepOpen = false) => {
    if ('error' in r) { setErr(r.error); return false; }
    setErr(null);
    onSheet(r);
    if (!keepOpen) setCell(null);
    return true;
  };

  const save = (value: string) => {
    if (!cell?.id) return;
    const id = cell.id;
    start(async () => { take(await saveBrEntry(sheet.recordId, sheet.docId, id, value)); });
  };

  /* 설비: 고른 설비 묶음을 통째로 보낸다 (첫 설비부터) */
  const saveEquip = (refs: string[], keepOpen: boolean) =>
    start(async () => {
      take(await setRecordEquipment(sheet.recordId, ctx.woId, refs, sheet.docId), keepOpen);
    });

  /* 자재: 투입 한 줄 */
  const saveLot = (lotId: string, qty: number) =>
    start(async () => { take(await issueFromSheet(sheet.recordId, ctx.woId, lotId, qty, sheet.docId)); });

  /* 양식 바꾸기 (본 기록서 · 별첨). 고른 칸 · 마감 자리는 접고 맨 위로 */
  const switchTo = (docId: string) => {
    setCell(null);
    setEnding(false);
    setErr(null);
    start(async () => {
      if (take(await loadBrSheet(sheet.recordId, docId))) wrap.current?.scrollTo({ top: 0 });
    });
  };

  /*
   * 보기가 하나뿐인 고르기 칸(«□ 확인» 같은)은 누르면 바로 ■ 로 저장하고, 다시 누르면
   * 지운다 (사용자 2026-11-11 «확인은 한번에 체크 되게 해줘. 손이 한번 더 가는데»).
   * 기기번호가 하나뿐인 칸도 같다 - 그 설비를 넣거나 뺀다.
   * 빈칸이 딸린 보기(시각 · 수치)는 적을 것이 있어 그대로 연다.
   */
  const byCode = (code: string) => ctx.allEquipment.find((e) => e.code === code)
    ?? ctx.linked.find((e) => e.code === code);
  const oneTap = (c: FormCell) =>
    (c.k === 'choice' && (c.o?.length ?? 0) === 1 && !optionBlank(c.o![0]))
    || (c.k === 'equip' && (c.o?.length ?? 0) === 1 && !!byCode(c.o![0]));
  const toggle = (c: FormCell) => {
    setCell(null);
    if (c.k === 'equip') {
      const id = byCode(c.o![0])!.id;
      const cur = sheet.equipRefs;
      saveEquip(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], false);
      return;
    }
    const id = c.id!;
    const next = c.v ? '' : c.o![0];
    start(async () => {
      const r = await saveBrEntry(sheet.recordId, sheet.docId, id, next);
      if ('error' in r) { setErr(r.error); setCell(c); return; }
      setErr(null);
      onSheet(r);
    });
  };

  /*
   * 아래 막대의 빈 칸: 이 양식 것과 다른 양식(본 기록서 · 적기 시작한 별첨) 것을 따로.
   * 안 적은 별첨은 해당할 때만 적는 양식이라 세지 않는다.
   */
  const cur = sheet.forms.find((f) => f.docId === sheet.docId);
  const counted = cur?.inUse ?? true;
  const here = counted ? Math.max(0, sheet.total - sheet.done) : 0;
  const elsewhere = Math.max(0, emptyOf(sheet) - here);
  const live = cell ? find(cell.id!) ?? cell : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-ink">{sheet.title}</p>
          <p className="text-sm text-muted">
            적을 칸 <b className="tnum text-ink">{sheet.total}</b> · 적은 칸{' '}
            <b className="tnum text-brand">{sheet.done}</b>
            {sheet.optTotal > 0 && (
              <> · 해당할 때만 <b className="tnum text-ink">{sheet.optTotal}</b>
                {sheet.optDone > 0 && <> (적은 칸 <b className="tnum text-brand">{sheet.optDone}</b>)</>}</>
            )}
            {sheet.locked && <span className="ml-2 font-semibold text-warn">일차가 마감되어 고칠 수 없습니다</span>}
          </p>
        </div>
        <button type="button" onClick={onClose} className="btn-ghost">닫기</button>
      </header>

      {/* 한 공정에 양식이 둘 이상이면 고른다. 본 기록서가 처음 (2026-11-12) */}
      {sheet.forms.length > 1 && (
        <div className="qd-tabs !mb-0 border-b border-line bg-surface px-4" role="tablist" aria-label="양식">
          {sheet.forms.map((f) => {
            const on = f.docId === sheet.docId;
            const left = formEmpty(f);
            return (
              <button key={f.docId} type="button" role="tab" aria-selected={on}
                      disabled={saving || busy} onClick={() => { if (!on) switchTo(f.docId); }}
                      className={`qd-tab flex items-center gap-1.5${on ? ' qd-tab--active' : ''}`}>
                {f.label}
                <span className="font-mono text-xs text-faint">{f.docNo}</span>
                {!f.inUse ? <span className="chip bg-surface-sub text-muted">해당할 때만</span>
                  : left > 0 ? <span className="chip bg-warn-bg text-warn">빈 칸 {left}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      <div ref={wrap} className="flex-1 overflow-auto px-2 py-3">
        <p className="mb-2 px-1 text-sm text-muted">
          노란 칸을 누르면 아래에 적는 칸이 나옵니다. 점선 칸은 해당할 때만 적습니다. □ 확인 칸은 누르면 바로
          체크되고, 다시 누르면 지워집니다. 기기번호 칸은 설비를,{' '}
          {sheet.appendix ? '부여로트번호 칸은 로트 번호를 적고 재고에서 빼지 않습니다.'
            : '부여로트번호 칸은 자재 로트와 양을 고릅니다.'}{' '}
          적은 값은 파란 글씨로 바로 저장됩니다.
        </p>
        {sheet.appendix && (
          <p className="mb-2 px-1 text-sm text-muted">
            별첨은 해당할 때만 적습니다. 한 칸이라도 적으면 빈 칸을 함께 세고, 제조기록서 인쇄에 이 양식이
            붙습니다.
          </p>
        )}
        {sheet.pages.map((pg, i) => (
          <div key={i} className="mx-auto mb-3 overflow-hidden rounded-md border border-line bg-white"
               style={{ width: sheet.size.w * PX * scale, height: sheet.size.h * PX * scale }}>
            <div className="sheet--form relative bg-white"
                 style={{ width: `${sheet.size.w}pt`, height: `${sheet.size.h}pt`,
                          transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <FormBody page={pg} size={sheet.size} formPage={{ n: i + 1, of: sheet.pages.length }}
                        onCell={sheet.locked ? undefined : (c) => {
                          setErr(null);
                          setEnding(false);
                          if (oneTap(c)) toggle(c); else setCell(c);
                        }}
                        active={cell?.id} />
            </div>
          </div>
        ))}
        {err && !live && (
          <p role="alert" className="mx-auto max-w-3xl px-1 text-sm font-semibold text-danger">{err}</p>
        )}
      </div>

      {live && !sheet.locked && (live.k === 'equip' ? (
        <EquipPicker key={live.id} cell={live} refs={sheet.equipRefs} ctx={ctx}
                     busy={saving || busy} error={err}
                     onSave={(refs) => saveEquip(refs, true)} onClose={() => setCell(null)} />
      ) : live.k === 'lot' ? (
        <LotPicker key={live.id} cell={live} ctx={ctx} busy={saving || busy} error={err}
                   onSave={saveLot} onClose={() => setCell(null)} />
      ) : live.k === 'lotno' ? (
        <LotNoPicker key={live.id} cell={live} ctx={ctx} busy={saving || busy} error={err}
                     onSave={save} onClose={() => setCell(null)} />
      ) : (
        <FieldEditor key={live.id} cell={live} workDate={sheet.workDate}
                     busy={saving || busy} error={err}
                     onSave={save} onCancel={() => setCell(null)} />
      ))}

      {/*
        * 아래 막대 - 빈 칸 수 · 닫기 · 공정 마감 (기록서 중심 화면 2026-11-11).
        * 공정 마감까지 이 창에서 끝낸다. 빈 칸이 있어도 막지 않는다 - 알린다.
        */}
      {!live && !sheet.locked && (
        ending && endSlot ? (
          <section className="max-h-[60vh] overflow-auto border-t-2 border-brand bg-surface px-4 py-3 shadow-lg">
            {endSlot(() => setEnding(false))}
          </section>
        ) : (
          <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3">
            <span className={`min-w-0 flex-1 text-sm ${here + elsewhere > 0 ? 'font-semibold text-warn' : 'text-muted'}`}>
              {!counted ? '해당할 때만 적는 별첨입니다'
                : here > 0 ? <>빈 노란 칸 <b className="tnum">{here}</b>곳</> : '노란 칸을 다 적었습니다'}
              {elsewhere > 0 && <> · 다른 양식에 <b className="tnum">{elsewhere}</b>곳</>}
            </span>
            <button type="button" onClick={onClose} className="btn-ghost">닫기</button>
            {endSlot && (
              <button type="button" onClick={() => setEnding(true)} className="btn-primary">공정 마감</button>
            )}
          </footer>
        )
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   기기번호 칸 - 그 공정에 걸린 설비를 고른다 (여럿)

   누를 때마다 바로 저장된다. 한 칸에 기기번호가 둘 이상 인쇄된 줄(동결건조기
   M-012 · M-013)은 그 칸의 설비를 앞에 둔다. 걸린 설비에 없으면 «전체 설비 보기».
--------------------------------------------------------------------------- */
function EquipPicker({ cell, refs, ctx, busy, error, onSave, onClose }: {
  cell: FormCell; refs: string[]; ctx: SheetCtx; busy: boolean; error: string | null;
  onSave: (refs: string[]) => void; onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const printed = cell.o ?? [];
  const linkedIds = new Set(ctx.linked.map((e) => e.id));
  const first = [...ctx.linked].sort((a, b) =>
    Number(printed.includes(b.code)) - Number(printed.includes(a.code)) || a.code.localeCompare(b.code));
  const rest = ctx.allEquipment.filter((e) => !linkedIds.has(e.id));
  /* 지금 고른 것 가운데 걸린 설비가 아닌 것은 «전체» 를 펴지 않아도 보이게 */
  const pickedOutside = rest.filter((e) => refs.includes(e.id));
  const shown = all ? [...first, ...rest] : [...first, ...pickedOutside];
  const flip = (id: string) => onSave(refs.includes(id) ? refs.filter((x) => x !== id) : [...refs, id]);

  return (
    <section className="max-h-[60vh] overflow-auto border-t-2 border-brand bg-surface px-4 py-4 shadow-lg">
      <p className="text-sm text-muted">기기번호 · 누르면 넣고, 다시 누르면 뺍니다 (여럿 고를 수 있음)</p>
      <p className="text-base font-semibold text-ink">{cell.lb ?? '사용설비'}</p>

      {shown.length === 0 && (
        <p className="mt-3 text-sm text-muted">이 공정에 걸린 설비가 없습니다. 아래에서 전체 설비를 보십시오.</p>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {shown.map((q) => {
          const on = refs.includes(q.id);
          const exempt = q.check_cycle === 'NONE';
          const gone = !exempt && (!q.valid_until || q.valid_until < todayKST());
          return (
            <button key={q.id} type="button" disabled={busy} onClick={() => flip(q.id)}
                    data-on={on} className="tile">
              <span className="flex flex-wrap items-center gap-2 font-mono text-base font-semibold">
                {on ? '■' : '□'} {q.code}
                {!linkedIds.has(q.id) && <span className="chip bg-warn-bg text-warn">표준서 밖</span>}
                {gone && (
                  <span className="chip bg-danger-bg text-danger">
                    {q.valid_until ? '밸리데이션 기한 경과' : '밸리데이션 기록 없음'}
                  </span>
                )}
              </span>
              <span className="text-xs text-muted">
                {q.name}
                {exempt && <> · 검교정 대상 아님</>}
                {!exempt && q.valid_until && !gone && (
                  <> · {isNoExpiry(q.valid_until) ? '최초 1회 검교정' : <>밸리데이션 만료 {q.valid_until}</>}</>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {!all && rest.length > 0 && (
        <button type="button" onClick={() => setAll(true)} className="btn-ghost mt-3 w-full">
          전체 설비 보기 ({rest.length})
        </button>
      )}
      {all && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          «표준서 밖» 설비는 이 공정에 걸리지 않은 설비입니다. 고르면 그대로 기록되고, 제품표준서는
          바뀌지 않으며, 검토에서 짚습니다.
        </p>
      )}

      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{error}</p>}
      <button type="button" onClick={onClose} className="btn-ghost mt-4 w-full">닫기</button>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   부여로트번호 칸 - 그 자재의 로트를 고르고 양을 적는다

   유효기한이 가장 이른 (지나지 않은) 로트를 미리 고르고, 자재 구성표의 예상
   소요량을 미리 채운다. 그 품목 로트가 없거나 다른 것을 넣었으면
   «전체 자재 로트 보기». 막지 않는다 - 기한이 지난 로트도 고를 수 있다 (§2).
--------------------------------------------------------------------------- */
function LotPicker({ cell, ctx, busy, error, onSave, onClose }: {
  cell: FormCell; ctx: SheetCtx; busy: boolean; error: string | null;
  onSave: (lotId: string, qty: number) => void; onClose: () => void;
}) {
  const bom = ctx.bom.find((b) => cell.ic && b.item_code === cell.ic)
    ?? ctx.bom.find((b) => same(b.item_name, cell.lb));
  const mine = (l: SheetLot) => bom ? l.item_id === bom.item_id
    : cell.ic ? l.item_code === cell.ic : same(l.item_name, cell.lb);
  const pool = ctx.lots.filter(mine);
  const bomIds = new Set(ctx.bom.map((b) => b.item_id));
  const left = (l: SheetLot) => daysUntilKST(l.expiry_date);
  const fefo = pool.find((l) => { const n = left(l); return n === null || n >= 0; });

  const [all, setAll] = useState(pool.length === 0);
  const [lotId, setLotId] = useState(fefo?.id ?? '');
  const shown = all ? ctx.lots : pool;
  const lot = ctx.lots.find((l) => l.id === lotId);
  const need = lot && bom && lot.item_id === bom.item_id && bom.required != null ? Number(bom.required) : null;
  const [qty, setQty] = useState(need !== null ? String(need) : '');
  const already = ctx.issues.filter((x) =>
    bom ? x.item_code === bom.item_code : cell.ic ? x.item_code === cell.ic : same(x.item_name, cell.lb));

  return (
    <section className="max-h-[65vh] overflow-auto border-t-2 border-brand bg-surface px-4 py-4 shadow-lg">
      <p className="text-sm text-muted">부여로트번호 · 로트를 고르고 넣은 양을 적습니다</p>
      <p className="text-base font-semibold text-ink">{cell.lb ?? '자재'}
        {cell.ic && <span className="ml-2 font-mono text-sm text-faint">{cell.ic}</span>}</p>

      {already.length > 0 && (
        <p className="mt-2 rounded-md bg-surface-sub px-3 py-2 text-sm text-ink">
          이미 넣은 것:{' '}
          {already.map((x) => `${x.lot_no} ${Number(x.qty)} ${x.usage_uom}`).join(' · ')}
          <span className="block text-xs text-muted">고치려면 공정 화면의 투입 줄을 누르십시오. 여기서는 한 줄을 더합니다.</span>
        </p>
      )}

      {shown.length === 0 && (
        <p className="mt-3 text-sm text-muted">넣을 수 있는 로트가 없습니다. 관리자에게 입고를 요청하십시오.</p>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {shown.map((l) => {
          const n = left(l);
          const over = n !== null && n < 0;
          const soon = n !== null && n >= 0 && n < ctx.expiryWarnDays;
          const outside = bomIds.size > 0 && !bomIds.has(l.item_id);
          return (
            <button key={l.id} type="button"
                    onClick={() => {
                      setLotId(l.id);
                      const b = ctx.bom.find((x) => x.item_id === l.item_id);
                      setQty(b?.required != null ? String(Number(b.required)) : '');
                    }}
                    data-on={lotId === l.id} className="tile">
              <span className="flex flex-wrap items-center gap-2 font-mono text-base font-semibold">
                {l.lot_no}
                {outside && <span className="chip bg-warn-bg text-warn">구성표 밖</span>}
              </span>
              <span className="text-xs text-muted">
                {l.item_name} · 잔여 <span className="tnum">{Number(l.qty_available)}</span> {l.usage_uom}
              </span>
              {l.expiry_date && (
                <span className={`tnum text-xs ${over ? 'font-semibold text-danger' : soon ? 'font-semibold text-warn' : 'text-faint'}`}>
                  {fmtDate(l.expiry_date)}{over ? ' · 기한 지남' : soon ? ` · ${n}일 남음` : ''}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!all && ctx.lots.length > pool.length && (
        <button type="button" onClick={() => setAll(true)} className="btn-ghost mt-3 w-full">
          전체 자재 로트 보기 ({ctx.lots.length - pool.length})
        </button>
      )}
      {all && bomIds.size > 0 && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          «구성표 밖» 로트는 이 공정의 자재 구성표에 없는 품목입니다. 넣으면 그대로 기록되고, 제품표준서는
          바뀌지 않으며, 검토에서 짚습니다.
        </p>
      )}

      {lot && (
        <div className="mt-3">
          <NumPad key={lot.id} name="qty" label={`넣은 양 (${lot.usage_uom})`} unit={lot.usage_uom}
                  max={Number(lot.qty_available)} initial={qty} onChange={setQty}
                  hint={need !== null ? (
                    <>장입 {ctx.sheets}{ctx.loadUnit ?? ''} 의 <b className="text-ink">예상</b> 소요량{' '}
                      <b className="tnum text-ink">{need} {lot.usage_uom}</b>을 미리 채웠습니다. 실제로 넣은 양이
                      다르면 고쳐 적으십시오.</>
                  ) : null} />
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onClose} className="btn-ghost flex-1">닫기</button>
        <button type="button" disabled={busy || !lot || !(Number(qty) > 0)}
                onClick={() => lot && onSave(lot.id, Number(qty))} className="btn-primary flex-1">
          {busy ? '기록하는 중' : '투입 기록'}
        </button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   별첨의 부여로트번호 칸 - 로트 번호를 적기만 한다 (2026-11-12)

   별첨(20X PBS 제조)의 시약은 원액을 만들 때 이미 재고에서 빠졌다. 그래서 투입을
   적지 않고 번호만 적는다 (lib/br-form FieldKind lotno). 그 품목의 로트를 누르면
   바로 저장되고, 목록에 없으면 (다 써서 잔여가 없으면) 번호를 적는다.
--------------------------------------------------------------------------- */
function LotNoPicker({ cell, ctx, busy, error, onSave, onClose }: {
  cell: FormCell; ctx: SheetCtx; busy: boolean; error: string | null;
  onSave: (v: string) => void; onClose: () => void;
}) {
  const pool = ctx.lots.filter((l) => (cell.ic ? l.item_code === cell.ic : same(l.item_name, cell.lb)));
  const [text, setText] = useState(cell.v ?? '');
  return (
    <section className="max-h-[60vh] overflow-auto border-t-2 border-brand bg-surface px-4 py-4 shadow-lg">
      <p className="text-sm text-muted">부여로트번호 · 로트 번호를 적습니다 (재고에서 빼지 않음)</p>
      <p className="text-base font-semibold text-ink">{cell.lb ?? '자재'}
        {cell.ic && <span className="ml-2 font-mono text-sm text-faint">{cell.ic}</span>}</p>

      {pool.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {pool.map((l) => (
            <button key={l.id} type="button" disabled={busy} onClick={() => onSave(l.lot_no)}
                    data-on={cell.v === l.lot_no} className="tile">
              <span className="font-mono text-base font-semibold">{cell.v === l.lot_no ? '■' : '□'} {l.lot_no}</span>
              <span className="text-xs text-muted">
                {l.item_name}{l.expiry_date && <> · <span className="tnum">{fmtDate(l.expiry_date)}</span></>}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <input value={text} onChange={(ev) => setText(ev.target.value)}
               placeholder={pool.length ? '목록에 없으면 로트 번호를 적으십시오' : '로트 번호'}
               className="input min-w-0 flex-1 font-mono" />
        <button type="button" disabled={busy || !text.trim() || text.trim() === cell.v}
                onClick={() => onSave(text.trim())} className="btn-primary">저장</button>
      </div>

      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        {cell.v && (
          <button type="button" disabled={busy} onClick={() => onSave('')} className="btn-danger">비우기</button>
        )}
        <button type="button" onClick={onClose} className="btn-ghost flex-1">닫기</button>
      </div>
    </section>
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
  const [day, setDay] = useState(() => (cell.k === 'date' ? cell.v ?? '' : ''));
  const parts = (cell.v ?? '').split('~').map((x) => x.trim());
  const split = (p: string) => {
    const m = p.match(/^(\d\d\/\d\d)\s+(\d\d:\d\d)$/);
    return m ? { d: isoOf(m[1], workDate), t: m[2] } : { d: workDate, t: p };
  };
  const s = split(parts[0] ?? '');
  const e = split(parts[1] ?? '');

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

      {/* 날짜 (별첨 머리의 제조일자). «오늘» 은 누르면 바로 저장된다 - 시각의 «지금» 과 같다 */}
      {cell.k === 'date' && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <input type="date" value={day} onChange={(ev) => setDay(ev.target.value)} className="input w-44 tnum" />
            <button type="button" disabled={busy} onClick={() => { const t = ymd(); setDay(t); onSave(t); }}
                    className="btn-ghost">오늘</button>
          </div>
          <p className="text-xs text-muted">«오늘» 은 누르면 바로 저장됩니다. 날짜를 골랐으면 «저장» 을 누르십시오.</p>
          <button type="button" disabled={busy || !day || day === cell.v} onClick={() => onSave(day)}
                  className="btn-primary w-full">저장</button>
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

/*
 * 시작 · 종료 - "지금" 으로 찍거나 고친다. 여러 날에 걸치는 칸은 날짜도.
 *
 * «지금» 은 누르는 순간 저장된다 (UI/UX 검수 2026-11-11). 전에는 «지금» 을 누르고
 * «저장» 을 한 번 더 눌러야 했다 - 시각 한 쌍에 여섯 번. 손으로 고친 시각만
 * «저장» 을 누른다.
 */
function TimePair({ s, e, dated, busy, onDone }: {
  s: { d: string; t: string }; e: { d: string; t: string }; dated: boolean; busy: boolean;
  onDone: (a: { d: string; t: string }, b: { d: string; t: string }) => void;
}) {
  const [a, setA] = useState(s);
  const [b, setB] = useState(e);
  const row = (label: '시작' | '종료', v: { d: string; t: string }, set: (x: { d: string; t: string }) => void) => (
    <div className="flex flex-wrap items-end gap-2">
      <span className="w-12 pb-3 text-base font-semibold text-ink">{label}</span>
      {dated && (
        <input type="date" value={v.d} onChange={(ev) => set({ ...v, d: ev.target.value })} className="input w-44 tnum" />
      )}
      <input type="time" value={v.t} onChange={(ev) => set({ ...v, t: ev.target.value })} className="input w-36 tnum" />
      <button type="button" disabled={busy}
              onClick={() => {
                const now = { d: ymd(), t: hhmm() };
                set(now);
                onDone(label === '시작' ? now : a, label === '종료' ? now : b);
              }}
              className="btn-ghost">지금</button>
    </div>
  );
  return (
    <div className="space-y-2">
      {row('시작', a, setA)}
      {row('종료', b, setB)}
      <p className="text-xs text-muted">«지금» 은 누르면 바로 저장됩니다. 시각을 손으로 고쳤으면 «저장» 을 누르십시오.</p>
      <button type="button" disabled={busy || (!a.t && !b.t)} onClick={() => onDone(a, b)}
              className="btn-primary w-full">저장</button>
    </div>
  );
}
