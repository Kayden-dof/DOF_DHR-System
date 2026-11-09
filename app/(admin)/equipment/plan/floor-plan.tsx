'use client';

import {
  useActionState, useEffect, useId, useMemo, useRef, useState, useTransition,
} from 'react';
import Link from 'next/link';
import type { FormState } from '@/lib/forms';
import { isNoExpiry } from '@/lib/equipment-check';
import { Msg, Tag } from '@/components/ui';
import {
  CLEAN_CLASSES, MIN_RECT_MM, autoSpots, bounds, inRects, mainRect, rectsText, snap,
  type Rect,
} from '@/lib/floor-plan';
import {
  saveRoom, drawRoom, deleteRoom, placeEquipment, bulkRooms, bulkPlace,
} from './actions';

export interface PlanRoom {
  id: string; code: string; name: string;
  clean_class: string | null; area_m2: number | null; note: string | null;
  rects: Rect[];
}
export interface PlanEquip {
  id: string; code: string; name: string;
  room_id: string | null; to_room_id: string | null;
  x: number | null; y: number | null;
  valid_until: string | null;
  /** 설비 화면 머리줄과 같은 셈 (공정 밸리데이션 기준) */
  state: 'ok' | 'warn' | 'danger' | 'none';
}

type Sel =
  | { kind: 'room'; id: string }
  | { kind: 'equip'; id: string }
  | { kind: 'draft'; rect: Rect }
  | null;

/* 방 바탕은 청정 등급을 따른다. 등급이 높을수록 포인트 색에 가깝다 */
const ROOM_FILL: Record<string, string> = {
  A: 'var(--color-brand-soft)', B: 'var(--color-brand-soft)',
  C: 'var(--color-brand-tint)', D: 'var(--color-info-bg)',
  CNC: 'var(--color-surface-low)', NC: 'var(--color-surface-sub)',
};
const DOT: Record<PlanEquip['state'], string> = {
  ok: 'var(--color-ok)', warn: 'var(--color-warn)', danger: 'var(--color-danger)',
  none: 'var(--color-faint)',
};
const STATE_TAG: Record<PlanEquip['state'], { tone: string; label: string }> = {
  ok: { tone: 'ok', label: '밸리데이션 유효' },
  warn: { tone: 'warn', label: '만료 임박' },
  danger: { tone: 'danger', label: '기한 경과 · 기록 없음' },
  none: { tone: 'quiet', label: '검교정 대상 아님' },
};

const roomLabel = (r: PlanRoom) => `${r.code} ${r.name}`;

/* 글자 폭 어림 (em). 한글은 한 칸, 숫자 · 영문 · 기호는 0.6 칸 */
const em = (s: string) =>
  [...s].reduce((a, ch) => a + (/[ㄱ-힣]/.test(ch) ? 1 : 0.6), 0);

