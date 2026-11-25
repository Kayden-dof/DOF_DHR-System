'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';
import { shipReview } from '@/lib/ship-review';
import { specMessage } from '@/lib/ship-check';

async function mgr() {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    throw new Error('생산관리자 또는 시스템관리자만 출하를 다룰 수 있습니다');
  }
  return user;
}

const txt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const bump = () => {
  revalidatePath('/shipping');
  revalidatePath('/shipping/steril');
  revalidatePath('/shipping/ship');
  revalidatePath('/shipping/orders');
  revalidatePath('/material/stock');
  revalidatePath('/');
};

/* ---------------------------------------------------------------------------
   멸균 위탁 (§4.8)

   50개(25ea 2줄) 박스 단위로 발송한다. 한 박스에 여러 제품 로트가 들어갈 수
   있어 M:N이다. 판정은 서면으로 하고 시스템은 발송·회수 시점과 성적서 번호만
   기록한다.
--------------------------------------------------------------------------- */
export async function createSterilBatch(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const lots: { id: string; qty: number }[] = [];
    for (const [k, v] of form.entries()) {
      const m = k.match(/^lot_(.+)$/);
      if (!m || String(v) !== 'on') continue;
      const qty = Number(form.get(`qty_${m[1]}`) ?? 0);
      if (qty > 0) lots.push({ id: m[1], qty });
    }
    if (lots.length === 0) return { error: '동봉할 제품 로트와 수량을 선택하십시오' };

    const batchNo = await withActor(me.id, async (db) => {
      /*
       * 멸균 배치번호는 채번 규칙이 정한다 (0099). 사내 규칙은 `{BATCH}` 하나라
       * 생산 배치번호가 그대로 서지만, 그것은 **설정에 적힌 것**이지 여기 박힌
       * 것이 아니다 - 다른 제조소는 자기 형식을 쓴다 (§2.0).
       *
       * 고른 로트가 어느 배치 것인지 알아야 그 토큰을 채운다. 한 발송이 한
       * 배치라는 것도 여기서 드러난다 - 두 배치가 섞이면 배치번호를 하나로
       * 고를 수 없다.
       */
      const batches = await db.rows<{ batch_no: string }>(
        `select distinct w.batch_no
           from product_lot pl join work_order w on w.id = pl.work_order_id
          where pl.id = any($1::uuid[])
          order by w.batch_no`, [lots.map((l) => l.id)]);
      if (batches.length > 1) {
        throw new Error(
          `고른 로트가 배치 ${batches.length}건에 걸쳐 있습니다 `
          + `(${batches.map((b) => b.batch_no).join(' · ')}). `
          + '한 번의 멸균 발송은 한 배치입니다.');
      }

      const no = await db.val<string>(
        `select next_number('STERIL_BATCH', null, null, $1)`, [batches[0]?.batch_no ?? null]);
      const id = await db.val<string>(
        `insert into steril_batch (batch_no, request_no, vendor_name, registered_by)
         values ($1,$2,$3,$4) returning id`,
        [no, txt(form.get('request_no')), String(form.get('vendor_name') ?? '').trim(), me.id]);
      for (const l of lots) {
        await db.rows(
          `insert into steril_batch_lot (steril_batch_id, product_lot_id, qty)
           values ($1,$2,$3)`, [id, l.id, l.qty]);
      }
      return no;
    });

    bump();
    return {
      ok: true,
      message: `멸균 배치 ${batchNo}를 등록했습니다. 제품 로트 ${lots.length}건이 들어갔습니다.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function updateSterilBatch(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    await withActor(me.id, (db) =>
      db.rows(
        `update steril_batch set shipped_at = $2::date, received_at = $3::date,
                cert_no = $4, request_no = coalesce($5, request_no)
          where id = $1`,
        [String(form.get('id') ?? ''), txt(form.get('shipped_at')),
         txt(form.get('received_at')), txt(form.get('cert_no')),
         txt(form.get('request_no'))]));
    bump();
    return { ok: true, message: '멸균 배치를 갱신했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   멸균 보고서 생략 (0166 · 사용자 2026-11-25)

   «멸균 선량 샘플 요청건이라 멸균 보고서 없이 출고가 된 제품이라.. 스킵할때는 어떤 사유로 멸균
   보고서를 스킵했는지 적을수 있게». 사유를 적으면 그 로트는 보고서 없이 출고를 받는다. 아직 한 개도
   내보내지 않았으면 생략을 취소할 수 있다 (DB 가 막는다 - 내보낸 뒤에는 출고의 근거다).
--------------------------------------------------------------------------- */
export async function skipSterilReport(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    const reason = String(form.get('reason') ?? '').trim();
    if (!reason) return { error: '멸균 보고서를 생략하는 사유를 적으십시오' };
    const lot = await withActor(me.id, async (db) => {
      const no = await db.val<string>(`select lot_no from product_lot where id = $1`, [id]);
      if (!no) throw new Error('제품 로트를 찾을 수 없습니다');
      if (await db.val<string>(`select lot_steril_report($1)`, [id])) {
        throw new Error(`제조번호 ${no}은(는) 이미 멸균 보고서가 적혀 있어 생략할 것이 없습니다`);
      }
      await db.rows(
        `insert into steril_report_skip (product_lot_id, reason, skipped_by) values ($1, $2, $3)
         on conflict (product_lot_id) do nothing`, [id, reason, me.id]);
      return no;
    }, { reason });
    bump();
    return { ok: true, message: `${lot} 의 멸균 보고서를 생략했습니다. 출고 가능 로트에 나옵니다.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function cancelSterilSkip(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    await withActor(me.id, (db) =>
      db.rows(`delete from steril_report_skip where product_lot_id = $1`, [id]),
    { reason: '멸균 보고서 생략 취소' });
    bump();
    return { ok: true, message: '멸균 보고서 생략을 취소했습니다. 다시 멸균 보고서 대기에 나옵니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   출하 승인 (§4.5)

   품질책임자 계정은 열람 전용이다 (lib/roles.ts QP). 서면으로 승인한 내용을
   관리자가 옮겨 적는다. 그래서 release_approved_by가 FK가 아니라 이름 문자열이다.
--------------------------------------------------------------------------- */
export async function approveRelease(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const name = String(form.get('release_approved_by') ?? '').trim();
    if (!name) return { error: '서면에 서명한 품질책임자 성명을 입력하십시오' };

    await withActor(me.id, (db) =>
      db.rows(
        `update product_lot
            set release_approved_by = $2, release_approved_on = $3::date,
                status = 'RELEASE_APPROVED'
          where id = $1`,
        [String(form.get('id') ?? ''), name, String(form.get('release_approved_on') ?? '')]));
    bump();
    return {
      ok: true,
      message: `${name} 품질책임자의 서면 승인을 기록했습니다. 시스템이 판정한 것이 아닙니다.`,
    };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function ship(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const lot = String(form.get('product_lot_id') ?? '');
    const line = String(form.get('sales_order_line_id') ?? '');
    if (!line) return { error: '주문 줄을 고르십시오' };
    const qty = Number(form.get('qty') ?? 0);
    await withActor(me.id, async (db) => {
      /*
       * 출고 전 형명 일괄 검토 (0159 · 사용자 2026-11-25 «발주 형명이 맞는지 작업지시서 및 제조기록서
       * 일괄 검토해서 출고시 오규격이 나가지 않도록»). 제품 로트 · 작업지시서는 DB 트리거도 막고,
       * 제조기록서 재단 줄은 칸 자리를 양식 코드가 알아서 여기서 막는다.
       */
      const bad = (await shipReview(db, lot, line)).find((r) => r.ok === false);
      if (bad) throw new Error(specMessage(bad));
      /*
       * 개체 순번 · 출하 승인서 번호는 적지 않는다 (사용자 2026-11-25 · 0160). 거래처 이름은 고른 주문의
       * 거래처 상호로 적는다 - 출고 때의 사실로 남는다.
       */
      const done = await db.rows(
        `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by, sales_order_line_id)
         select $1, c.name, $3, $4::date, $5, l.id
           from sales_order_line l
           join sales_order o on o.id = l.sales_order_id
           join customer c on c.id = o.customer_id
          where l.id = $2
         returning id`,
        [lot, line, qty, String(form.get('shipped_at') ?? ''), me.id]);
      if (done.length === 0) throw new Error('고른 주문 줄을 찾을 수 없습니다');
    });
    bump();
    return { ok: true, message: '출고를 기록했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

/* ---------------------------------------------------------------------------
   출고의 주문 바꾸기 (0159 · 사용자 2026-11-25 «허용»)

   잘못 고른 주문 줄을 바로잡는다. 떼기는 없다 - 출고는 꼭 주문 줄에 잇는다. 사유가 감사추적에
   남고, 바꿀 줄도 같은 형명 검토를 받는다. 출고의 거래처 이름은 출고 때 적은 그대로 둔다.
--------------------------------------------------------------------------- */
export async function relinkShipment(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const me = await mgr();
    const id = String(form.get('id') ?? '');
    const line = String(form.get('sales_order_line_id') ?? '');
    const reason = String(form.get('reason') ?? '').trim();
    if (!line) return { error: '바꿀 주문 줄을 고르십시오' };
    if (!reason) return { error: '주문을 바꾸는 사유를 적으십시오' };
    await withActor(me.id, async (db) => {
      const lot = await db.val<string>(`select product_lot_id from shipment where id = $1`, [id]);
      if (!lot) throw new Error('출고 기록을 찾을 수 없습니다');
      const bad = (await shipReview(db, lot, line)).find((r) => r.ok === false);
      if (bad) throw new Error(specMessage(bad));
      await db.rows(`update shipment set sales_order_line_id = $2 where id = $1`, [id, line]);
    }, { reason });
    bump();
    return { ok: true, message: '출고의 주문을 바꿨습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
