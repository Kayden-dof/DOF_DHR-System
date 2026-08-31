'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { isWorker, isAdmin } from '@/lib/roles';
import type { FormState } from '@/lib/forms';

async function worker() {
  const user = await requireUser();
  if (!isWorker(user.roles) && !isAdmin(user.roles)) {
    throw new Error('작업자 역할이 필요합니다');
  }
  return user;
}

const bump = (wo?: string) => {
  revalidatePath('/work');
  if (wo) revalidatePath(`/work/${wo}`);
  revalidatePath('/production');
  if (wo) revalidatePath(`/production/${wo}`);
};

/* ---------------------------------------------------------------------------
   공정 기록 시작

   현장 화면에서 오는 요청이다. 자유 입력이 없다.
   일차는 화면에서 고르고, 시각은 지금으로 찍는다.
--------------------------------------------------------------------------- */
export async function startRecord(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await worker();
    const wo = String(form.get('work_order_id') ?? '');
    const rotation = String(form.get('rotation_worker_id') ?? '').trim();
    const lot = String(form.get('product_lot_id') ?? '').trim();

    await withActor(me.id, (db) =>
      db.rows(
        `insert into process_record (work_order_id, product_lot_id, operation_id, attempt,
           day_no, work_date, worker_id, rotation_worker_id, equipment_ref, started_at)
         values ($1,$2,$3,$4,$5, (timezone('Asia/Seoul', now()))::date, $6,$7,$8::uuid, now())`,
        [wo, lot || null, String(form.get('operation_id') ?? ''),
         // 회차는 비워 보낸다. DB 가 (배치, 공정, 제품로트) 기준으로 센다 (0055).
         // 화면이 세면 "오늘 내 기록"만 보게 되어, 어제 한 공정을 오늘 다시
         // 하면 회차가 1 로 돌아간다 (2차 검수 결함 7).
         null, Number(form.get('day_no') ?? 1),
         me.id, rotation || null,
         // 설비 대장을 가리키는 참조. 종이에 찍힐 코드는 DB 가 그 시점의
         // 대장에서 떠 온다 (0032). 응용이 두 값을 각각 넣으면 언젠가 어긋난다
         String(form.get('equipment_ref') ?? '').trim() || null]));

    bump(wo);
    return { ok: true, message: '공정을 시작했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/** 자재 투입. 로트를 고르고 수량은 패드로 넣는다 (S01). */
export async function issueMaterial(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await worker();
    const wo = String(form.get('work_order_id') ?? '');
    await withActor(me.id, (db) =>
      db.rows(
        `insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
         values ($1,$2,$3,$4)`,
        [String(form.get('process_record_id') ?? ''),
         String(form.get('material_lot_id') ?? ''),
         Number(form.get('qty') ?? 0), me.id]));
    bump(wo);
    return { ok: true, message: '자재를 기록했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 공정 마감 (S05).
 * 자재 구성표의 자재가 기록되지 않았으면 거부된다. 해당없음 사유를 넣으면 통과한다.
 */
export async function endRecord(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await worker();
    const wo = String(form.get('work_order_id') ?? '');
    const pr = String(form.get('process_record_id') ?? '');
    const reason = String(form.get('no_material_reason') ?? '').trim();
    const rework = String(form.get('rework_qty') ?? '').trim();

    await withActor(me.id, async (db) => {
      if (reason) {
        await db.rows(`update process_record set no_material_reason = $2 where id = $1`,
                      [pr, reason]);
      }
      if (rework) {
        await db.rows(`update process_record set rework_qty = $2 where id = $1`,
                      [pr, Number(rework)]);
      }
      await db.rows(`select complete_process($1)`, [pr]);
    });

    bump(wo);
    return { ok: true, message: '공정을 마감했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 일차 마감 (S04).
 *
 * (지시서, 일차, 작업자) 묶음이 잠기고 더 고칠 수 없다. 잠금 해제는 없다.
 * 누락은 다음 일차에 정정 기록으로 남긴다.
 *
 * ── 여기서 인쇄 기록을 만들지 않는다 ─────────────────────────────────────
 * 전에는 이 함수가 print_day_record 를 불러 대장에 1회차를 심었다. 종이는
 * 한 장도 나오지 않는데 회차만 소비되니, 실제로 프린터에서 나오는 첫 장이
 * 2회차가 되어 "재발행" 워터마크를 달고 나왔다 (2차 검수 결함 3).
 *
 * 마감과 인쇄는 다른 일이다. 마감은 "더 적을 것이 없다" 는 선언이고, 인쇄는
 * 종이가 나오는 일이다. 대장에는 실제 종이만 남아야 한다.
 *
 * 마감이 끝나면 곧바로 인쇄 화면으로 보낸다. 사람이 하는 조작은 전과 같고,
 * 그 화면이 열릴 때 1회차가 발행된다.
 */
export async function closeDay(_p: FormState, form: FormData): Promise<FormState> {
  let go = '';
  try {
    const me = await worker();
    const wo = String(form.get('work_order_id') ?? '');
    const day = Number(form.get('day_no') ?? 1);

    await withActor(me.id, (db) =>
      db.rows(`select lock_day($1,$2,$3)`, [wo, day, me.id]));

    bump(wo);
    go = `/print/day-record/${wo}/${day}/${me.id}`;
  } catch (e) {
    return { error: dbMessage(e) };
  }

  /* redirect 는 예외를 던진다. try 안에 두지 않는다 */
  redirect(go);
}

/* ---------------------------------------------------------------------------
   재단 결과 기록 (현장)

   재단한 사람이 재단한 자리에서 형명별 수량을 적는다. 제조번호는 채번 규칙이
   만들고 유효기한은 이 시점 사용기간으로 고정된다 - 관리자 화면에서 부르던
   것과 같은 함수를 지나므로 결과가 갈라지지 않는다.

   "그 배치의 재단 공정을 기록하고 있는 사람인가"는 DB 가 본다
   (cut_product_lot_field). 응용 계층에서만 막은 건 검증이 아니다 (§1).
--------------------------------------------------------------------------- */
export async function cutAtField(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await worker();
    const wo = String(form.get('work_order_id') ?? '');
    const produced = Number(form.get('qty_produced') ?? 0);
    const sample = Number(form.get('qty_sample') ?? 0);

    if (!Number.isInteger(produced) || produced < 1) {
      return { error: '생산 수량을 입력하십시오' };
    }
    if (sample >= produced) {
      return { error: '샘플 수량이 생산 수량보다 적어야 합니다' };
    }

    const lot = await withActor(me.id, (db) =>
      db.val<string>(`select cut_product_lot_field($1,$2,$3,$4,$5::date)`,
        [wo, String(form.get('item_id') ?? ''), produced, sample,
         String(form.get('manufactured_on') ?? '') || null]));

    const lotNo = await withActor(me.id, (db) =>
      db.val<string>(`select lot_no from product_lot where id=$1`, [lot]));

    bump(wo);
    return {
      ok: true,
      message: `제조번호 ${lotNo} · 생산 ${produced}개 중 샘플 ${sample}개를 빼면 출하 가능 ${produced - sample}개입니다.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   자재 투입 정정 · 반납

   잘못 적은 투입을 종이에서 고치듯 고친다. 지우지 않는다 (§1). 원래 값은
   감사추적에 남고, 정정 사유는 기록지에 함께 찍힌다.

   누가 고칠 수 있는지와 언제까지 고칠 수 있는지는 DB 가 본다. 적은 사람만
   고칠 수 있고 (amend_material_issue), 인쇄해서 잠긴 뒤에는 못 고친다 (S04).
   응용 계층에서만 막은 건 검증이 아니다.
--------------------------------------------------------------------------- */
export async function amendIssue(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await worker();
    const wo = String(form.get('work_order_id') ?? '');
    const qty = Number(form.get('qty') ?? 0);
    const reason = String(form.get('reason') ?? '').trim();

    if (!Number.isFinite(qty) || qty <= 0) {
      return { error: '수량은 0보다 커야 합니다' };
    }
    if (!reason) return { error: '정정 사유를 입력해야 합니다' };

    await withActor(me.id, (db) =>
      db.rows(`select amend_material_issue($1,$2,$3)`,
        [String(form.get('id') ?? ''), qty, reason]));

    bump(wo);
    return { ok: true, message: `투입 수량을 ${qty}(으)로 정정했습니다. 원래 값은 기록에 남습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function returnIssue(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await worker();
    const wo = String(form.get('work_order_id') ?? '');
    const qty = Number(form.get('qty') ?? 0);
    const reason = String(form.get('reason') ?? '').trim();

    if (!Number.isFinite(qty) || qty <= 0) {
      return { error: '반납 수량은 0보다 커야 합니다' };
    }
    if (!reason) return { error: '반납 사유를 입력해야 합니다' };

    await withActor(me.id, (db) =>
      db.rows(`select return_material_issue($1,$2,$3)`,
        [String(form.get('id') ?? ''), qty, reason]));

    bump(wo);
    return { ok: true, message: `${qty}을(를) 원 로트로 반납했습니다. 투입 기록은 그대로 남습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
