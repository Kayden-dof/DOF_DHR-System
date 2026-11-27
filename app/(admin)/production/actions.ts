'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import { PL_MANUAL_STATUS, type FormState } from '@/lib/forms';

async function mgr() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    throw new Error('생산관리자 또는 시스템관리자만 작업 지시를 다룰 수 있습니다');
  }
  return user;
}

/* 빈 칸은 null 로 둔다. 빈 문자열을 넣으면 "적었는데 비어 있다" 가 된다 */
const txt = (v: FormDataEntryValue | null) => {
  const t = String(v ?? '').trim();
  return t === '' ? null : t;
};

const bump = (id?: string) => {
  revalidatePath('/production');
  if (id) revalidatePath(`/production/${id}`);
  revalidatePath('/');
  revalidatePath('/work');
};

/* ---------------------------------------------------------------------------
   자리에 없는 사람의 공정을 대신 마감한다 (0085 의 짝)

   0085 부터 종료 시각이 없는 공정이 있으면 그 묶음을 잠글 수 없다. 그런데
   생산관리자가 **남의 묶음을 마감하는 길**이 설계에 있다 - "작업자가 자리에
   없는데 종이가 필요한 일이 있다" (0063). 그 사람이 공정을 열어 둔 채
   나갔으면, 0085 만 두었을 때 생산관리자는 막히고 풀 자리가 없다.
   잠금 해제가 없으므로(§10) 갇히는 것과 같다.

   그래서 여는 문이 이것 하나다. 현장 화면은 본인 기록만 보여 주므로
   (myRecords), 남의 것을 마감하는 자리는 배치 화면이다.

   ── 판정하지 않는다 ────────────────────────────────────────────────────
   무엇이 옳은 종료 시각인지 정하지 않는다. `complete_process` 가 하던 대로
   지금 시각을 찍을 뿐이고, **누가 왜 대신 찍었는지**가 감사추적에 남는다
   (audit_log.reason · 0061). 사유는 비워 둘 수 없다.
--------------------------------------------------------------------------- */
export async function endRecordForWorker(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const pr = String(form.get('process_record_id') ?? '');
    const wo = String(form.get('work_order_id') ?? '');
    const why = txt(form.get('reason'));
    const noMat = txt(form.get('no_material_reason'));

    if (!pr) return { error: '어느 기록인지 알 수 없습니다' };
    if (!why) return { error: '왜 대신 마감하는지 적으십시오' };

    await withActor(me.id, async (db) => {
      if (noMat) {
        await db.rows(`update process_record set no_material_reason = $2 where id = $1`,
                      [pr, noMat]);
      }
      await db.rows(`select complete_process($1)`, [pr]);
    }, { reason: `대신 마감 · ${why}` });

    bump(wo);
    return { ok: true, message: '공정을 마감했습니다. 누가 왜 대신 마감했는지 감사추적에 남았습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

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
      /*
       * 개정번호만 읽는다. 쓸 수 있는 표준서인지는 DB 가 본다 (0061).
       *
       * 전에는 여기서 verified_at 만 보고 있었고 status 도 effective_from 도
       * 조회하지 않았다. 그래서 DRAFT 이고 발효일이 2099년인 표준서로도
       * 작업 지시가 발행되었다 (3차 검수 결함 5). 응용 계층에서만 막은 건
       * 검증이 아니다 (§1) - 판정을 DB 로 옮기고 여기서는 예외를 그대로 올린다.
       */
      const dm = await db.one<{ revision: string }>(
        `select revision from device_master where id = $1`, [dmId]);
      if (!dm) throw new Error('제품표준서를 찾을 수 없습니다');

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

      /* 이 배치로 채울 주문 줄 (0159 · 고르기는 권고, 비면 내부 발행) */
      const lines = form.getAll('so_line').map(String).filter(Boolean);
      for (const line of lines) {
        await db.rows(
          `insert into work_order_so_line (work_order_id, sales_order_line_id, linked_by) values ($1,$2,$3)`,
          [row!.id, line, me.id]);
      }

      /*
       * 배치 계획에서 냈으면 그 계획에 잇는다 (정밀 점검 E · 2026-11-27). 같은 트랜잭션이라 잇지 못하면 발행도
       * 되돌린다. 판이 다르면 DB 가 거부한다 (0137 trg_batch_plan_wo). 계획의 주문 줄은 0164 트리거가 이
       * 지시에 건다 - 폼에서 이미 골랐으면 그대로 둔다.
       */
      const planId = String(form.get('plan_id') ?? '').trim();
      let planLabel: string | null = null;
      if (planId) {
        planLabel = (await db.val<string>(
          `update batch_plan set work_order_id = $2
            where id = $1::uuid
              and (work_order_id is null
                   or exists (select 1 from work_order w where w.id = batch_plan.work_order_id and w.status = 'CANCELLED'))
            returning label`, [planId, row!.id])) ?? null;
        if (!planLabel) throw new Error('이 배치 계획에는 이미 다른 작업 지시가 이어져 있습니다. 일정 화면을 새로 고치십시오');
      }

      return { id: row!.id, woNo, batchNo, planned: units, lines: lines.length, planLabel };
    });

    bump(out.id);
    return {
      ok: true,
      message:
        `지시서 ${out.woNo} · 배치 ${out.batchNo}를 발행했습니다. ` +
        (out.planned ? `예정 ${out.planned}개. ` : '') +
        (out.lines ? `주문 줄 ${out.lines}개에 걸었습니다. ` : '') +
        (out.planLabel ? `배치 계획 ${out.planLabel}에 이었습니다. ` : '') +
        '작업 지시서를 인쇄해 현장에 내리십시오.',
      /*
       * 발행 뒤 인쇄로 가는 길 (UI/UX 검수 2026-11-11). 전에는 «인쇄해 내리십시오»
       * 라고만 하고 갈 곳이 없어, 목록에서 배치를 찾아 열어야 했다. 여는 것은
       * 미리보기이고 남기는 것은 그 화면의 인쇄 단추다.
       */
      href: `/print/work-order/${out.id}`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 지시서 번호를 종이 번호에 맞춘다 (0127 · 사용자 2026-11-09 «작업 지시번호는 WO-261103-01»).
 *
 * 종이 지시서가 먼저 나가고 DHR 에 뒤에 옮겨 적으면 채번 규칙의 번호와 종이 번호가
 * 다르다. 종이가 먼저다. 계보는 id 로 이어지므로 번호만 바꾸고, 사유는 비울 수 없다.
 */
export async function setWorkOrderNo(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    const no = String(form.get('wo_no') ?? '').trim().toUpperCase();
    const why = txt(form.get('reason'));
    if (!/^WO-\d{6}-\d{2,}$/.test(no)) return { error: '지시서 번호는 WO-YYMMDD-NN 꼴로 적으십시오 (예: WO-261103-01)' };
    if (!why) return { error: '왜 바꾸는지 적으십시오' };
    const old = await withActor(me.id, async (db) => {
      const prev = await db.val<string>(`select wo_no from work_order where id = $1`, [id]);
      await db.rows(`update work_order set wo_no = $2 where id = $1`, [id, no]);
      return prev;
    }, { reason: `지시서 번호 고침 · ${why}` });
    bump(id);
    return { ok: true, message: `지시서 번호를 ${old} 에서 ${no} 로 고쳤습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 잠긴 기록의 자재 미사용 사유를 고친다 - 강제 정정 (0128 · 사용자 2026-11-10).
 *
 * 일차를 마감한 뒤에는 기록을 고칠 길이 없다. 잠금을 풀지 않고 이 한 칸만
 * 시스템관리자가 사유와 함께 고친다. 판정은 DB 함수가 한다 - 시스템관리자인가,
 * 잠긴 기록인가, 사유로 마감한 기록인가. 무엇을 무엇으로 왜 고쳤는지 정정
 * 내역과 감사추적에 남는다.
 */
export async function forceCorrectReason(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await requireUser();
    if (!hasRole(user, 'SYS_ADMIN')) return { error: '강제 정정은 시스템관리자만 할 수 있습니다' };
    const pr = String(form.get('process_record_id') ?? '');
    const woId = String(form.get('work_order_id') ?? '');
    const value = txt(form.get('value'));
    const why = txt(form.get('why'));
    if (!value) return { error: '고칠 내용을 적으십시오' };
    if (!why) return { error: '왜 고치는지 적으십시오' };
    await withActor(user.id, (db) =>
      db.rows(`select force_correct_reason($1, $2, $3)`, [pr, value, why]),
      { reason: `강제 정정 · ${why}` });
    bump(woId);
    return { ok: true, message: '강제 정정했습니다. 정정 내역이 이 기록 아래에 남습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 배치번호를 종이 번호에 맞춘다 (0131 · 사용자 2026-11-10 «배치 번호도 … B261104-01 임»).
 * 기록이 붙은 지시면 까닭이 있어야 바뀐다 (DB 가 막는다). 계보는 id 로 이어진다.
 */
export async function setBatchNo(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    const no = String(form.get('batch_no') ?? '').trim().toUpperCase();
    const why = txt(form.get('reason'));
    if (!/^B\d{6}-\d{2,}$/.test(no)) return { error: '배치번호는 BYYMMDD-NN 꼴로 적으십시오 (예: B261104-01)' };
    if (!why) return { error: '왜 바꾸는지 적으십시오' };
    const old = await withActor(me.id, async (db) => {
      const prev = await db.val<string>(`select batch_no from work_order where id = $1`, [id]);
      await db.rows(`update work_order set batch_no = $2 where id = $1`, [id, no]);
      return prev;
    }, { reason: `배치번호 고침 · ${why}` });
    bump(id);
    return { ok: true, message: `배치번호를 ${old} 에서 ${no} 로 고쳤습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 작업 지시 발행 일시를 종이 지시서에 맞춘다 (0141 · 사용자 2026-11-20).
 * 받는 날 바로 입력하면 입력한 때가 곧 발행일이다. 늦게 옮겨 적은 지시서만 고친다.
 * 시스템관리자만, 까닭과 함께. 미래 · 이미 적힌 작업일보다 늦은 날은 DB 가 막는다.
 */
export async function setIssuedAt(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await requireUser();
    if (!hasRole(user, 'SYS_ADMIN')) return { error: '발행 일시는 시스템관리자만 고칠 수 있습니다' };
    const id = String(form.get('id') ?? '');
    const at = txt(form.get('issued_at'));
    const why = txt(form.get('reason'));
    if (!at || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(at)) {
      return { error: '발행 일시를 적으십시오' };
    }
    if (!why) return { error: '왜 고치는지 적으십시오' };
    /* datetime-local 은 시간대가 없다. 한국 시각으로 읽는다 */
    const iso = `${at.length === 16 ? `${at}:00` : at}+09:00`;
    const [before, after] = await withActor(user.id, async (db) => {
      const show = `to_char(timezone('Asia/Seoul', issued_at), 'YYYY-MM-DD HH24:MI:SS')`;
      const prev = await db.val<string>(`select ${show} from work_order where id = $1`, [id]);
      const next = await db.val<string>(
        `update work_order set issued_at = $2::timestamptz where id = $1 returning ${show}`, [id, iso]);
      return [prev, next];
    }, { reason: `발행 일시 고침 · ${why}` });
    if (!after) return { error: '작업 지시를 찾을 수 없습니다' };
    bump(id);
    return { ok: true, message: `발행 일시를 ${before} 에서 ${after} 로 고쳤습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/**
 * 잠긴 기록의 작업일 · 시작 · 종료 시각을 종이 기록에 맞춘다 - 강제 정정 (0131).
 * 시스템관리자만. 비운 칸은 그대로 둔다. 칸마다 정정 내역이 남는다.
 */
export async function forceCorrectTimes(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const user = await requireUser();
    if (!hasRole(user, 'SYS_ADMIN')) return { error: '강제 정정은 시스템관리자만 할 수 있습니다' };
    const pr = String(form.get('process_record_id') ?? '');
    const woId = String(form.get('work_order_id') ?? '');
    const wd = txt(form.get('work_date'));
    /* datetime-local 은 시간대가 없다. 한국 시각으로 읽는다 */
    const kst = (v: string | null) => (v ? `${v.length === 16 ? `${v}:00` : v}+09:00` : null);
    const st = kst(txt(form.get('started_at')));
    const en = kst(txt(form.get('ended_at')));
    const why = txt(form.get('why'));
    if (!why) return { error: '왜 고치는지 적으십시오' };
    if (!wd && !st && !en) return { error: '고칠 칸을 하나 이상 적으십시오' };
    const n = await withActor(user.id, (db) =>
      db.val<number>(`select force_correct_times($1, $2::date, $3::timestamptz, $4::timestamptz, $5)`,
        [pr, wd, st, en, why]),
      { reason: `강제 정정 · ${why}` });
    bump(woId);
    return { ok: true, message: `${n}칸을 강제 정정했습니다. 정정 내역이 이 기록 아래에 남습니다.` };
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

    const plans = await withActor(me.id, async (db) => {
      await db.rows(`update work_order set status='CANCELLED', cancelled_reason=$2 where id=$1`,
                    [id, reason]);
      /* 이 지시에 이은 배치 계획 - 지시 없는 계획으로 다시 센다 (0177 · 정밀 점검 E). 이음은 그대로 두고 알린다 */
      return (await db.rows<{ label: string }>(
        `select label from batch_plan where work_order_id = $1 order by start_on, label`, [id])).map((x) => x.label);
    });
    bump(id);
    return {
      ok: true,
      message: '작업 지시를 취소했습니다. 지시서번호와 배치번호는 소멸하며 재사용하지 않습니다.'
        + (plans.length ? ` 이 지시에 이은 배치 계획 ${plans.join(' · ')}는 지시 없는 계획으로 다시 셉니다.`
          + ' 생산 › 일정에서 새 지시를 내거나 이으십시오.' : ''),
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function finishWorkOrder(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    const packed = await withActor(me.id, async (db) => {
      await db.rows(`update work_order set status='DONE' where id=$1 and status <> 'CANCELLED'`, [id]);
      /*
       * 생산이 끝났으니 아직 «재단 완료» 인 제품 로트는 «포장 완료» 로 (사용자 2026-11-25 «생산이 종료되었는데
       * 안나오네?»). 멸균 위탁은 포장 완료부터 받는데, 그 상태는 제품 로트 «수정» 에서 손으로만 바뀌어
       * 종료한 배치의 로트가 어디에도 나오지 않았다.
       */
      return db.rows<{ lot_no: string }>(
        `update product_lot set status = 'PACKED' where work_order_id = $1 and status = 'CUT' returning lot_no`, [id]);
    }, { reason: '배치 종료' });
    bump(id);
    revalidatePath('/shipping');
    return {
      ok: true,
      message: packed.length
        ? `배치를 종료했습니다. 제품 로트 ${packed.length}건이 포장 완료가 되어 멸균 위탁으로 보낼 수 있습니다. 편철 표지를 인쇄하십시오.`
        : '배치를 종료했습니다. 편철 표지를 인쇄하십시오.',
    };
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

/**
 * 쓰지 않은 제조번호 지우기 (0151 · 사용자 2026-11-20 «잘못넣었으면 어떻게 삭제 하는데??»).
 * 그 번호를 가리키는 기록이 하나도 없을 때만 DB 가 지운다. 번호는 다시 쓰지 않는다.
 */
export async function deleteLot(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    const wo = String(form.get('work_order_id') ?? '');
    const why = String(form.get('reason') ?? '').trim();
    if (!why) return { error: '왜 지우는지 적으십시오' };
    const no = await withActor(me.id, (db) =>
      db.val<string>(`select delete_unused_product_lot($1, $2)`, [id, why]));
    bump(wo);
    return { ok: true, message: `제조번호 ${no}를 지웠습니다. 이 번호는 다시 쓰지 않습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function setLotStatus(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    const woId = String(form.get('work_order_id') ?? '');
    const want = String(form.get('status') ?? 'CUT');
    /*
     * 승인 · 멸균 · 출고 상태는 그 일을 하는 화면만 바꾼다 (UI/UX 검수
     * 2026-11-11). 화면이 거르지만 액션도 같은 규칙으로 본다 - 지금 상태를
     * 그대로 두는 것은 된다.
     */
    const cur = await withActor(me.id, (db) =>
      db.val<string>(`select status::text from product_lot where id=$1`, [id]));
    if (want !== cur && !PL_MANUAL_STATUS.includes(want)) {
      return { error: '멸균 · 출하 승인 · 출고 상태는 그 화면에서만 바뀝니다' };
    }
    await withActor(me.id, (db) =>
      db.rows(`update product_lot set status=$2::pl_status, location=$3 where id=$1`,
        [id, want, String(form.get('location') ?? '').trim() || null]));
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
    /* 인쇄물 조회에서도 회수를 적는다 (UI/UX 검수 2026-11-11). 그 화면도 새로 읽게 */
    revalidatePath('/trace/verify');
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

    /*
     * 컬럼 목록과 값의 개수를 눈으로 세어 둔다. 열한 개다.
     *
     * 0046 이 특채 기록지 문서 코드를, 0047 이 발견 공정을 더할 때 화면과
     * 위 검사만 고치고 이 목록을 빠뜨렸다. 값은 열 개를 넘기는데 자리는 아홉
     * 개라 바인드 단계에서 거절당했고, 그래서 재작업 · 특채 · 불량 어느 것도
     * 저장되지 않았다 (2차 검수 결함 2).
     *
     * 타입 검사가 잡지 못한다. DB 시험도 못 잡는다 - 그쪽은 컬럼을 직접 맞춰
     * 넣기 때문이다. 화면을 지나는 경로만 죽어 있었다. 그래서 test/cases 에
     * 자리 수를 세는 시험을 따로 두었다 (PH-01).
     */
    await withActor(me.id, (db) =>
      db.rows(
        `insert into product_nonconformity
           (product_lot_id, qty, outcome, reason_code, reason_detail,
            approved_by, approved_on, concession_doc_no,
            found_at, registered_by, operation_id)
         values ($1,$2,$3::nc_outcome,$4,$5,$6,$7::date,$8,
                 coalesce($9::date, (timezone('Asia/Seoul', now()))::date), $10, $11)`,
        [String(form.get('product_lot_id') ?? ''), qty, outcome, reason,
         String(form.get('reason_detail') ?? '').trim() || null,
         outcome === 'CONCESSION' ? approver : null,
         outcome === 'CONCESSION' ? approvedOn : null,
         outcome === 'CONCESSION' ? docNo : null,
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
    return { ok: true, message: `${label} ${sheets}을(를) 기록했습니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
