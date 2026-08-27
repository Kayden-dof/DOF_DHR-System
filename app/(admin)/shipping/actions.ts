'use server';

import { revalidatePath } from 'next/cache';
import { withActor, dbMessage } from '@/lib/db';
import { requireUser, hasRole } from '@/lib/session';
import type { FormState } from '@/lib/forms';

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
      const no = await db.val<string>(`select next_number('STERIL_BATCH')`);
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
   출하 승인 (§4.5)

   품질책임자는 시스템 계정이 없다. 서면으로 승인한 내용을 관리자가 옮겨 적는다.
   그래서 release_approved_by가 FK가 아니라 이름 문자열이다.
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
    await withActor(me.id, (db) =>
      db.rows(
        `insert into shipment (product_lot_id, customer_name, qty, shipped_at, shipped_by,
                               release_request_no, unit_from, unit_to)
         values ($1,$2,$3,$4::date,$5,$6,$7,$8)`,
        [String(form.get('product_lot_id') ?? ''),
         String(form.get('customer_name') ?? '').trim(),
         Number(form.get('qty') ?? 0),
         String(form.get('shipped_at') ?? ''), me.id,
         // 서면 승인이 끝난 요청서의 번호. 비워 두면 비워진 채로 남는다
         String(form.get('release_request_no') ?? '').trim() || null,
         /*
          * 나간 개체 순번. 겹치는지 · 로트를 벗어나는지 · 수량과 맞는지는
          * DB 가 본다 (trg_shipment_unit_range). 여기서 다시 세지 않는다.
          */
         Number(form.get('unit_from') ?? 0) || null,
         Number(form.get('unit_to') ?? 0) || null]));
    bump();
    return { ok: true, message: '출고를 기록했습니다.' };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
