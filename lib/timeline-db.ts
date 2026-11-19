import type { Db } from './db';
import { DEFAULT_CALENDAR, type Step, type WorkCalendar } from './timeline';

/* ---------------------------------------------------------------------------
   공정 시간표 · 근무 달력 읽기 (0137). 서버 화면만 부른다.
--------------------------------------------------------------------------- */

export async function loadCalendar(db: Db): Promise<WorkCalendar> {
  const r = await db.one<{
    workdays: number[]; day_start: number; day_end: number; lunch: boolean; skip_off: boolean; holidays: string[];
  }>(
    `select workdays, day_start, day_end, lunch, skip_off,
            array(select to_char(h, 'YYYY-MM-DD') from unnest(holidays) h order by h) as holidays
       from work_calendar limit 1`);
  if (!r) return DEFAULT_CALENDAR;
  return {
    workdays: r.workdays, dayStart: r.day_start, dayEnd: r.day_end,
    lunch: r.lunch, skipOff: r.skip_off, holidays: r.holidays,
  };
}

export interface TimelineRow {
  steps: Step[];
  basis: string;
  updated_at: string | null;
  updated_by_name: string | null;
}

export async function loadTimeline(db: Db, dmId: string): Promise<TimelineRow | null> {
  const r = await db.one<{ steps: Step[]; basis: string; updated_at: string; updated_by_name: string | null }>(
    `select t.steps, t.basis,
            to_char(timezone('Asia/Seoul', t.updated_at), 'YYYY-MM-DD HH24:MI') as updated_at,
            u.full_name as updated_by_name
       from dmr_timeline t left join app_user u on u.id = t.updated_by
      where t.device_master_id = $1`, [dmId]);
  if (!r) return null;
  return {
    steps: r.steps.map((x) => ({ ...x, a: x.a ?? [], m: x.m ?? '', mn: x.mn ?? null, mx: x.mx ?? null })),
    basis: r.basis, updated_at: r.updated_at, updated_by_name: r.updated_by_name,
  };
}

/** 제품표준서 판의 이름 · 공정 */
export interface DmHead {
  id: string; label: string; revision: string; product: string;
  ops: { seq: string; code: string; name: string }[];
}

export async function loadDmHead(db: Db, dmId: string): Promise<DmHead | null> {
  const dm = await db.one<{ id: string; product: string; revision: string }>(
    `select dm.id, coalesce(dm.product_code, i.code) as product, dm.revision
       from device_master dm join item i on i.id = dm.item_id where dm.id::text = $1`, [dmId]);
  if (!dm) return null;
  const ops = await db.rows<{ seq: string; code: string; name: string }>(
    `select lpad(seq::text, 2, '0') as seq, code, name from dmr_operation
      where device_master_id = $1 order by seq`, [dm.id]);
  return { id: dm.id, label: `${dm.product} ${dm.revision}`, revision: dm.revision, product: dm.product, ops };
}
