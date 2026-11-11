/* ---------------------------------------------------------------------------
   공정 기록 하나의 제조기록서 - 현장 화면이 칸을 적을 때 읽는다 (0132)

   양식(mfg_doc.form)에 시스템이 아는 값과 현장에서 적은 값을 얹은 모양을
   돌려준다. 인쇄(제조기록서)와 같은 fillForm 을 쓴다 - 화면에 보인 것과
   종이에 찍힌 것이 갈라질 자리를 두지 않는다 (§10).
--------------------------------------------------------------------------- */
import type { Db } from './db';
import { fillForm, fieldsOf, type BrForm, type Entry, type FormPage } from './br-form';

export interface BrSheet {
  recordId: string;
  docId: string;
  docNo: string;
  size: { w: number; h: number };
  pages: FormPage[];
  /** 꼭 적을 칸 (조건부 칸 빼고) */
  total: number;
  done: number;
  /** 조건부 칸 - 해당할 때만 적는다 (FormCell.op) */
  optTotal: number;
  optDone: number;
  locked: boolean;
  workDate: string;
  title: string;
  /** 이 기록에 쓴 설비 (첫 설비부터, 대장 참조). 기기번호 칸의 고르는 창이 읽는다 */
  equipRefs: string[];
}

/** 그 제품 · 공정의 현행 제조기록서 양식. 본 기록서가 별첨보다 먼저 (번호가 짧다) */
export async function currentForm(db: Db, product: string, op: string) {
  return db.one<{ id: string; doc_no: string; form: BrForm }>(
    `select id, doc_no, form from mfg_doc
      where product_code = $1 and op_code = $2 and kind = 'BR' and is_current and form is not null
      order by length(doc_no), doc_no, revision desc
      limit 1`, [product, op]);
}

export async function brSheet(db: Db, recordId: string): Promise<BrSheet | null> {
  const r = await db.one<{
    id: string; work_date: string; equipment_id: string | null; op_code: string; op_name: string;
    extra_equipment_ids: string[] | null;
    equipment_ref: string | null; extra_equipment_refs: string[] | null;
    product_code: string | null; batch_no: string; sheet_count: number; load_unit: string | null;
    raw_lot_no: string; raw_item_code: string; worker_name: string;
    product_lot_no: string | null; product_item_code: string | null; locked: boolean;
  }>(
    `select pr.id, pr.work_date::text as work_date, pr.equipment_id,
            pr.extra_equipment_ids, pr.equipment_ref, pr.extra_equipment_refs,
            o.code as op_code, o.name as op_name, dm.product_code,
            wo.batch_no, wo.sheet_count, dm.load_unit,
            ml.lot_no as raw_lot_no, ri.code as raw_item_code, u.full_name as worker_name,
            pl.lot_no as product_lot_no, pi.code as product_item_code,
            is_locked(pr.work_order_id, pr.day_no, pr.worker_id) as locked
       from process_record pr
       join dmr_operation o on o.id = pr.operation_id
       join work_order wo on wo.id = pr.work_order_id
       join device_master dm on dm.id = wo.device_master_id
       join material_lot ml on ml.id = wo.material_lot_id
       join item ri on ri.id = ml.item_id
       join app_user u on u.id = pr.worker_id
       left join product_lot pl on pl.id = pr.product_lot_id
       left join item pi on pi.id = pl.item_id
      where pr.id = $1`, [recordId]);
  if (!r || !r.product_code) return null;
  const doc = await currentForm(db, r.product_code, r.op_code);
  if (!doc) return null;

  const issues = await db.rows<{
    item_code: string; item_name: string; lot_no: string; qty: string; usage_uom: string;
    amend_reason: string | null;
  }>(
    `select i.code as item_code, i.name as item_name, ml.lot_no, mi.qty::text as qty,
            i.usage_uom, mi.amend_reason
       from material_issue mi
       join material_lot ml on ml.id = mi.material_lot_id
       join item i on i.id = ml.item_id
      where mi.process_record_id = $1
      order by i.code, ml.lot_no`, [recordId]);
  const noLot = (await db.rows<{ code: string }>(`select code from item where not lot_tracked`))
    .map((x) => x.code);
  const entries = await entriesOf(db, recordId, doc.id);

  const filled = fillForm(doc.form, {
    batchNo: r.batch_no, productLotNo: r.product_lot_no, productModel: r.product_item_code,
    rawItemCode: r.raw_item_code, rawLotNo: r.raw_lot_no,
    sheets: r.sheet_count, loadUnit: r.load_unit,
    worker: r.worker_name, workDate: r.work_date,
    issues, noLotCodes: noLot, equipment: r.equipment_id,
    extraEquipment: r.extra_equipment_ids, notes: [],
    entries,
  });
  const all = fieldsOf(filled.pages);
  const fields = all.filter((c) => !c.op);
  const opt = all.filter((c) => c.op);
  return {
    recordId, docId: doc.id, docNo: doc.doc_no, size: doc.form.page, pages: filled.pages,
    total: fields.length, done: fields.filter((c) => c.v).length,
    optTotal: opt.length, optDone: opt.filter((c) => c.v).length,
    locked: r.locked, workDate: r.work_date, title: `${r.op_name} · ${doc.doc_no}`,
    equipRefs: [r.equipment_ref, ...(r.extra_equipment_refs ?? [])].filter(Boolean) as string[],
  };
}

/** 그 기록의 그 양식에 적힌 칸. 빈 값(비운 칸)은 뺀다 */
export async function entriesOf(db: Db, recordId: string, docId: string): Promise<Record<string, Entry>> {
  const rows = await db.rows<{ field: string; value: string; by: string; at: string }>(
    `select e.field, e.value, u.full_name as by,
            to_char(timezone('Asia/Seoul', e.entered_at), 'YYYY-MM-DD') as at
       from br_entry e join app_user u on u.id = e.entered_by
      where e.process_record_id = $1 and e.doc_id = $2 and e.value <> ''`, [recordId, docId]);
  return Object.fromEntries(rows.map((x) => [x.field, { value: x.value, by: x.by, at: x.at }]));
}
