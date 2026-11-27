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
import {
  fillForm, fieldsOf, cellDone, type BrForm, type Entry, type FillData, type FillIssue, type FillReturn, type FormPage,
  type SignChange, type SolutionFill, type CutLot, solutionCheck, type SolutionCheckRow,
} from './br-form';
import type { CutRowCell } from './ship-check';

/* 원료 대조는 양식 칸만 보는 순수 셈이라 br-form 에 둔다 (시험이 바로 읽는다). 여기서도 내보낸다 */
export { solutionCheck, type SolutionCheckRow };

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
  /**
   * 아직 적지 않은 꼭 적을 칸의 이름 (사용자 2026-11-20 «어디가 작성이 안되었는지도 알려줬어야»).
   * 일차 마감 확인이 읽는다. 원액 로트를 따르는 별첨이면 그 로트 기록서의 빈 칸이다.
   */
  missing?: string[];
  /** 원액 로트를 따르는 별첨이면 그 로트 (0145) - 그 로트 화면에서 적는다 */
  lot?: { id: string; no: string };
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
  /** 그 기록의 일차 · 작업자 - 지난 기록을 볼 때 머리에 적는다 */
  dayNo: number;
  worker: string;
  title: string;
  /** 이 기록에 쓴 설비 (첫 설비부터, 대장 참조). 기기번호 칸의 고르는 창이 읽는다 */
  equipRefs: string[];
  /**
   * 시각 칸마다 쓴 설비 (0179 · 사용자 2026-11-27 «시간을 기입할때 … 장비 리스트를 같이 띄우고»). 칸 자리 → 설비 id.
   * 빈 묶음은 «설비 안 씀». 칸이 없으면 아직 고르지 않은 것
   */
  timeEquip?: Record<string, string[]>;
  /** 아직 고르지 않은 시각 칸의 처음 고름 - 같은 양식 같은 칸에서 지난번에 고른 설비 (현장 누름을 줄인다) */
  timeEquipDefault?: Record<string, string[]>;
  /** 지금 보이는 양식이 별첨인가 */
  appendix: boolean;
  /** 이 공정의 현행 양식 전부. 본 기록서가 처음 */
  forms: BrFormTab[];
  /** 빈 칸 수 - 본 기록서와 적기 시작한 별첨을 합친다 */
  empty: number;
  /** 지금 보이는 양식의 서명 칸을 고친 내역 (0140). 화면은 «수정 사항» 안내로 접는다 */
  changes: SignChange[];
  /** 작업(검사)자 칸에서 고를 이름 - 역할이 있는 사용 중 계정 (0140) */
  people: string[];
  /** 보고 있는 사람이 이 기록의 작업자인가. 아니면 서명을 고칠 때 사유를 받는다 (0140) */
  mine: boolean;
  /**
   * 원액 로트의 PBS 제조기록서를 보고 있다 (0145). 배치 화면에서는 별첨이 이 원액 로트를 따라
   * 보기만이고, 원액 로트 화면(solutionSheet)에서는 이 로트에 적는다.
   */
  solutionLot?: string | null;
  /** 배치 화면에서 지금 보이는 별첨이 원액 로트를 따르는가 - 그러면 여기서는 보기만 */
  linked?: boolean;
  /** 그 원액 로트 id - 적는 화면(/material/solution/[id])으로 가는 길 */
  solutionLotId?: string | null;
  /** 본 기록서 재단 줄의 제조번호 · 모델명 · 수량 (0159 · 출고 전 형명 검토) */
  cut?: CutRowCell[];
  /**
   * 원액 로트 화면에서 - 이 원액을 쓴 배치 일차 가운데 이미 잠긴(인쇄 · 마감) 것 («B261104-01 2일차»).
   * 있으면 칸을 고칠 때 사유를 받는다 (정밀 점검 C · 사용자 2026-11-27 «알리고 사유 받기»).
   */
  printed?: string[];
  /** 원액 제조 때 차감한 원료와 PBS 제조기록서에 적은 부여로트번호 · 결과를 품목마다 견준 것 */
  solutionCheck?: SolutionCheckRow[];
}

