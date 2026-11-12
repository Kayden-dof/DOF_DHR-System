/* ---------------------------------------------------------------------------
   공정 기록 하나의 제조기록서 - 현장 화면이 칸을 적을 때 읽는다 (0132)

   양식(mfg_doc.form)에 시스템이 아는 값과 현장에서 적은 값을 얹은 모양을
   돌려준다. 인쇄(제조기록서)와 같은 fillForm 을 쓴다 - 화면에 보인 것과
   종이에 찍힌 것이 갈라질 자리를 두지 않는다 (§10).

   ── 한 공정에 양식이 둘 이상 (2026-11-12) ─────────────────────────────
   WS-DX2401-03 알칼리 처리는 본 기록서 F706-DX2401-03 에 별첨 F706-DX2401-03-01
   (20X PBS 제조)이 붙는다. 본 기록서가 처음이고(번호가 짧다) 별첨은 그 뒤다.

     본 기록서   늘 적는다. 빈 칸을 늘 센다
     별첨        해당할 때만 적는다. 한 칸이라도 적으면(br_entry) 빈 칸을 세고
                 제조기록서 인쇄에 그 장이 붙는다. 안 적은 별첨은 세지도
                 찍지도 않는다 - 그 배치에서 원액을 만들지 않았으면 쓸 일이 없다

   그 기록의 투입 · 시스템 기록(특이사항)은 본 기록서에만 찍는다. 별첨의
   부여로트번호 칸은 투입이 아니라 적는 칸이다 (lib/br-form.ts FieldKind lotno).
--------------------------------------------------------------------------- */
import type { Db } from './db';
import { fillForm, fieldsOf, type BrForm, type Entry, type FillData, type FormPage } from './br-form';

/** 한 공정의 양식 하나 - 고르는 단추 · 빈 칸 수에 쓴다 */
export interface BrFormTab {
  docId: string;
  docNo: string;
  /** 본 기록서 · 별첨 · 20X PBS 제조 같은 짧은 이름 */
  label: string;
  /** 본 기록서인가 (처음 양식) */
  main: boolean;
  /** 별첨에 한 칸이라도 적었는가. 본 기록서는 늘 참 */
  inUse: boolean;
  /** 꼭 적을 칸 · 적은 칸 (조건부 칸 빼고) */
  total: number;
  done: number;
}

export interface BrSheet {
  recordId: string;
  docId: string;
  docNo: string;
  size: { w: number; h: number };
  pages: FormPage[];
  /** 지금 보이는 양식의 꼭 적을 칸 (조건부 칸 빼고) */
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
  /** 지금 보이는 양식이 별첨인가 */
  appendix: boolean;
  /** 이 공정의 현행 양식 전부. 본 기록서가 처음 */
  forms: BrFormTab[];
  /** 빈 칸 수 - 본 기록서와 적기 시작한 별첨을 합친다 */
  empty: number;
}

interface FormRow { id: string; doc_no: string; title: string | null; form: BrForm }

/** 그 제품 · 공정의 현행 제조기록서 양식 전부. 본 기록서가 별첨보다 먼저 (번호가 짧다) */
export async function currentForms(db: Db, product: string, op: string): Promise<FormRow[]> {
  return db.rows<FormRow>(
    `select id, doc_no, title, form from mfg_doc
      where product_code = $1 and op_code = $2 and kind = 'BR' and is_current and form is not null
      order by length(doc_no), doc_no, revision desc`, [product, op]);
}

/** 본 기록서 (처음 양식) */
export async function currentForm(db: Db, product: string, op: string) {
  return (await currentForms(db, product, op))[0] ?? null;
}

/**
 * 양식 이름 - 본 기록서는 «본 기록서», 별첨은 문서 제목의 «별첨(…)» 괄호 안
 * ("알칼리 처리 별첨(20X PBS 제조) 제조기록서" → "별첨 · 20X PBS 제조").
 */
export function formLabel(title: string | null, main: boolean) {
  if (main) return '본 기록서';
  const m = (title ?? '').match(/별첨\s*\(([^)]+)\)/);
  return m ? `별첨 · ${m[1].trim()}` : '별첨';
}