export function FloorPlan({ rooms, equipment, writable }: {
  rooms: PlanRoom[]; equipment: PlanEquip[]; writable: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<'move' | 'draw'>('move');
  const [sel, setSel] = useState<Sel>(null);
  /* 목록에서 고른 설비. 다음에 누르는 자리에 놓인다 (손가락으로도 되게 끌기 대신 누르기) */
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const [draw, setDraw] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /* 저장이 돌아오기 전까지 옮긴 자리를 먼저 보여 준다. 새 자료가 오면 버린다 */
  const [moved, setMoved] = useState<Record<string, { x: number; y: number; room_id: string | null }>>({});
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => { setMoved({}); }, [equipment]);

  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  /* 설비마다 그릴 자리. 저장된 자리 · 방만 정한 것(자리 미정) · 아직 안 놓은 것 */
  const spots = useMemo(() => {
    const m = new Map<string, { x: number; y: number; auto: boolean }>();
    const pending = new Map<string, PlanEquip[]>();
    for (const e of equipment) {
      const o = moved[e.id];
      if (o) { m.set(e.id, { x: o.x, y: o.y, auto: false }); continue; }
      if (e.x !== null && e.y !== null) { m.set(e.id, { x: e.x, y: e.y, auto: false }); continue; }
      if (e.room_id && roomById.get(e.room_id)?.rects.length) {
        pending.set(e.room_id, [...(pending.get(e.room_id) ?? []), e]);
      }
    }
    for (const [rid, list] of pending) {
      const rect = mainRect(roomById.get(rid)!.rects)!;
      autoSpots(rect, list.length).forEach((p, i) => m.set(list[i].id, { ...p, auto: true }));
    }
    return m;
  }, [equipment, moved, roomById]);

  const box = useMemo(() => {
    const b = bounds(rooms.flatMap((r) => r.rects), [...spots.values()]);
    if (!b) return { x: 0, y: 0, w: 20000, h: 10000 };
    const pad = Math.max(b.w, b.h) * 0.03 + 500;
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  }, [rooms, spots]);

  /* 글자 · 점 크기는 도면 폭에 맞춰 잡는다. 화면에서 대략 12 · 10 px 이 된다 */
  const u = box.w;
  const fRoom = u / 70, fSmall = u / 95, dotR = u / 170, line = u / 1600;

  function toPlan(ev: { clientX: number; clientY: number }) {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }
  const roomAt = (x: number, y: number) =>
    rooms.find((r) => inRects(r.rects, x, y)) ?? null;

  function place(id: string, x: number, y: number) {
    const sx = snap(x), sy = snap(y);
    const room = roomAt(sx, sy);
    setMoved((m) => ({ ...m, [id]: { x: sx, y: sy, room_id: room?.id ?? null } }));
    setErr(null);
    start(async () => {
      const r = await placeEquipment({ id, roomId: room?.id ?? null, x: sx, y: sy });
      if (r.error) setErr(r.error);
    });
  }

  function onDown(ev: React.PointerEvent<SVGSVGElement>) {
    const p = toPlan(ev);
    if (armed) { place(armed, p.x, p.y); setSel({ kind: 'equip', id: armed }); setArmed(null); return; }
    if (mode === 'draw' && writable) {
      svgRef.current!.setPointerCapture(ev.pointerId);
      const x = snap(p.x), y = snap(p.y);
      setDraw({ x0: x, y0: y, x1: x, y1: y });
      return;
    }
    const r = roomAt(p.x, p.y);
    setSel(r ? { kind: 'room', id: r.id } : null);
  }

  function onMove(ev: React.PointerEvent<SVGSVGElement>) {
    if (!drag && !draw) return;
    const p = toPlan(ev);
    if (drag) setDrag({ ...drag, x: snap(p.x), y: snap(p.y), moved: true });
    if (draw) setDraw({ ...draw, x1: snap(p.x), y1: snap(p.y) });
  }

  function onUp() {
    if (drag) {
      if (drag.moved) place(drag.id, drag.x, drag.y);
      setSel({ kind: 'equip', id: drag.id });
      setDrag(null);
    }
    if (draw) {
      const rect = {
        x: Math.min(draw.x0, draw.x1), y: Math.min(draw.y0, draw.y1),
        w: Math.abs(draw.x1 - draw.x0), h: Math.abs(draw.y1 - draw.y0),
      };
      setDraw(null);
      if (rect.w >= MIN_RECT_MM && rect.h >= MIN_RECT_MM) setSel({ kind: 'draft', rect });
    }
  }

  function grabEquip(ev: React.PointerEvent, e: PlanEquip) {
    ev.stopPropagation();
    if (armed) return;
    const s = spots.get(e.id);
    if (!writable || mode !== 'move' || !s) { setSel({ kind: 'equip', id: e.id }); return; }
    svgRef.current!.setPointerCapture(ev.pointerId);
    setDrag({ id: e.id, x: s.x, y: s.y, moved: false });
  }

  const draft = sel?.kind === 'draft' ? sel.rect : null;
  const liveDraw = draw && {
    x: Math.min(draw.x0, draw.x1), y: Math.min(draw.y0, draw.y1),
    w: Math.abs(draw.x1 - draw.x0), h: Math.abs(draw.y1 - draw.y0),
  };
  const unplaced = equipment.filter((e) => !spots.has(e.id));
  const selRoom = sel?.kind === 'room' ? roomById.get(sel.id) ?? null : null;
  const selEquip = sel?.kind === 'equip' ? equipment.find((e) => e.id === sel.id) ?? null : null;

  return (
    <div className="space-y-5">
      <section className="qd-panel card min-w-0 overflow-hidden">
        {writable && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
            <div className="qd-tabs !mb-0" role="tablist" aria-label="배치도 손">
              {([['move', '설비 옮기기'], ['draw', '방 그리기']] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={mode === k}
                        onClick={() => { setMode(k); setArmed(null); }}
                        className={`qd-tab${mode === k ? ' qd-tab--active' : ''}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-muted">
              {armed
                ? `${equipment.find((e) => e.id === armed)?.code} 을(를) 놓을 자리를 누르십시오.`
                : mode === 'draw'
                  ? '빈 곳을 끌어 사각형을 그립니다. 50 mm 격자에 맞춰집니다.'
                  : '설비 점을 끌어 옮깁니다. 방이나 점을 누르면 아래에 내용이 나옵니다.'}
            </p>
            {armed && (
              <button type="button" onClick={() => setArmed(null)} className="qd-text-action">취소</button>
            )}
          </div>
        )}
        {err && <p role="alert" className="px-4 pt-3 text-sm text-danger">{err}</p>}

        <div className="overflow-x-auto">
          <svg
            ref={svgRef}
            viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
            className="block w-full min-w-[56rem] select-none"
            style={{
              aspectRatio: `${box.w} / ${box.h}`,
              touchAction: mode === 'draw' || drag || armed ? 'none' : 'pan-x pan-y',
              cursor: armed || mode === 'draw' ? 'crosshair' : 'default',
            }}
            onPointerDown={onDown} onPointerMove={onMove}
            onPointerUp={onUp} onPointerCancel={onUp}
            role="img" aria-label="설비 배치도"
          >
            <defs>
              <pattern id="plan-grid" width="1000" height="1000" patternUnits="userSpaceOnUse">
                <path d="M 1000 0 L 0 0 0 1000" fill="none"
                      stroke="var(--color-line-soft)" strokeWidth={line} />
              </pattern>
            </defs>
            <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#plan-grid)" />

            {rooms.map((r) => {
              const on = selRoom?.id === r.id;
              const m = mainRect(r.rects);
              return (
                <g key={r.id}>
                  {r.rects.map((rc, i) => (
                    <rect key={i} x={rc.x} y={rc.y} width={rc.w} height={rc.h}
                          fill={ROOM_FILL[r.clean_class ?? ''] ?? 'var(--color-surface)'}
                          stroke={on ? 'var(--color-brand)' : 'var(--color-line-strong)'}
                          strokeWidth={on ? line * 4 : line * 2} />
                  ))}
                  {m && (() => {
                    /*
                     * 좁은 방은 이름이 옆 방으로 넘쳐 겹쳤다. 방 폭에 맞춰 글자를
                     * 줄이고, 한 줄에 안 들어가면 번호와 이름을 두 줄로 나눈다.
                     */
                    const cx = m.x + m.w / 2;
                    const fit = m.w * 0.86;
                    const one = roomLabel(r);
                    const lines = em(one) * fRoom <= fit ? [one] : [r.code, r.name];
                    const fs = Math.max(fSmall * 0.75, Math.min(fRoom, ...lines.map((l) => fit / em(l))));
                    const sub = [r.clean_class, r.area_m2 ? `${r.area_m2}㎡` : null].filter(Boolean).join(' · ');
                    const top = m.y + m.h / 2 - ((lines.length - 1) * fs * 1.15 + (sub ? fs * 1.1 : 0)) / 2;
                    return (
                      <text x={cx} y={top} textAnchor="middle" dominantBaseline="middle"
                            fill="var(--color-ink)" style={{ pointerEvents: 'none' }}>
                        {lines.map((l, i) => (
                          <tspan key={i} x={cx} dy={i === 0 ? 0 : fs * 1.15}
                                 fontSize={fs} fontWeight={600}>{l}</tspan>
                        ))}
                        {sub && (
                          <tspan x={cx} dy={fs * 1.15} fontSize={Math.min(fSmall, fs * 0.82)}
                                 fill="var(--color-muted)">{sub}</tspan>
                        )}
                      </text>
                    );
                  })()}
                </g>
              );
            })}

            {(liveDraw ?? draft) && (() => {
              const d = (liveDraw ?? draft)!;
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <rect x={d.x} y={d.y} width={d.w} height={d.h}
                        fill="var(--color-brand-pale)" fillOpacity={0.5}
                        stroke="var(--color-brand)" strokeWidth={line * 3}
                        strokeDasharray={`${line * 12} ${line * 8}`} />
                  <text x={d.x + d.w / 2} y={d.y + d.h / 2} textAnchor="middle"
                        fontSize={fSmall} fill="var(--color-brand-deep)">
                    {d.w.toLocaleString()} × {d.h.toLocaleString()} mm
                  </text>
                </g>
              );
            })()}

            {equipment.map((e) => {
              const s = drag?.id === e.id ? { x: drag.x, y: drag.y, auto: false } : spots.get(e.id);
              if (!s) return null;
              const on = selEquip?.id === e.id;
              const pass = !!e.to_room_id;
              const fill = s.auto ? 'var(--color-surface)' : DOT[e.state];
              const common = {
                fill, stroke: s.auto ? DOT[e.state] : 'var(--color-surface)',
                strokeWidth: line * (s.auto ? 3 : 2.5),
                strokeDasharray: s.auto ? `${line * 6} ${line * 4}` : undefined,
              };
              return (
                <g key={e.id} onPointerDown={(ev) => grabEquip(ev, e)}
                   style={{ cursor: writable && mode === 'move' ? 'grab' : 'pointer', touchAction: 'none' }}>
                  <title>{`${e.code} ${e.name}`}</title>
                  {on && <circle cx={s.x} cy={s.y} r={dotR * 1.9} fill="none"
                                 stroke="var(--color-brand)" strokeWidth={line * 3} />}
                  {pass
                    ? <rect x={s.x - dotR} y={s.y - dotR} width={dotR * 2} height={dotR * 2} {...common} />
                    : <circle cx={s.x} cy={s.y} r={dotR} {...common} />}
                  <text x={s.x} y={s.y - dotR * 1.5} textAnchor="middle" fontSize={fSmall}
                        fill="var(--color-body)" style={{ pointerEvents: 'none' }}>
                    {e.code}
                  </text>
                </g>
              );
            })}

            {rooms.length === 0 && (
              <text x={box.x + box.w / 2} y={box.y + box.h / 2} textAnchor="middle"
                    fontSize={fRoom} fill="var(--color-muted)">
                {writable ? '방 그리기를 눌러 첫 방을 그리십시오.' : '그려진 방이 없습니다.'}
              </text>
            )}
          </svg>
        </div>
      </section>

      {/* 도면이 가로로 길어(37 m × 11 m) 옆 칸을 두면 도면이 작아진다. 내용은 도면 아래에 둔다 */}
      <aside className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {draft && writable && (
          <DraftForm rect={draft} rooms={rooms} onDone={() => setSel(null)} />
        )}
        {selRoom && (
          <RoomPanel key={selRoom.id} room={selRoom} writable={writable}
                     equipment={equipment.filter((e) => e.room_id === selRoom.id || e.to_room_id === selRoom.id)}
                     onPick={(id) => setSel({ kind: 'equip', id })}
                     onGone={() => setSel(null)} />
        )}
        {selEquip && (
          <EquipPanel key={selEquip.id} e={selEquip} rooms={rooms} writable={writable}
                      placed={spots.has(selEquip.id) && !spots.get(selEquip.id)!.auto}
                      onArm={() => { setArmed(selEquip.id); setMode('move'); }}
                      onError={setErr} />
        )}
        {!sel && (
          <>
            <Legend />
            <Unplaced list={unplaced} writable={writable}
                      onArm={(id) => { setArmed(id); setMode('move'); }} />
            <RoomList rooms={rooms} equipment={equipment}
                      onPick={(id) => setSel({ kind: 'room', id })} />
            {writable && <Bulk />}
          </>
        )}
        {sel && (
          <div className="lg:col-span-full">
            <button type="button" onClick={() => setSel(null)} className="qd-text-action">
              목록으로
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="qd-panel card p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Legend() {
  return (
    <Card title="읽는 법">
      <ul className="space-y-1.5 text-sm text-body">
        {(['ok', 'warn', 'danger', 'none'] as const).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="6" fill={DOT[k]} /></svg>
            {STATE_TAG[k].label}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <svg width="14" height="14" aria-hidden>
            <circle cx="7" cy="7" r="5.5" fill="var(--color-surface)" stroke="var(--color-muted)"
                    strokeWidth="1.5" strokeDasharray="3 2" />
          </svg>
          방만 정했고 자리는 미정 (끌어 놓으면 저장)
        </li>
        <li className="flex items-center gap-2">
          <svg width="14" height="14" aria-hidden><rect x="1.5" y="1.5" width="11" height="11" fill="var(--color-muted)" /></svg>
          벽에 걸친 설비 (패스박스 · 패스스루)
        </li>
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        방 바탕색은 청정 등급입니다. 진할수록 등급이 높습니다.
      </p>
    </Card>
  );
}

function Unplaced({ list, writable, onArm }: {
  list: PlanEquip[]; writable: boolean; onArm: (id: string) => void;
}) {
  return (
    <Card title={`아직 안 놓은 설비 ${list.length}대`}>
      {list.length === 0 ? (
        <p className="text-sm text-muted">모든 설비가 배치도에 있습니다.</p>
      ) : (
        <ul className="max-h-72 divide-y divide-line-soft overflow-y-auto">
          {list.map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-1.5">
              <code className="font-mono text-sm">{e.code}</code>
              <span className="min-w-0 flex-1 truncate text-sm text-body">{e.name}</span>
              {writable && (
                <button type="button" onClick={() => onArm(e.id)} className="qd-text-action">놓기</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RoomList({ rooms, equipment, onPick }: {
  rooms: PlanRoom[]; equipment: PlanEquip[]; onPick: (id: string) => void;
}) {
  if (rooms.length === 0) return null;
  return (
    <Card title={`방 ${rooms.length}개`}>
      <ul className="divide-y divide-line-soft">
        {rooms.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onPick(r.id)}
                    className="flex w-full items-center gap-2 py-1.5 text-left hover:text-brand">
              <code className="font-mono text-sm">{r.code}</code>
              <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
              <span className="tnum text-xs text-muted">
                {equipment.filter((e) => e.room_id === r.id).length}대
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RoomFields({ room }: { room?: PlanRoom }) {
  const uid = useId();
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="label" htmlFor={`${uid}-code`}>방 번호</label>
        <input id={`${uid}-code`} name="code" required defaultValue={room?.code}
               placeholder="101" autoComplete="off" className="input font-mono" />
      </div>
      <div>
        <label className="label" htmlFor={`${uid}-cls`}>청정 등급</label>
        <select id={`${uid}-cls`} name="clean_class" defaultValue={room?.clean_class ?? ''} className="input">
          <option value="">없음</option>
          {CLEAN_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="col-span-2">
        <label className="label" htmlFor={`${uid}-name`}>이름</label>
        <input id={`${uid}-name`} name="name" required defaultValue={room?.name}
               placeholder="전실1" autoComplete="off" className="input" />
      </div>
      <div className="col-span-2">
        <label className="label" htmlFor={`${uid}-area`}>면적 (㎡, 서면 도면 값)</label>
        <input id={`${uid}-area`} name="area_m2" inputMode="decimal" autoComplete="off"
               defaultValue={room?.area_m2 ?? ''} className="input tnum" />
      </div>
    </div>
  );
}

function DraftForm({ rect, rooms, onDone }: {
  rect: Rect; rooms: PlanRoom[]; onDone: () => void;
}) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(drawRoom, {});
  const [target, setTarget] = useState('');
  useEffect(() => { if (state.ok) onDone(); }, [state, onDone]);

  return (
    <Card title="그린 사각형">
      <p className="tnum text-sm text-body">
        {rect.w.toLocaleString()} × {rect.h.toLocaleString()} mm
        <span className="text-muted"> · 왼쪽 위 {rect.x.toLocaleString()}, {rect.y.toLocaleString()}</span>
      </p>
      <form action={action} className="mt-3 space-y-3">
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <input key={k} type="hidden" name={k} value={rect[k]} />
        ))}
        <div>
          <label className="label" htmlFor={`${uid}-room`}>어디에</label>
          <select id={`${uid}-room`} name="room_id" value={target}
                  onChange={(e) => setTarget(e.target.value)} className="input">
            <option value="">새 방</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{roomLabel(r)} 에 더하기</option>)}
          </select>
        </div>
        {target === '' && <RoomFields />}
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className="btn-primary h-9">
            {target ? '사각형 더하기' : '방 만들기'}
          </button>
          <button type="button" onClick={onDone} className="btn-ghost h-9">버리기</button>
        </div>
        <Msg state={state} />
      </form>
    </Card>
  );
}

function RoomPanel({ room, equipment, writable, onPick, onGone }: {
  room: PlanRoom; equipment: PlanEquip[]; writable: boolean;
  onPick: (id: string) => void; onGone: () => void;
}) {
  const uid = useId();
  const [state, action, pending] = useActionState<FormState, FormData>(saveRoom, {});
  const [delState, delAction, deleting] = useActionState<FormState, FormData>(deleteRoom, {});
  const [sure, setSure] = useState(false);
  useEffect(() => { if (delState.ok) onGone(); }, [delState, onGone]);

  return (
    <>
      <Card title={roomLabel(room)}>
        <p className="text-sm text-body">
          {[room.clean_class && `등급 ${room.clean_class}`, room.area_m2 && `${room.area_m2}㎡`]
            .filter(Boolean).join(' · ') || '등급 · 면적 미기재'}
        </p>
        <p className="mt-3 label">이 방의 설비 {equipment.length}대</p>
        {equipment.length === 0 ? (
          <p className="text-sm text-muted">놓인 설비가 없습니다.</p>
        ) : (
          <ul className="max-h-60 divide-y divide-line-soft overflow-y-auto">
            {equipment.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onPick(e.id)}
                        className="flex w-full items-center gap-2 py-1.5 text-left hover:text-brand">
                  <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4.5" fill={DOT[e.state]} /></svg>
                  <code className="font-mono text-sm">{e.code}</code>
                  <span className="min-w-0 flex-1 truncate text-sm">{e.name}</span>
                  {e.to_room_id && <span className="text-xs text-muted">벽</span>}
                  {e.x === null && <span className="text-xs text-muted">자리 미정</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {writable && (
        <Card title="방 고치기">
          <form action={action} className="space-y-3">
            <input type="hidden" name="id" value={room.id} />
            <RoomFields room={room} />
            <div>
              <label className="label" htmlFor={`${uid}-rects`}>모양 (한 줄에 x, y, 가로, 세로 · mm)</label>
              <textarea id={`${uid}-rects`} name="rects" rows={Math.max(2, room.rects.length + 1)}
                        defaultValue={rectsText(room.rects)} className="input font-mono tnum" />
              <p className="mt-1 text-xs leading-relaxed text-muted">
                좌표는 도면 왼쪽 위를 0 으로 둔 mm 입니다. ㄱ자 방은 두 줄로 적습니다.
              </p>
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-note`}>비고</label>
              <input id={`${uid}-note`} name="note" defaultValue={room.note ?? ''} className="input" />
            </div>
            <button type="submit" disabled={pending} className="btn-primary h-9">저장</button>
            <Msg state={state} />
          </form>
          <form action={delAction} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-soft pt-3">
            <input type="hidden" name="id" value={room.id} />
            {sure ? (
              <>
                <span className="text-xs text-muted">설비는 방에서만 빠집니다.</span>
                <button type="submit" disabled={deleting} className="qd-text-action qd-text-action--danger">
                  {room.code} 지우기
                </button>
                <button type="button" onClick={() => setSure(false)} className="qd-text-action">취소</button>
              </>
            ) : (
              <button type="button" onClick={() => setSure(true)} className="qd-text-action qd-text-action--danger">
                방 지우기
              </button>
            )}
            <Msg state={delState} />
          </form>
        </Card>
      )}
    </>
  );
}

function EquipPanel({ e, rooms, writable, placed, onArm, onError }: {
  e: PlanEquip; rooms: PlanRoom[]; writable: boolean; placed: boolean;
  onArm: () => void; onError: (m: string | null) => void;
}) {
  const uid = useId();
  const [busy, start] = useTransition();
  const room = rooms.find((r) => r.id === e.room_id) ?? null;
  const to = rooms.find((r) => r.id === e.to_room_id) ?? null;

  function save(next: { roomId: string | null; toRoomId: string | null; keepPos: boolean }) {
    onError(null);
    start(async () => {
      const r = await placeEquipment({
        id: e.id, roomId: next.roomId, toRoomId: next.toRoomId,
        x: next.keepPos ? e.x : null, y: next.keepPos ? e.y : null,
      });
      if (r.error) onError(r.error);
    });
  }

  return (
    <Card title={`${e.code} ${e.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={STATE_TAG[e.state].tone}>{STATE_TAG[e.state].label}</Tag>
        {e.valid_until && e.state !== 'none' && (
          <span className="tnum text-xs text-muted">
            {isNoExpiry(e.valid_until) ? '최초 1회 · 기한 없음' : `${e.valid_until} 까지`}
          </span>
        )}
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted">방</dt>
          <dd>{room ? roomLabel(room) : e.x !== null ? '방 밖' : '아직 안 놓음'}</dd></div>
        {to && <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted">건너편</dt>
          <dd>{roomLabel(to)}</dd></div>}
        <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted">자리</dt>
          <dd className="tnum">{placed && e.x !== null ? `${e.x.toLocaleString()}, ${e.y!.toLocaleString()} mm` : '미정'}</dd></div>
      </dl>

      {writable && (
        <div className="mt-4 space-y-3 border-t border-line-soft pt-3">
          <div>
            <label className="label" htmlFor={`${uid}-room`}>방</label>
            <select id={`${uid}-room`} value={e.room_id ?? ''} disabled={busy}
                    onChange={(ev) => save({
                      roomId: ev.target.value || null,
                      toRoomId: e.to_room_id === ev.target.value ? null : e.to_room_id,
                      keepPos: false,
                    })}
                    className="input">
              <option value="">방 밖 · 안 놓음</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{roomLabel(r)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-to`}>벽 건너편 방 (패스박스만)</label>
            <select id={`${uid}-to`} value={e.to_room_id ?? ''} disabled={busy || !e.room_id}
                    onChange={(ev) => save({ roomId: e.room_id, toRoomId: ev.target.value || null, keepPos: true })}
                    className="input">
              <option value="">없음</option>
              {rooms.filter((r) => r.id !== e.room_id).map((r) => (
                <option key={r.id} value={r.id}>{roomLabel(r)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onArm} className="btn-ghost h-9">자리 누르기</button>
            {(e.room_id || e.x !== null) && (
              <button type="button" disabled={busy}
                      onClick={() => save({ roomId: null, toRoomId: null, keepPos: false })}
                      className="qd-text-action qd-text-action--danger">배치도에서 빼기</button>
            )}
          </div>
        </div>
      )}
      <Link href="/equipment" className="qd-text-action mt-4 inline-block">설비 화면에서 보기</Link>
    </Card>
  );
}

function Bulk() {
  const uid = useId();
  const [rs, roomAction, roomPending] = useActionState<FormState, FormData>(bulkRooms, {});
  const [ps, placeAction, placePending] = useActionState<FormState, FormData>(bulkPlace, {});
  return (
    <Card title="한꺼번에 넣기">
      <details>
        <summary className="cursor-pointer text-sm text-body">방 여럿</summary>
        <form action={roomAction} className="mt-3 space-y-2">
          <label className="label" htmlFor={`${uid}-rooms`}>번호 · 이름 · 등급 · 면적 · x · y · 가로 · 세로 (탭 · 쉼표 · | 로 가름)</label>
          <textarea id={`${uid}-rooms`} name="text" rows={6} className="input font-mono"
                    placeholder={'104\t청정실1\tC\t81.26\t23025\t150\t13650\t5953'} />
          <p className="text-xs leading-relaxed text-muted">
            같은 번호를 여러 줄 적으면 사각형이 여럿인 방입니다. 있는 번호는 고쳐 씁니다.
          </p>
          <button type="submit" disabled={roomPending} className="btn-ghost h-9">방 넣기</button>
          <Msg state={rs} />
        </form>
      </details>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-body">설비 여럿</summary>
        <form action={placeAction} className="mt-3 space-y-2">
          <label className="label" htmlFor={`${uid}-place`}>설비 코드 · 방 번호 · 건너편 방 · x · y (뒤 셋은 비워도 됨)</label>
          <textarea id={`${uid}-place`} name="text" rows={6} className="input font-mono"
                    placeholder={'M-008\t109\nM-004\t111\t103'} />
          <p className="text-xs leading-relaxed text-muted">
            자리를 비우면 방 안에 «자리 미정» 으로 줄 섭니다. 끌어 놓으면 그 자리가 저장됩니다.
          </p>
          <button type="submit" disabled={placePending} className="btn-ghost h-9">설비 놓기</button>
          <Msg state={ps} />
        </form>
      </details>
    </Card>
  );
}
