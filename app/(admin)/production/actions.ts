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

/* ---------------------------------------------------------------------------
   제품 부적합 기록

   무엇이 부적합인지, 재작업으로 살릴지 특채로 낼지 폐기할지는 사람이 서면으로
   정한다. 여기 적히는 것은 그 결정의 결과다 (§1).

   한 개체는 셋 중 하나로만 끝난다. 그래서 재작업 · 특채 · 불량을 더하면 발생
   수량이 되고, 살아난 만큼 불량은 저절로 줄어든다. 빼기를 손으로 하지 않는다.

   폐기로 끝난 수량만큼 그 로트의 출하 가능 수량이 준다. 그 셈은 DB 가 한다
   (trg_nc_reduce).
--------------------------------------------------------------------------- */
export async function recordNonconformity(
  _p: FormState, form: FormData,
): Promise<FormState> {
  try {
    const me = await mgr();
    const woId = String(form.get('work_order_id') ?? '');
    const outcome = String(form.get('outcome') ?? '');
    const qty = Number(form.get('qty') ?? 0);
    const reason = String(form.get('reason_code') ?? '').trim();

    if (!['REWORK', 'CONCESSION', 'SCRAP'].includes(outcome)) {
      return { error: '결말을 고르십시오' };
    }
    if (!Number.isInteger(qty) || qty < 1) {
      return { error: '수량은 1 이상의 정수입니다' };
    }
    if (!reason) return { error: '사유를 고르십시오' };

    const approver = String(form.get('approved_by') ?? '').trim();
    const approvedOn = String(form.get('approved_on') ?? '').trim();
    /*
     * 특채 기록지 문서 코드. 이 값이 없으면 특채로 잡지 않는다 (사용자 기준).
     *
     * 정본은 품질팀이 발행한 특채 기록지이고 시스템에 적히는 것은 그 종이를
     * 가리키는 표지다. 이름만으로는 누가 정했는지는 알아도 어느 종이인지는
     * 모른다. 심사에서 묻는 것은 늘 그 종이다.
     */
    const docNo = String(form.get('concession_doc_no') ?? '').trim();
    if (outcome === 'CONCESSION' && (!approver || !approvedOn || !docNo)) {
      return { error: '특채는 기록지 문서 코드와 서면 승인자 · 승인일이 있어야 기록됩니다' };
    }

    await withActor(me.id, (db) =>
      db.rows(
        `insert into product_nonconformity
           (product_lot_id, qty, outcome, reason_code, reason_detail,
            approved_by, approved_on, found_at, registered_by)
         values ($1,$2,$3::nc_outcome,$4,$5,$6,$7::date,
                 coalesce($8::date, (timezone('Asia/Seoul', now()))::date), $9)`,
        [String(form.get('product_lot_id') ?? ''), qty, outcome, reason,
         String(form.get('reason_detail') ?? '').trim() || null,
         outcome === 'CONCESSION' ? approver : null,
         outcome === 'CONCESSION' ? approvedOn : null,
         String(form.get('found_at') ?? '') || null,
         me.id,
         /* 어디서 발견했나. 재단 이후 공정만 온다 (trg_nc_scope) */
         String(form.get('operation_id') ?? '') || null]));

    bump(woId);
    const label = outcome === 'REWORK' ? '재작업'
      : outcome === 'CONCESSION' ? '특채' : '불량';
    return { ok: true, message: `${label} ${qty}개를 기록했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   재단 전 부적합 기록

   단위가 장이다. 제품 개수와 더하지 않는다 - 한 장에서 여러 개가 나오므로
   더하는 순간 뜻을 잃는다 (0047).

   어디서 발견했는지는 공정으로 받는다. 별도의 위치 코드를 만들지 않는다 -
   dmr_operation 이 이미 모든 단계를 가지고 있고, 같은 것에 이름이 둘이면
   반드시 어긋난다.
--------------------------------------------------------------------------- */
export async function recordWipNonconformity(
  _p: FormState, form: FormData,
): Promise<FormState> {
  try {
    const me = await mgr();
    const woId = String(form.get('work_order_id') ?? '');
    const outcome = String(form.get('outcome') ?? '');
    const sheets = Number(form.get('sheets') ?? 0);
    const reason = String(form.get('reason_code') ?? '').trim();
    const opId = String(form.get('operation_id') ?? '').trim();

    if (!['REWORK', 'CONCESSION', 'SCRAP'].includes(outcome)) {
      return { error: '결말을 고르십시오' };
    }
    if (!opId) return { error: '어느 공정에서 발견했는지 고르십시오' };
    if (!Number.isInteger(sheets) || sheets < 1) {
      return { error: '장수는 1 이상의 정수입니다' };
    }
    if (!reason) return { error: '사유를 고르십시오' };

    const approver = String(form.get('approved_by') ?? '').trim();
    const approvedOn = String(form.get('approved_on') ?? '').trim();
    const docNo = String(form.get('concession_doc_no') ?? '').trim();
    if (outcome === 'CONCESSION' && (!approver || !approvedOn || !docNo)) {
      return { error: '특채는 기록지 문서 코드와 서면 승인자 · 승인일이 있어야 기록됩니다' };
    }

    await withActor(me.id, (db) =>
      db.rows(
        `insert into wip_nonconformity
           (work_order_id, operation_id, sheets, outcome, reason_code, reason_detail,
            approved_by, approved_on, concession_doc_no, found_at, registered_by)
         values ($1,$2,$3,$4::nc_outcome,$5,$6,$7,$8::date,$9,
                 coalesce($10::date, (timezone('Asia/Seoul', now()))::date), $11)`,
        [woId, opId, sheets, outcome, reason,
         String(form.get('reason_detail') ?? '').trim() || null,
         outcome === 'CONCESSION' ? approver : null,
         outcome === 'CONCESSION' ? approvedOn : null,
         outcome === 'CONCESSION' ? docNo : null,
         String(form.get('found_at') ?? '') || null,
         me.id]));

    bump(woId);
    const label = outcome === 'REWORK' ? '재작업'
      : outcome === 'CONCESSION' ? '특채' : '불량';
    return { ok: true, message: `${label} ${sheets}장을 기록했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