/** 빈 칸 수 - 본 기록서와 적기 시작한 별첨 */
export function emptyOfForms(forms: BrFormTab[]) {
  return forms.filter((f) => f.inUse).reduce((a, f) => a + Math.max(0, f.total - f.done), 0);
}

/**
 * 양식 하나를 채운다. 본 기록서는 그 기록의 투입 · 특이사항 줄을 받고, 별첨은
 * 비워 받는다 (위 머리말). 화면과 인쇄가 이것 하나로 갈래를 정한다.
 */
export function fillOne(form: BrForm, base: FillData, appendix: boolean) {
  return fillForm(form, appendix ? { ...base, issues: [], notes: [], appendix: true } : base);
}

export async function brSheet(db: Db, recordId: string, docId?: string | null): Promise<BrSheet | null> {
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
  const docs = await currentForms(db, r.product_code, r.op_code);
  if (docs.length === 0) return null;
  const at = docId ? docs.findIndex((x) => x.id === docId) : 0;
  if (at < 0) return null;

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
  const byDoc = await entriesByDoc(db, recordId);

  const base: FillData = {
    batchNo: r.batch_no, productLotNo: r.product_lot_no, productModel: r.product_item_code,
    rawItemCode: r.raw_item_code, rawLotNo: r.raw_lot_no,
    sheets: r.sheet_count, loadUnit: r.load_unit,
    worker: r.worker_name, workDate: r.work_date,
    issues, noLotCodes: noLot, equipment: r.equipment_id,
    extraEquipment: r.extra_equipment_ids, notes: [],
  };

  /* 양식마다 채워 빈 칸을 센다. 지금 보이는 양식의 채운 모양은 그대로 쓴다 */
  let shown: FormPage[] = [];
  let opt = { total: 0, done: 0 };
  const forms: BrFormTab[] = docs.map((doc, i) => {
    const entries = byDoc.get(doc.id) ?? {};
    const filled = fillOne(doc.form, { ...base, entries }, i > 0);
    const all = fieldsOf(filled.pages);
    const need = all.filter((c) => !c.op);
    if (i === at) {
      shown = filled.pages;
      const o = all.filter((c) => c.op);
      opt = { total: o.length, done: o.filter((c) => c.v).length };
    }
    return {
      docId: doc.id, docNo: doc.doc_no, label: formLabel(doc.title, i === 0), main: i === 0,
      inUse: i === 0 || Object.keys(entries).length > 0,
      total: need.length, done: need.filter((c) => c.v).length,
    };
  });
  const doc = docs[at];
  const cur = forms[at];
  return {
    recordId, docId: doc.id, docNo: doc.doc_no, size: doc.form.page, pages: shown,
    total: cur.total, done: cur.done, optTotal: opt.total, optDone: opt.done,
    locked: r.locked, workDate: r.work_date, title: `${r.op_name} · ${doc.doc_no}`,
    equipRefs: [r.equipment_ref, ...(r.extra_equipment_refs ?? [])].filter(Boolean) as string[],
    appendix: at > 0, forms, empty: emptyOfForms(forms),
  };
}

/** 그 기록에 적힌 칸을 양식별로. 빈 값(비운 칸)은 뺀다 */
async function entriesByDoc(db: Db, recordId: string): Promise<Map<string, Record<string, Entry>>> {
  const rows = await db.rows<{ doc_id: string; field: string; value: string; by: string; at: string }>(
    `select e.doc_id, e.field, e.value, u.full_name as by,
            to_char(timezone('Asia/Seoul', e.entered_at), 'YYYY-MM-DD') as at
       from br_entry e join app_user u on u.id = e.entered_by
      where e.process_record_id = $1 and e.value <> ''`, [recordId]);
  const out = new Map<string, Record<string, Entry>>();
  for (const x of rows) {
    const m = out.get(x.doc_id) ?? {};
    m[x.field] = { value: x.value, by: x.by, at: x.at };
    out.set(x.doc_id, m);
  }
  return out;
}