interface FormRow { id: string; doc_no: string; title: string | null; form: BrForm }

/** 원액 로트가 적는 PBS 제조기록서 양식 하나 (solutionForms) */
export type SolutionDoc = FormRow;

/**
 * 그 제품표준서 판 · 공정이 쓰는 제조기록서 양식 전부. 본 기록서가 별첨보다 먼저 (번호가 짧다).
 *
 * 판에 묶인 양식(개정안, 0137)이 있으면 그 판의 지시는 묶인 양식만 쓰고, 없으면 현행
 * 양식을 쓴다 - br_form_in_scope 하나가 가른다 (현장 화면 · 일차 인쇄와 같은 규칙).
 */
export async function currentForms(db: Db, product: string, op: string, dm: string): Promise<FormRow[]> {
  return db.rows<FormRow>(
    `select id, doc_no, title, form from mfg_doc
      where product_code = $1 and op_code = $2 and kind = 'BR' and form is not null
        and br_form_in_scope(device_master_id, is_current, $3::uuid)
      order by length(doc_no), doc_no, revision desc`, [product, op, dm]);
}

/** 본 기록서 (처음 양식) */
export async function currentForm(db: Db, product: string, op: string, dm: string) {
  return (await currentForms(db, product, op, dm))[0] ?? null;
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
/**
 * 별첨이 따르는 원액 로트와 그 로트를 만들 때 차감한 원료, 그 로트에 적은 칸 (0145).
 * 칸은 양식(mfg_doc.id)마다 칸 자리 → 값.
 */
export interface SolutionLink {
  info: SolutionFill;
  inputs: FillIssue[];
  /** 원액 로트 id */
  lotId?: string;
  entries?: Record<string, Record<string, Entry>>;
  /**
   * 그 원액 로트가 적는 양식 - 문서 번호 → 양식 (solutionForms). 배치의 별첨은 배치 판의 양식이
   * 아니라 이 양식으로 그린다 - 판마다 칸 자리가 달라 원액 칸이 다른 판 양식에서는 비었다.
   */
  forms?: Record<string, SolutionDoc>;
}

/**
 * 별첨은 그 기록의 투입이 아니라, 본 기록서 «관리번호 부여» 칸이 가리키는 원액 로트를
 * 따른다 (PBS 제조기록서 연동 · 사용자 2026-11-20). 원료 로트 · 양은 원액 제조 기록에서,
 * 서명의 사람 · 날은 그 원액을 만든 사람 · 날에서 온다. 없으면 지금처럼 빈 별첨이다.
 */
export function fillOne(form: BrForm, base: FillData, appendix: boolean, sol?: SolutionLink | null) {
  if (!appendix) return fillForm(form, base);
  /*
   * 별첨(PBS 제조기록서)의 부여로트번호 · 결과(양) · 작업자 · 일자는 사람이 적는다 (사용자 2026-11-25
   * «이부분도 다 직접 기입하도록 열어주고, 부여 로트번호는 자재코드에서 따오는걸로»). 전에는 원액
   * 제조 때 차감한 원료 로트 · 양과 만든 사람이 처음 값으로 들어가 적힌 것처럼 보였다. 머리의
   * 관리번호 · 제조일자만 그 원액 로트에서 온다.
   */
  return fillForm(form, {
    ...base, issues: [], returns: [], notes: [], appendix: true,
    solution: sol?.info ?? null,
    worker: sol?.info.maker ?? base.worker,
    workDate: sol?.info.made_on ?? base.workDate,
  });
}

/** 본 기록서를 채운 모양에서 원액 로트번호 칸의 값 (적은 값, 없으면 처음 값) */
export function linkedSolution(pages: FormPage[]): string | null {
  for (const p of pages) for (const t of p.tables) for (const r of t.rows) for (const c of r.cells) {
    if (c.sl) return (c.v || c.sv || '').split(',')[0].trim() || null;
  }
  return null;
}

/** 원액 로트와 그 원료 (v_solution_input). 원액 로트가 아니면 null */
export async function solutionLink(db: Db, lotNo: string | null): Promise<SolutionLink | null> {
  if (!lotNo) return null;
  const info = await db.one<SolutionFill & { id: string }>(
    `select ml.id, ml.lot_no, ml.made_on::text as made_on, u.full_name as maker
       from material_lot ml left join app_user u on u.id = ml.registered_by
      where ml.lot_no = $1 and ml.made_on is not null`, [lotNo]);
  if (!info) return null;
  const inputs = await db.rows<FillIssue>(
    `select item_code, item_name, material_lot_no as lot_no, qty::text as qty, usage_uom,
            null::text as amend_reason
       from v_solution_input where solution_lot_no = $1
      order by item_code, material_lot_no`, [lotNo]);
  const { id, ...rest } = info;
  const forms = Object.fromEntries((await solutionForms(db, id)).map((d) => [d.doc_no, d]));
  return { info: rest, inputs, lotId: id, entries: await solutionEntries(db, id), forms };
}

/**
 * 이 원액을 쓴 배치 일차 가운데 이미 잠긴(인쇄 · 마감) 것 (정밀 점검 C · 2026-11-27).
 *
 * 배치의 별첨은 원액 칸을 그대로 그린다. 그 일차를 인쇄한 뒤 원액 칸을 고치면 다시 뽑는 종이가
 * 처음 종이와 달라진다 (운영: B261104-01 2 · 4일차 11-20 인쇄, L261105-01 칸 11-25 기입).
 * 원액 칸은 자료 식별자 밖이라 조회도 «같음» 이다 - 그래서 고칠 때 사유를 받고 감사추적에 남긴다
 * (사용자 «알리고 사유 받기». 막지는 않는다).
 *
 * «쓴» 은 그 원액 로트를 투입했거나 본 기록서 «관리번호 부여» 칸에 그 번호를 적은 기록이다.
 */
export async function solutionLockedDays(db: Db, lotId: string): Promise<string[]> {
  return (await db.rows<{ label: string }>(
    `select distinct wo.batch_no, pr.day_no, wo.batch_no || ' ' || pr.day_no || '일차' as label
       from process_record pr
       join work_order wo on wo.id = pr.work_order_id
       join material_lot sl on sl.id = $1::uuid
      where is_locked(pr.work_order_id, pr.day_no, pr.worker_id)
        and (exists (select 1 from material_issue mi
                      where mi.process_record_id = pr.id and mi.material_lot_id = sl.id)
             or exists (select 1 from br_entry e
                         where e.process_record_id = pr.id and btrim(e.value) = sl.lot_no))
      order by wo.batch_no, pr.day_no`, [lotId])).map((x) => x.label);
}

/** 원액 로트에 적은 칸 (0145). 양식 id → 칸 자리 → 값 */
async function solutionEntries(db: Db, lotId: string): Promise<Record<string, Record<string, Entry>>> {
  const rows = await db.rows<{ doc_id: string; field: string; value: string; by: string; at: string; why: string | null }>(
    `select e.doc_id, e.field, e.value, u.full_name as by, e.why,
            to_char(timezone('Asia/Seoul', e.entered_at), 'YYYY-MM-DD') as at
       from solution_br_entry e join app_user u on u.id = e.entered_by
      where e.material_lot_id = $1 and e.value <> ''`, [lotId]);
  const out: Record<string, Record<string, Entry>> = {};
  for (const x of rows) (out[x.doc_id] ??= {})[x.field] = { value: x.value, by: x.by, at: x.at, why: x.why };
  return out;
}

/**
 * 원액 로트가 적는 제조기록서 양식 (PBS 제조기록서) - 문서 번호마다 하나. 별첨 양식 가운데 제목에
 * 그 품목 이름이 든 것 («알칼리 처리 별첨(20X PBS 제조) 제조기록서»).
 *
 * 원액 기록은 원액 로트의 것이다 (정밀 점검 C · 2026-11-27). 같은 번호라도 판마다(Rev.00 현행 ·
 * Rev.01 개정안) 칸 자리가 달라, 한 로트는 한 양식에 적고 배치 별첨도 그 양식으로 그린다. 고르는 차례:
 *   1. 그 로트에 이미 적은 양식 - 적은 자리를 지킨다
 *   2. 제조일에 시행 중이던 판에 묶인 양식 (개정안이 시행된 뒤 만든 원액은 개정안에 적는다)
 *   3. 현행 양식, 같으면 최신 판
 * 전에는 «현행 먼저» 하나라 원액 칸이 늘 현행 양식에 붙었고, 개정안에 묶인 판의 배치 별첨은
 * 묶인 양식을 그려 원액 칸이 비어 보였다.
 *
 * lotId 가 null 이면 원액 로트 전부 (일차 기록서 인쇄가 한 번에 읽는다).
 */
export async function solutionFormRows(db: Db, lotId: string | null): Promise<(SolutionDoc & { lot_id: string })[]> {
  return db.rows<SolutionDoc & { lot_id: string }>(
    `select distinct on (ml.id, d.doc_no) ml.id as lot_id, d.id, d.doc_no, d.title, d.form
       from material_lot ml
       join item i on i.id = ml.item_id
       join mfg_doc d on d.kind = 'BR' and d.form is not null and d.doc_no ~ '-[0-9]+-[0-9]+$'
                     and position(lower(i.name) in lower(coalesce(d.title, ''))) > 0
      where ml.made_on is not null and ($1::uuid is null or ml.id = $1::uuid)
      order by ml.id, d.doc_no,
               exists (select 1 from solution_br_entry e
                        where e.material_lot_id = ml.id and e.doc_id = d.id and e.value <> '') desc,
               coalesce((select dm.verified_at is not null and dm.status = 'ACTIVE'
                                and dm.effective_from is not null and dm.effective_from <= ml.made_on
                           from device_master dm where dm.id = d.device_master_id), false) desc,
               d.is_current desc, d.revision desc`, [lotId]);
}

/** 그 원액 로트가 적는 양식들 (solutionFormRows) */
export async function solutionForms(db: Db, lotId: string): Promise<SolutionDoc[]> {
  return (await solutionFormRows(db, lotId)).map(({ lot_id: _lot, ...d }) => d);
}

/**
 * 원액 로트의 PBS 제조기록서 (0145 · 사용자 2026-11-20 «원액 제조 때»). 현장 기록서 화면을
 * 그대로 쓰도록 BrSheet 모양으로 낸다 - recordId 자리에 원액 로트 id. 원료 · 머리 · 서명은
 * 원액 제조 기록에서, 적은 칸은 solution_br_entry 에서.
 */
export async function solutionSheet(db: Db, lotId: string, docId?: string | null): Promise<BrSheet | null> {
  const lot = await db.one<{ lot_no: string; item_name: string; mine: boolean }>(
    `select ml.lot_no, i.name as item_name, ml.registered_by = current_user_id() as mine
       from material_lot ml join item i on i.id = ml.item_id
      where ml.id = $1 and ml.made_on is not null`, [lotId]);
  if (!lot) return null;
  const docs = await solutionForms(db, lotId);
  if (docs.length === 0) return null;
  const at = docId ? Math.max(0, docs.findIndex((x) => x.id === docId)) : 0;
  const sol = await solutionLink(db, lot.lot_no);
  if (!sol) return null;
  const base: FillData = {
    batchNo: '', woNo: '', productLotNo: null, productModel: null, rawItemCode: '', rawLotNo: '',
    sheets: 0, loadUnit: null, worker: sol.info.maker ?? '', workDate: sol.info.made_on ?? '',
    issues: [], noLotCodes: [], equipment: null, notes: [],
  };
  let shown: FormPage[] = [];
  let changes: SignChange[] = [];
  let opt = { total: 0, done: 0 };
  const forms: BrFormTab[] = docs.map((doc, i) => {
    const filled = fillOne(doc.form, { ...base, entries: sol.entries?.[doc.id] ?? {} }, true, sol);
    const all = fieldsOf(filled.pages);
    const need = all.filter((c) => !c.op);
    if (i === at) {
      shown = filled.pages;
      changes = filled.changes;
      const o = all.filter((c) => c.op);
      opt = { total: o.length, done: o.filter((c) => c.v).length };
    }
    return {
      docId: doc.id, docNo: doc.doc_no, label: formLabel(doc.title, false).replace(/^별첨 · /, ''), main: i === 0,
      inUse: true, total: need.length, done: need.filter(cellDone).length,
    };
  });
  const doc = docs[at];
  const cur = forms[at];
  const people = (await db.rows<{ full_name: string }>(
    `select u.full_name from app_user u
      where u.is_active and exists (select 1 from user_role r where r.user_id = u.id)
      order by u.full_name`)).map((x) => x.full_name);
  return {
    recordId: lotId, docId: doc.id, docNo: doc.doc_no, size: doc.form.page, pages: shown,
    total: cur.total, done: cur.done, optTotal: opt.total, optDone: opt.done,
    locked: false, workDate: sol.info.made_on ?? '', dayNo: 0, worker: sol.info.maker ?? '',
    title: `원액 ${lot.lot_no} · ${doc.title ?? doc.doc_no}`, equipRefs: [], appendix: true,
    forms, empty: emptyOfForms(forms), changes, people, mine: lot.mine,
    solutionLot: lot.lot_no,
    printed: await solutionLockedDays(db, lotId),
    solutionCheck: solutionCheck(shown, sol.inputs),
  };
}

export async function brSheet(db: Db, recordId: string, docId?: string | null): Promise<BrSheet | null> {
  const r = await db.one<{
    id: string; work_date: string; day_no: number; equipment_id: string | null; op_code: string; op_name: string;
    dm: string; wo_no: string;
    extra_equipment_ids: string[] | null;
    equipment_ref: string | null; extra_equipment_refs: string[] | null;
    product_code: string | null; batch_no: string; sheet_count: number; load_unit: string | null;
    raw_lot_no: string; raw_item_code: string; worker_name: string;
    product_lot_no: string | null; product_item_code: string | null; locked: boolean;
    mine: boolean;
  }>(
    `select pr.id, pr.work_date::text as work_date, pr.day_no, pr.equipment_id,
            pr.extra_equipment_ids, pr.equipment_ref, pr.extra_equipment_refs,
            o.code as op_code, o.name as op_name, dm.product_code, wo.device_master_id as dm,
            wo.wo_no, wo.batch_no, wo.sheet_count, dm.load_unit,
            ml.lot_no as raw_lot_no, ri.code as raw_item_code, u.full_name as worker_name,
            pl.lot_no as product_lot_no, pi.code as product_item_code,
            is_locked(pr.work_order_id, pr.day_no, pr.worker_id) as locked,
            pr.worker_id = current_user_id() as mine
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
  const docs = await currentForms(db, r.product_code, r.op_code, r.dm);
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
  /* 이 기록의 투입에서 원 로트로 되돌린 양. 기록서 셈에서 뺀다 (fillForm · netIssues) */
  const returns = await db.rows<FillReturn>(
    `select i.code as item_code, i.name as item_name, ml.lot_no, sm.qty::text as qty, i.usage_uom
       from stock_movement sm
       join material_issue mi on mi.id = sm.material_issue_id
       join material_lot ml on ml.id = mi.material_lot_id
       join item i on i.id = ml.item_id
      where mi.process_record_id = $1 and sm.type = 'RETURN'
      order by i.code, ml.lot_no, sm.qty`, [recordId]);
  const noLot = (await db.rows<{ code: string }>(`select code from item where not lot_tracked`))
    .map((x) => x.code);
  const byDoc = await entriesByDoc(db, recordId);

  const base: FillData = {
    batchNo: r.batch_no, woNo: r.wo_no, productLotNo: r.product_lot_no, productModel: r.product_item_code,
    rawItemCode: r.raw_item_code, rawLotNo: r.raw_lot_no,
    sheets: r.sheet_count, loadUnit: r.load_unit,
    worker: r.worker_name, workDate: r.work_date,
    issues, returns, noLotCodes: noLot, equipment: r.equipment_id,
    extraEquipment: r.extra_equipment_ids, notes: [],
    /* 이 기록에 투입된 원액 로트 - 본 기록서 «관리번호 부여» 칸의 처음 값 */
    solutionLots: (await db.rows<{ lot_no: string }>(
      `select distinct ml.lot_no from material_issue mi
         join material_lot ml on ml.id = mi.material_lot_id
        where mi.process_record_id = $1 and ml.made_on is not null
        order by ml.lot_no`, [recordId])).map((x) => x.lot_no),
    /* 그 배치의 제품 로트 - 재단 줄 «제조번호 · 모델명 · 수량» 의 처음 값 (사용자 2026-11-25) */
    cutLots: await db.rows<CutLot>(
      `select pl.lot_no, i.code, pl.qty_produced as qty
         from process_record pr
         join product_lot pl on pl.work_order_id = pr.work_order_id
         join item i on i.id = pl.item_id
        where pr.id = $1
        order by pl.lot_no`, [recordId]),
  };

  /* 본 기록서를 먼저 채워 «관리번호 부여» 칸이 가리키는 원액 로트를 안다. 별첨이 그것을 따른다 */
  const mainFilled = fillOne(docs[0].form, { ...base, entries: byDoc.get(docs[0].id) ?? {} }, false);
  const sol = await solutionLink(db, linkedSolution(mainFilled.pages));

  /* 양식마다 채워 빈 칸을 센다. 지금 보이는 양식의 채운 모양은 그대로 쓴다 */
  let shown: FormPage[] = [];
  let shownSize = docs[at].form.page;
  let changes: SignChange[] = [];
  let opt = { total: 0, done: 0 };
  let check: SolutionCheckRow[] | undefined;
  const forms: BrFormTab[] = docs.map((doc, i) => {
    /*
     * 별첨이 원액 로트를 따르면 그 로트에 적은 칸을 보여 준다 (0145). 배치에서는 보기만이고
     * 빈 칸도 이 배치의 것으로 세지 않는다 - 원액 로트 화면에서 적는다.
     *
     * 그리는 양식도 그 원액 로트의 것이다 (정밀 점검 C). 배치 판에 묶인 개정안 양식과 원액이 적힌
     * 현행 양식은 칸 자리가 달라, 배치 판 양식으로 그리면 원액 칸이 비었다.
     */
    const linked = i > 0 && !!sol;
    const sdoc = linked ? (sol!.forms?.[doc.doc_no] ?? doc) : doc;
    const entries = linked ? (sol!.entries?.[sdoc.id] ?? {}) : (byDoc.get(doc.id) ?? {});
    const filled = i === 0 ? mainFilled : fillOne(sdoc.form, { ...base, entries }, true, sol);
    const all = linked ? [] : fieldsOf(filled.pages);
    const need = all.filter((c) => !c.op);
    /* 아직 적지 않은 꼭 적을 칸 - 원액 로트를 따르는 별첨이면 그 로트 기록서의 것 */
    const pend = fieldsOf(filled.pages).filter((c) => !c.op && !cellDone(c)).map((c) => c.lb ?? '칸');
    if (i === at) {
      shown = filled.pages;
      shownSize = sdoc.form.page;
      changes = filled.changes;
      const o = all.filter((c) => c.op);
      opt = { total: o.length, done: o.filter((c) => c.v).length };
      if (linked) check = solutionCheck(filled.pages, sol!.inputs);
    }
    return {
      docId: doc.id, docNo: doc.doc_no, label: formLabel(doc.title, i === 0), main: i === 0,
      /* 별첨은 적은 칸이 있거나 따르는 원액 로트가 있을 때 쓰인다 */
      inUse: i === 0 || Object.keys(entries).length > 0 || !!sol,
      total: need.length, done: need.filter(cellDone).length,
      missing: pend,
      lot: linked && sol?.lotId ? { id: sol.lotId, no: sol.info.lot_no } : undefined,
    };
  });
  const doc = docs[at];
  const cur = forms[at];
  /* 시각 칸마다 쓴 설비 (0179) - 이 기록 것, 그리고 같은 양식 같은 칸에서 가장 최근에 고른 것 */
  const timeEquip = Object.fromEntries((await db.rows<{ field: string; ids: string[] }>(
    `select field, equipment_ids::text[] as ids from br_time_equipment
      where process_record_id = $1 and doc_id = $2`, [recordId, doc.id])).map((x) => [x.field, x.ids]));
  const timeEquipDefault = Object.fromEntries((await db.rows<{ field: string; ids: string[] }>(
    `select distinct on (field) field, equipment_ids::text[] as ids from br_time_equipment
      where doc_id = $1 and process_record_id <> $2
      order by field, set_at desc`, [doc.id, recordId])).map((x) => [x.field, x.ids]));
  const people = (await db.rows<{ full_name: string }>(
    `select u.full_name from app_user u
      where u.is_active and exists (select 1 from user_role r where r.user_id = u.id)
      order by u.full_name`)).map((x) => x.full_name);
  return {
    recordId, docId: doc.id, docNo: doc.doc_no, size: shownSize, pages: shown,
    total: cur.total, done: cur.done, optTotal: opt.total, optDone: opt.done,
    locked: r.locked, workDate: r.work_date, dayNo: r.day_no, worker: r.worker_name,
    title: `${r.op_name} · ${doc.doc_no}`,
    equipRefs: [r.equipment_ref, ...(r.extra_equipment_refs ?? [])].filter(Boolean) as string[],
    timeEquip, timeEquipDefault,
    appendix: at > 0, forms, empty: emptyOfForms(forms),
    changes, people: [...new Set(people)], mine: r.mine === true,
    /* 보이는 별첨이 원액 로트를 따르면 여기서는 보기만 (0145) */
    linked: at > 0 && !!sol, solutionLot: sol?.info.lot_no ?? null, solutionLotId: sol?.lotId ?? null,
    cut: mainFilled.cut,
    solutionCheck: check,
  };
}

/** 그 기록에 적힌 칸을 양식별로. 빈 값(비운 칸)은 뺀다 */
async function entriesByDoc(db: Db, recordId: string): Promise<Map<string, Record<string, Entry>>> {
  const rows = await db.rows<{ doc_id: string; field: string; value: string; by: string; at: string; why: string | null; forced: boolean }>(
    `select e.doc_id, e.field, e.value, u.full_name as by, e.why, e.forced,
            to_char(timezone('Asia/Seoul', e.entered_at), 'YYYY-MM-DD') as at
       from br_entry e join app_user u on u.id = e.entered_by
      where e.process_record_id = $1 and e.value <> ''`, [recordId]);
  const out = new Map<string, Record<string, Entry>>();
  for (const x of rows) {
    const m = out.get(x.doc_id) ?? {};
    /* 관리자 정정(0155)은 칸 값만 - 그 줄의 작업자 · 일자를 바꾸지 않는다 */
    m[x.field] = { value: x.value, by: x.by, at: x.at, why: x.why, forced: x.forced || undefined };
    out.set(x.doc_id, m);
  }
  return out;
}
