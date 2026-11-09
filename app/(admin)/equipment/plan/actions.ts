'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';
import {
  CLEAN_CLASSES, MIN_RECT_MM, parseRects, snap, type Rect,
} from '@/lib/floor-plan';

/* ---------------------------------------------------------------------------
   배치도 (0125)

   방을 그리고 설비를 놓는다. 설비 기준정보와 같은 사람이 다룬다 - 생산관리자
   또는 시스템관리자. 지운 방 · 옮긴 자리는 모두 감사추적에 이전 값과 함께 남는다.
--------------------------------------------------------------------------- */

async function admin() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    throw new Error('생산관리자 또는 시스템관리자만 배치도를 고칠 수 있습니다');
  }
  return user;
}

const txt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

const bump = () => {
  revalidatePath('/equipment/plan');
  revalidatePath('/equipment');
};

function cls(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === '') return null;
  if (!(CLEAN_CLASSES as readonly string[]).includes(s)) {
    throw new Error(`청정 등급은 ${CLEAN_CLASSES.join(' · ')} 가운데 하나입니다`);
  }
  return s;
}

function area(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim().replace(/㎡|m2|,/gi, '');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error('면적은 0 보다 큰 숫자입니다 (㎡)');
  return n;
}

/** 방 등록과 수정. 모양은 «x, y, 가로, 세로» 줄로 받는다 */
export async function saveRoom(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = txt(form.get('id'));
    const code = txt(form.get('code'));
    const name = txt(form.get('name'));
    if (!code || !name) return { error: '방 번호와 이름을 적으십시오' };
    const parsed = parseRects(String(form.get('rects') ?? ''));
    if ('error' in parsed) return { error: parsed.error };

    await withActor(me.id, (db) =>
      id
        ? db.rows(
            `update room set code = $2, name = $3, clean_class = $4, area_m2 = $5,
                    note = $6, rects = $7::jsonb
              where id = $1`,
            [id, code, name, cls(form.get('clean_class')), area(form.get('area_m2')),
             txt(form.get('note')), JSON.stringify(parsed.rects)])
        : db.rows(
            `insert into room (code, name, clean_class, area_m2, note, rects)
             values ($1, $2, $3, $4, $5, $6::jsonb)`,
            [code, name, cls(form.get('clean_class')), area(form.get('area_m2')),
             txt(form.get('note')), JSON.stringify(parsed.rects)]));
    bump();
    return { ok: true, message: id ? `${code} ${name} 을(를) 고쳤습니다.` : `${code} ${name} 을(를) 그렸습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 배치도에서 끌어 그린 사각형 하나를 방으로 만든다. 이미 있는 방을 고르면
 * 그 방에 사각형을 더한다 (ㄱ자 방).
 */
export async function drawRoom(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const r: Rect = {
      x: snap(Number(form.get('x'))), y: snap(Number(form.get('y'))),
      w: snap(Number(form.get('w'))), h: snap(Number(form.get('h'))),
    };
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w < MIN_RECT_MM || r.h < MIN_RECT_MM) {
      return { error: `사각형이 너무 작습니다. 가로 · 세로 ${MIN_RECT_MM} mm 이상으로 그리십시오` };
    }
    const target = txt(form.get('room_id'));

    if (target) {
      const code = await withActor(me.id, (db) =>
        db.val<string>(
          `update room set rects = rects || jsonb_build_array($2::jsonb)
            where id = $1 returning code`, [target, JSON.stringify(r)]));
      bump();
      return { ok: true, message: `${code} 에 사각형을 더했습니다.` };
    }

    const code = txt(form.get('code'));
    const name = txt(form.get('name'));
    if (!code || !name) return { error: '새 방이면 번호와 이름을 적으십시오' };
    await withActor(me.id, (db) =>
      db.rows(
        `insert into room (code, name, clean_class, area_m2, rects)
         values ($1, $2, $3, $4, jsonb_build_array($5::jsonb))`,
        [code, name, cls(form.get('clean_class')), area(form.get('area_m2')), JSON.stringify(r)]));
    bump();
    return { ok: true, message: `${code} ${name} 을(를) 그렸습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function deleteRoom(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const id = String(form.get('id') ?? '');
    const code = await withActor(me.id, (db) =>
      db.val<string>(`delete from room where id = $1 returning code`, [id]),
      { reason: '배치도에서 방 지우기' });
    bump();
    return { ok: true, message: `${code ?? '방'} 을(를) 지웠습니다. 그 방의 설비는 방에서만 빠졌습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 설비 하나의 방과 자리. 배치도에서 끌어 놓을 때 부른다.
 * 방 밖에 놓으면 방은 비고 자리만 남는다. 둘 다 비우면 배치도에서 빠진다.
 */
export async function placeEquipment(input: {
  id: string; roomId: string | null; toRoomId?: string | null;
  x: number | null; y: number | null;
}): Promise<FormState> {
  try {
    const me = await admin();
    const hasPos = input.x !== null && input.y !== null;
    const x = hasPos ? snap(input.x!) : null;
    const y = hasPos ? snap(input.y!) : null;
    await withActor(me.id, (db) =>
      input.toRoomId === undefined
        ? db.rows(
            `update equipment set room_id = $2, pos_x_mm = $3, pos_y_mm = $4,
                    to_room_id = case when to_room_id = $2 then null else to_room_id end
              where id = $1`,
            [input.id, input.roomId, x, y])
        : db.rows(
            `update equipment set room_id = $2, to_room_id = $3, pos_x_mm = $4, pos_y_mm = $5
              where id = $1`,
            [input.id, input.roomId, input.toRoomId, x, y]));
    bump();
    return { ok: true };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* --- 한꺼번에 넣기 --------------------------------------------------------- */

/** 탭 · 세로줄 · 쉼표 어느 것으로 갈라도 된다. 방 이름에 빈칸이 있어 빈칸으로는 가르지 않는다 */
function cells(line: string): string[] {
  const by = line.includes('\t') ? '\t' : line.includes('|') ? '|' : ',';
  return line.split(by).map((s) => s.trim());
}

/**
 * 방을 줄로 받는다: 번호 · 이름 · 등급 · 면적 · x · y · 가로 · 세로.
 * 같은 번호가 여러 줄이면 사각형이 여럿인 방이다. 있는 번호면 고쳐 쓴다
 * (이름 · 등급 · 면적 · 모양을 이 줄들로 바꾼다).
 */
export async function bulkRooms(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const lines = String(form.get('text') ?? '').split(/\r?\n/).map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    if (lines.length === 0) return { error: '넣을 줄이 없습니다' };

    const rooms = new Map<string, { name: string; cls: string | null; area: number | null; rects: Rect[] }>();
    for (const [i, line] of lines.entries()) {
      const c = cells(line);
      if (c.length < 8) return { error: `${i + 1}째 줄은 칸이 8개여야 합니다 (번호 · 이름 · 등급 · 면적 · x · y · 가로 · 세로): ${line}` };
      const [code, name, k, a, ...xywh] = c;
      const n = xywh.slice(0, 4).map((s) => Number(s.replace(/[_\s]/g, '')));
      if (!code || !name) return { error: `${i + 1}째 줄에 번호와 이름이 없습니다` };
      if (n.some((v) => !Number.isFinite(v)) || n[2] < MIN_RECT_MM || n[3] < MIN_RECT_MM) {
        return { error: `${i + 1}째 줄의 x · y · 가로 · 세로가 숫자가 아니거나 너무 작습니다` };
      }
      const room = rooms.get(code) ?? { name, cls: cls(k), area: area(a), rects: [] };
      room.rects.push({ x: n[0], y: n[1], w: n[2], h: n[3] });
      rooms.set(code, room);
    }

    await withActor(me.id, async (db) => {
      for (const [code, r] of rooms) {
        await db.rows(
          `insert into room (code, name, clean_class, area_m2, rects)
           values ($1, $2, $3, $4, $5::jsonb)
           on conflict (code) do update
             set name = excluded.name, clean_class = excluded.clean_class,
                 area_m2 = excluded.area_m2, rects = excluded.rects`,
          [code, r.name, r.cls, r.area, JSON.stringify(r.rects)]);
      }
    }, { reason: '배치도 한꺼번에 넣기 (방)' });
    bump();
    return { ok: true, message: `방 ${rooms.size}개를 넣었습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 설비를 줄로 놓는다: 설비 코드 · 방 번호 · 건너편 방 번호 · x · y.
 * 건너편 방과 x · y 는 비워도 된다. 자리가 비면 방 안에 «자리 미정» 으로
 * 줄 세워 보이고, 끌어 놓을 때 저장된다.
 */
export async function bulkPlace(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await admin();
    const lines = String(form.get('text') ?? '').split(/\r?\n/).map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    if (lines.length === 0) return { error: '넣을 줄이 없습니다' };

    const rows = lines.map((line, i) => {
      const [code, room, to = '', xs = '', ys = ''] = cells(line);
      if (!code || !room) throw new Error(`${i + 1}째 줄에 설비 코드와 방 번호가 없습니다: ${line}`);
      const x = xs === '' ? null : Number(xs);
      const y = ys === '' ? null : Number(ys);
      if ((x === null) !== (y === null) || (x !== null && (!Number.isFinite(x) || !Number.isFinite(y)))) {
        throw new Error(`${i + 1}째 줄의 x · y 는 둘 다 숫자이거나 둘 다 비워야 합니다`);
      }
      return { code, room, to: to || null, x: x === null ? null : snap(x), y: y === null ? null : snap(y!) };
    });

    const n = await withActor(me.id, async (db) => {
      let done = 0;
      for (const r of rows) {
        const hit = await db.val<string>(
          `update equipment e
              set room_id = (select id from room where code = $2),
                  to_room_id = (select id from room where code = $3),
                  pos_x_mm = $4, pos_y_mm = $5
            where e.code = $1
              and exists (select 1 from room where code = $2)
              and ($3::text is null or exists (select 1 from room where code = $3))
           returning e.code`,
          [r.code, r.room, r.to, r.x, r.y]);
        if (!hit) throw new Error(`${r.code} · 방 ${r.room}${r.to ? ` · ${r.to}` : ''}: 설비나 방을 찾을 수 없습니다`);
        done++;
      }
      return done;
    }, { reason: '배치도 한꺼번에 넣기 (설비)' });
    bump();
    return { ok: true, message: `설비 ${n}대를 놓았습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
