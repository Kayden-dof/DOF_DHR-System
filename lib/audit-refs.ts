import { withUser } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { chem } from '@/lib/fmt';

/* ---------------------------------------------------------------------------
   감사추적의 번호를 이름으로 (사용자 2026-11-26 «이거 보면 뭔 활동인지 알겠냐?»)

   «공정 설비 · 등록 · 495fe42d» 를 펼치면 «설비 → 9529d6aa-…», «공정 → 495fe42d-…»
   만 나왔다. 다른 표를 가리키는 칸은 그 표의 내부 번호(uuid)라 사람이 읽을 수 없다.
   v_audit_entry(0077) 는 줄 안에 든 번호 · 이름만 꺼내므로, 연결 표처럼 제 이름이
   없는 줄은 대상 칸도 uuid 로 떨어졌다.

   여기서 한 화면 몫의 uuid 를 모아 한 번에 이름으로 푼다. 감사추적 화면과 현황의
   «최근 활동» 이 같이 쓴다 (§10 - 화면이 각자 풀지 않는다).
     · 값 칸: uuid 대신 그 대상의 이름 (설비 «재단기 (CT-01)», 공정 «재단 (05)»)
     · 대상 칸: 줄에 제 번호가 없으면 가리키는 대상들의 이름 («재단 (05) · 재단기 (CT-01)»)

   지워진 대상처럼 풀리지 않는 번호는 그대로 둔다 - 지어내지 않는다. 푸는 질의가
   실패해도 감사추적은 그대로 나와야 하므로 실패는 삼킨다(이름만 안 풀린다).
--------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* 줄에 제 이름이 없을 때 대상 칸에 어느 쪽 이름을 먼저 쓰는가 (앞에서 둘까지) */
const TARGET_KEYS = [
  'operation_id', 'equipment_id', 'equipment_ref', 'dmr_bom_id', 'work_order_id', 'product_lot_id',
  'material_lot_id', 'solution_lot_id', 'item_id', 'component_item_id', 'raw_item_id', 'device_master_id',
  'supplier_id', 'room_id', 'steril_batch_id', 'purchase_order_id', 'sales_order_line_id', 'sales_order_id',
  'customer_id', 'process_record_id', 'material_issue_id', 'record_print_id', 'doc_id', 'check_id',
  'scheme_id', 'user_id', 'worker_id',
];

interface WithValues {
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  label: string | null;
  refs?: Record<string, string>;
}

/* 값 안의 uuid. 추가 설비처럼 목록으로 든 것도 꺼낸다 */
const uuidsOf = (v: Record<string, unknown> | null) =>
  Object.values(v ?? {}).flatMap((x) => (Array.isArray(x) ? x : [x]))
    .filter((x): x is string => typeof x === 'string' && UUID.test(x));

export async function withRefs<T extends WithValues>(user: SessionUser, entries: T[]): Promise<T[]> {
  const ids = [...new Set(entries.flatMap((e) => [...uuidsOf(e.old_value), ...uuidsOf(e.new_value)]))];
  if (ids.length === 0) return entries;

  let names: Map<string, string>;
  try {
    const rows = await withUser(user, (db) => db.rows<{ id: string; label: string }>(
      `with ids(id) as (select unnest($1::uuid[]))
       select x.id::text as id, x.label from (
         select e.id, e.name || coalesce(' (' || e.code || ')', '') as label from equipment e join ids using (id)
         union all select o.id, o.name || coalesce(' (' || o.code || ')', '') from dmr_operation o join ids using (id)
         union all select i.id, i.name || coalesce(' (' || i.code || ')', '') from item i join ids using (id)
         union all select r.id, coalesce(r.name, r.code) from room r join ids using (id)
         union all select s.id, s.name from supplier s join ids using (id)
         union all select d.id, d.product_code || ' ' || d.revision from device_master d join ids using (id)
         union all select u.id, u.full_name from app_user u join ids using (id)
         union all select w.id, w.batch_no from work_order w join ids using (id)
         union all select p.id, p.lot_no from product_lot p join ids using (id)
         union all select m.id, m.lot_no from material_lot m join ids using (id)
         union all select po.id, po.po_no from purchase_order po join ids using (id)
         union all select sb.id, sb.batch_no from steril_batch sb join ids using (id)
         union all select c.id, c.name from customer c join ids using (id)
         union all select so.id, so.customer_po_no from sales_order so join ids using (id)
         /* 2026-11-26 전수 점검: 감사가 걸린 표의 외래 키가 가리키는 나머지 표 */
         union all select sl.id, so.customer_po_no || ' · ' || coalesce(i.code, '') || ' (' || sl.seq || '번 줄)'
           from sales_order_line sl join ids using (id)
           join sales_order so on so.id = sl.sales_order_id left join item i on i.id = sl.item_id
         union all select b.id, i.name || coalesce(' · ' || o.name, '')
           from dmr_bom b join ids using (id)
           join item i on i.id = b.component_item_id left join dmr_operation o on o.id = b.operation_id
         union all select pr.id, w.batch_no || ' ' || pr.day_no || '일차' || coalesce(' · ' || o.name, '')
           from process_record pr join ids using (id)
           join work_order w on w.id = pr.work_order_id left join dmr_operation o on o.id = pr.operation_id
         union all select mi.id, ml.lot_no from material_issue mi join ids using (id)
           join material_lot ml on ml.id = mi.material_lot_id
         union all select rp.id, coalesce(rp.doc_no, rp.kind::text) || ' · ' || rp.seq || '회'
           from record_print rp join ids using (id)
         union all select md.id, md.doc_no || coalesce(' ' || md.title, '') from mfg_doc md join ids using (id)
         union all select mc.id, coalesce(mc.op_code || ' ', '') || mc.item from mfg_check mc join ids using (id)
         union all select ms.id, ms.name from model_scheme ms join ids using (id)
         union all select sh.id, i.name || ' ' || sh.months || '개월'
           from shelf_life_history sh join ids using (id) join item i on i.id = sh.item_id
       ) x
       where x.label is not null`,
      [ids],
    ));
    /* 이름은 화면에 낼 때 화학식을 아래첨자로 (H2O2 처리 -> H₂O₂ 처리 · lib/fmt chem) */
    names = new Map(rows.map((r) => [r.id, chem(r.label)]));
  } catch (e) {
    console.warn('[audit] 번호를 이름으로 풀지 못함', e instanceof Error ? e.message : e);
    return entries;
  }
  if (names.size === 0) return entries;

  return entries.map((e) => {
    const refs: Record<string, string> = {};
    for (const id of [...uuidsOf(e.old_value), ...uuidsOf(e.new_value)]) {
      const n = names.get(id);
      if (n) refs[id] = n;
    }
    let label = e.label;
    if (!label) {
      const v = { ...(e.old_value ?? {}), ...(e.new_value ?? {}) };
      const parts = TARGET_KEYS
        .map((k) => (typeof v[k] === 'string' ? refs[v[k] as string] : undefined))
        .filter((x): x is string => !!x);
      if (parts.length) label = [...new Set(parts)].slice(0, 2).join(' · ');
    }
    return { ...e, refs, label: label ? chem(label) : label };
  });
}
