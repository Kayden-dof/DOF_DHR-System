'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

async function mgr() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    throw new Error('생산관리자 또는 시스템관리자만 작업 지시를 다룰 수 있습니다');
  }
  return user;
}

const bump = (id?: string) => {
  revalidatePath('/production');
  if (id) revalidatePath(`/production/${id}`);
  revalidatePath('/');
  revalidatePath('/work');
};

/* ---------------------------------------------------------------------------
   작업 지시 발행 (§4.5)

   지시서번호와 배치번호는 채번 규칙이 만든다. 응용에서 조합하지 않는다 (§10).
   원재료 로트는 단일 컬럼이라 배치당 1개가 구조적으로 강제된다.
   생산과 품질은 같은 사람일 수 없다.
--------------------------------------------------------------------------- */
export async function issueWorkOrder(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const dmId = String(form.get('device_master_id') ?? '');

    const out = await withActor(me.id, async (db) => {
      const dm = await db.one<{ revision: string; verified_at: Date | null }>(
        `select revision, verified_at from device_master where id = $1`, [dmId]);
      if (!dm) throw new Error('제품표준서를 찾을 수 없습니다');
      if (!dm.verified_at) {
        throw new Error('서면 대조 확인이 끝나지 않은 제품표준서로는 발행할 수 없습니다');
      }

      const woNo = await db.val<string>(`select next_number('WORK_ORDER')`);
      const batchNo = await db.val<string>(`select next_number('BATCH')`);

      /*
       * 예정 생산 수량. 형명이 아니라 개수만 받는다.
       *
       * 형명은 재단에서 정해지므로 (§3 ①) 착수 전 종이에 적지 않는다. 개수는
       * 포장재 소요량(PER_UNIT)의 셈에 필요해 남긴다. 비워 두면 지시서에
       * "재단 후 확정" 으로 인쇄되고 그것도 정상이다.
       */
      const rawUnits = String(form.get('planned_units') ?? '').trim();
      const units = rawUnits === '' ? null : Number(rawUnits);
      if (units !== null && (!Number.isInteger(units) || units < 1)) {
        throw new Error('예정 생산 수량은 1 이상의 정수이거나 비워 둡니다');
      }

      const row = await db.one<{ id: string }>(
        `insert into work_order (wo_no, batch_no, device_master_id, dmr_revision,
           material_lot_id, sheet_count, issued_by_prod, issued_by_qa, planned_units)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [woNo, batchNo, dmId, dm.revision,
         String(form.get('material_lot_id') ?? ''),
         Number(form.get('sheet_count') ?? 0),
         String(form.get('issued_by_prod') ?? ''),
         String(form.get('issued_by_qa') ?? ''),
         units]);

      return { id: row!.id, woNo, batchNo, planned: units };
    });

    bump(out.id);
    return {
      ok: true,
      message:
        `지시서 ${out.woNo} · 배치 ${out.batchNo}를 발행했습니다. ` +
        (out.planned ? `예정 ${out.planned}개. ` : '') +
        '작업 지시서를 인쇄해 현장에 내리십시오.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function cancelWorkOrder(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    const reason = String(form.get('cancelled_reason') ?? '').trim();
    if (!reason) return { error: '취소 사유를 입력하십시오. 번호는 소멸하며 그 사유가 설명이 됩니다' };

    await withActor(me.id, (db) =>
      db.rows(`update work_order set status='CANCELLED', cancelled_reason=$2 where id=$1`,
              [id, reason]));
    bump(id);
    return {
      ok: true,
      message: '작업 지시를 취소했습니다. 지시서번호와 배치번호는 소멸하며 재사용하지 않습니다.',
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function finishWorkOrder(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    await withActor(me.id, (db) =>
      db.rows(`update work_order set status='DONE' where id=$1 and status <> 'CANCELLED'`, [id]));
    bump(id);
    return { ok: true, message: '배치를 종료했습니다. 편철 표지를 인쇄하십시오.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   재단 분할 (§3 "재단에서 형명별로 분할 · 제조번호 부여")

   제조번호는 next_number()가 만들고, 유효기한은 생성 시점 값으로 고정된다.
--------------------------------------------------------------------------- */
export async function cutLot(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const woId = String(form.get('work_order_id') ?? '');
    const produced = Number(form.get('qty_produced') ?? 0);
    const sample = Number(form.get('qty_sample') ?? 0);

    if (sample >= produced) return { error: '샘플 수량이 생산 수량보다 적어야 합니다' };

    const lot = await withActor(me.id, (db) =>
      db.val<string>(`select cut_product_lot($1,$2,$3,$4,$5::date)`,
        [woId, String(form.get('item_id') ?? ''), produced, sample,
         String(form.get('manufactured_on') ?? '') || null]));

    const lotNo = await withActor(me.id, (db) =>
      db.val<string>(`select lot_no from product_lot where id=$1`, [lot]));

    bump(woId);
    return {
      ok: true,
      message: `제조번호 ${lotNo}를 부여했습니다. 출하 가능 수량은 ${produced - sample}개입니다.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function setLotStatus(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    const woId = String(form.get('work_order_id') ?? '');
    await withActor(me.id, (db) =>
      db.rows(`update product_lot set status=$2::pl_status, location=$3 where id=$1`,
        [id, String(form.get('status') ?? 'CUT'),
         String(form.get('location') ?? '').trim() || null]));
    bump(woId);
    return { ok: true, message: '제품 로트를 갱신했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   인쇄물 회수 기록

   재발행하면 앞서 뽑은 종이가 현장에 남는다. 같은 기록의 종이가 두 장 도는 것이
   이 시스템에서 가장 위험한 상태다. 거둬들였다는 사실을 남겨 둔다.

   되돌릴 수 없다. 이미 회수로 적힌 것을 안 한 것으로 만들 수 없다. DB 함수가
   그것을 막고, 여기서는 예외 문구를 그대로 올린다.
--------------------------------------------------------------------------- */
export async function retrievePrint(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('print_id') ?? '');
    const reason = String(form.get('reason') ?? '').trim();
    if (!reason) return { error: '회수 사유를 입력하십시오' };

    await withActor(me.id, (db) =>
      db.rows(`select retrieve_print($1, $2)`, [id, reason]));

    bump(String(form.get('work_order_id') ?? ''));
    return { ok: true, message: '회수로 기록했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
