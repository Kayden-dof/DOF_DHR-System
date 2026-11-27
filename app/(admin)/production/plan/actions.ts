'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage, type Db } from '@/lib/db';
import { requireRole } from '@/lib/session';
import { loadCalendar } from '@/lib/timeline-db';
import { loadDmPlanInputs } from '@/lib/order-plan-db';
import { proposeBatches, planNote, firstStepMin, tooManyBatches, TOO_MANY_BATCHES } from '@/lib/order-plan';
import type { FormState } from '@/lib/forms';

/* ---------------------------------------------------------------------------
   생산 > 일정의 저장 (0137). 배치 계획과 근무 달력은 계획이라 기록이 아니다 -
   고치고 지울 수 있고, 고친 것은 감사추적에 남는다.
--------------------------------------------------------------------------- */

const planner = () => requireRole(['SYS_ADMIN', 'PROD_MGR'], '생산관리자 또는 시스템관리자만 일정을 고칠 수 있습니다');

const done = () => { revalidatePath('/production/plan'); revalidatePath('/production'); };
const minOf = (v: FormDataEntryValue | null) => {
  const [h, m] = String(v ?? '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : NaN;
};

const NOT_LIVE = '시행 중인 제품표준서 판만 고를 수 있습니다. 시행 전 판은 제품표준서에서 시행일을 정한 뒤 고르십시오';

/* 저장한 계획의 주문 줄이 지시에 살아 있게 걸렸는가. 줄이나 지시가 없으면 null (할 말이 없다) */
async function lineHung(db: Db, planId: string): Promise<boolean | null> {
  const r = await db.one<{ line: string | null; wo: string | null }>(
    `select sales_order_line_id::text as line, work_order_id::text as wo from batch_plan where id = $1::uuid`, [planId]);
  if (!r?.line || !r.wo) return null;
  return (await db.val<boolean>(
    `select exists (select 1 from work_order_so_line
                     where work_order_id = $1::uuid and sales_order_line_id = $2::uuid and unlinked_at is null)`,
    [r.wo, r.line])) === true;
}

export async function savePlan(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await planner();
    const id = String(form.get('id') ?? '');
    const label = String(form.get('label') ?? '').trim();
    const dm = String(form.get('dm') ?? '');
    const startOn = String(form.get('start_on') ?? '');
    const startMin = minOf(form.get('start_time'));
    const wo = String(form.get('wo') ?? '') || null;
    const note = String(form.get('note') ?? '').trim().slice(0, 200);
    if (!label) return { error: '배치번호(예정)를 입력하십시오' };
    if (!dm) return { error: '제품표준서 판을 고르십시오' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startOn)) return { error: '시작일을 입력하십시오' };
    if (!(startMin >= 0 && startMin < 1440)) return { error: '시작 시각을 입력하십시오' };

    const saved = await withActor(user.id, async (db) => {
      /*
       * 새로 고르거나 바꾼 판은 시행 중이어야 한다 (사용자 2026-11-25 «시행전인게 뜨면 안될거같은데»).
       * 이미 그 판으로 잡아 둔 계획은 판을 그대로 두면 고칠 수 있다.
       * 고치기 전의 지시 · 주문 줄도 읽어 둔다 - 지시가 바뀐 저장에서만 주문 줄 이야기를 한다 (0167).
       */
      const before = id
        ? await db.one<{ dm: string; wo: string | null; line: string | null }>(
            `select device_master_id::text as dm, work_order_id::text as wo, sales_order_line_id::text as line
               from batch_plan where id = $1::uuid`, [id])
        : undefined;
      if (dm !== before?.dm) {
        const live = await db.val<boolean>(
          `select verified_at is not null and status = 'ACTIVE'
                  and effective_from is not null and effective_from <= (timezone('Asia/Seoul', now()))::date
             from device_master where id = $1::uuid`, [dm]);
        if (!live) throw new Error(NOT_LIVE);
      }
      if (id) {
        await db.rows(
          `update batch_plan set label = $2, device_master_id = $3::uuid, start_on = $4::date, start_min = $5,
                                 work_order_id = $6::uuid, note = $7
            where id = $1::uuid`, [id, label, dm, startOn, startMin, wo, note]);
        const woChanged = (before?.wo ?? null) !== wo;
        /*
         * 옛 지시에 이 계획의 주문 줄이 아직 살아 있게 걸려 있으면 알린다. 떼지는 않는다 -
         * 그 이음은 사람이 정한 것이라 작업 지시 화면에서 사람이 뗀다.
         */
        const stale = woChanged && before?.wo && before.line
          ? await db.val<string>(
              `select wo.batch_no from work_order wo
                where wo.id = $1::uuid
                  and exists (select 1 from work_order_so_line x
                               where x.work_order_id = wo.id and x.sales_order_line_id = $2::uuid and x.unlinked_at is null)`,
              [before.wo, before.line])
          : undefined;
        return { id, hung: woChanged ? await lineHung(db, id) : null, stale: stale ?? null };
      }
      const created = (await db.val<string>(
        `insert into batch_plan (label, device_master_id, start_on, start_min, work_order_id, note, created_by)
         values ($1, $2::uuid, $3::date, $4, $5::uuid, $6, $7) returning id`,
        [label, dm, startOn, startMin, wo, note, user.id]))!;
      return { id: created, hung: await lineHung(db, created), stale: null };
    });
    done();
    const tail = (saved.hung === true ? ' · 주문 줄도 지시에 걸었습니다'
      : saved.hung === false ? ' · 주문 줄은 지시에 걸지 못했습니다 (형명 · 주문 상태를 확인하십시오)' : '')
      + (saved.stale ? ` · 이전 지시 ${saved.stale} 에 걸린 주문 줄은 작업 지시 화면에서 떼십시오` : '');
    return {
      ok: true, message: (id ? '계획을 고쳤습니다' : '계획을 넣었습니다') + tail,
      href: `/production/plan?id=${saved.id}`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/*
 * 주문 줄에서 배치 계획을 한꺼번에 올린다 (0164). 화면이 보인 제안을 믿지 않는다 - 화면에서 받는 것은
 * 줄 · 판 · 만들 개수 · 간격뿐이고, 줄 · 시료 구간 · 시간표 · 달력은 여기서 다시 읽어 다시 셈한다.
 */
export async function addPlansFromOrder(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await planner();
    const lineId = String(form.get('line') ?? '');
    const dm = String(form.get('dm') ?? '');
    const units = Number(form.get('units'));
    const seen = Number(form.get('covered'));
    const gapRaw = String(form.get('gap') ?? '').trim();
    const gap = gapRaw === '' ? null : Number(gapRaw);
    if (!lineId || !dm) return { error: '주문 줄을 다시 고르십시오' };
    if (!Number.isInteger(units) || units <= 0 || units > 10_000_000) return { error: '만들 개수를 1 이상의 정수로 넣으십시오' };
    if (gap != null && (!Number.isInteger(gap) || gap < 0 || gap > 365)) return { error: '배치 간격은 0 이상의 근무일 수로 넣으십시오' };

    const n = await withActor(user.id, async (db) => {
      /* 같은 줄을 동시에 올리는 제출은 줄을 세운다 (오래된 화면 · 두 탭) */
      await db.val(`select pg_advisory_xact_lock(hashtext('order-plan:' || $1))`, [lineId]);
      if (!(await db.val<boolean>(`select dm_effective($1::uuid)`, [dm]))) throw new Error(NOT_LIVE);
      const row = await db.one<{
        po: string; item_code: string; due_on: string | null; dm_id: string; left_qty: number; covered: number;
        per_sheet: number | null; sheet_min: number | null; sheet_max: number | null;
      }>(
        /* 마감은 출고 마감일, 없으면 납품요청일 - 화면의 제안과 같은 셈 (0177 · 정밀 점검 E) */
        `select f.customer_po_no as po, f.item_code, to_char(coalesce(o.ship_by, f.due_on), 'YYYY-MM-DD') as due_on,
                f.dm_id::text, f.left_qty, f.covered, f.per_sheet, f.sheet_min, f.sheet_max
           from order_plan_lines() f join sales_order o on o.id = f.order_id
          where f.line_id = $1::uuid`, [lineId]);
      if (!row) throw new Error('이 주문 줄은 지금 계획을 올릴 수 없습니다 (취소 · 완료 · 시행 중인 판 없음). 화면을 새로 고치십시오');
      if (row.dm_id !== dm) throw new Error('이 주문 줄에 맞는 제품표준서 판이 바뀌었습니다. 화면을 새로 고친 뒤 다시 올리십시오');

      if (row.covered !== seen || row.left_qty - row.covered <= 0) {
        throw new Error('이 주문 줄의 덮인 개수가 바뀌었습니다. 화면을 새로 고친 뒤 다시 올리십시오');
      }
      /* 판의 시료 구간 · 시간표 · 첫 시각은 화면 · 출고 마감일 제안과 같은 곳에서 읽는다 (lib/order-plan-db) */
      const calendar = await loadCalendar(db);
      const info = (await loadDmPlanInputs(db, [dm], calendar)).get(dm);
      const steps = info?.steps ?? null;
      const startMin = info?.startMin ?? firstStepMin(null);
      const today = (await db.val<string>(`select to_char(timezone('Asia/Seoul', now()), 'YYYY-MM-DD')`)) ?? '';

      const p = proposeBatches({
        units, perSheet: row.per_sheet, sheetMin: row.sheet_min, sheetMax: row.sheet_max, sampleTiers: info?.tiers ?? [],
        steps, startMin, calendar, today, dueOn: row.due_on, gapDays: gap,
      });
      if (!p.ok) {
        throw new Error(p.reason === 'no-size'
          ? '이 형명은 장당 개수를 셀 수 없습니다. 설정 > 제품표준서에서 유효 크기를 확인하십시오'
          : '만들 개수를 넣으십시오');
      }
      if (tooManyBatches(p)) throw new Error(TOO_MANY_BATCHES);
      const total = p.batches.length;
      /* 이름에 형명을 넣는다 - 한 발주번호에 형명 줄이 둘이면 «PO 1/2» 가 둘 생겼다 (0167) */
      for (const [i, b] of p.batches.entries()) {
        await db.rows(
          `insert into batch_plan (label, device_master_id, start_on, start_min, sheets, sales_order_line_id, note, created_by)
           values ($1, $2::uuid, $3::date, $4, $5, $6::uuid, $7, $8)`,
          [`${row.po} ${row.item_code} ${i + 1}/${total}`, dm, b.startOn, startMin, b.sheets, lineId,
           planNote(p, i + 1, total), user.id]);
      }
      return total;
    }, { reason: '주문에서 계획 올림' });
    done();
    return { ok: true, message: `배치 계획 ${n}개를 올렸습니다` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function deletePlan(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await planner();
    const id = String(form.get('id') ?? '');
    await withActor(user.id, (db) => db.rows(`delete from batch_plan where id = $1::uuid`, [id]));
    done();
    return { ok: true, message: '계획을 지웠습니다', href: '/production/plan' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function saveCalendar(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await planner();
    const workdays = form.getAll('wd').map(Number).filter((n) => n >= 0 && n <= 6);
    const ds = minOf(form.get('day_start')), de = minOf(form.get('day_end'));
    const holidays = String(form.get('holidays') ?? '').split(/[,\s]+/).filter(Boolean);
    if (!workdays.length) return { error: '근무 요일을 하나 이상 고르십시오' };
    if (!(ds >= 0 && de > ds && de <= 1440)) return { error: '근무 시각을 확인하십시오 (시작 < 끝)' };
    const badDay = holidays.find((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h));
    if (badDay) return { error: `공휴일은 2026-12-25 꼴로 적습니다 (${badDay})` };
    await withActor(user.id, (db) => db.rows(
      `update work_calendar set workdays = $1::int[], day_start = $2, day_end = $3, lunch = $4,
                                skip_off = $5, holidays = $6::date[], updated_by = $7, updated_at = now()`,
      [workdays, ds, de, form.get('lunch') === 'on', form.get('skip_off') === 'on', holidays, user.id]));
    done();
    revalidatePath('/settings/dmr/timeline');
    return { ok: true, message: '근무 달력을 저장했습니다' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
