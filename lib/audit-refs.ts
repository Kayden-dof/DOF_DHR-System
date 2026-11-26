import { withUser } from '@/lib/db';
import type { SessionUser } from '@/lib/session';

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
  'operation_id', 'equipment_id', 'work_order_id', 'product_lot_id', 'material_lot_id',
  'item_id', 'component_item_id', 'device_master_id', 'supplier_id', 'room_id',
  'steril_batch_id', 'purchase_order_id', 'user_id', 'worker_id', 'customer_id', 'sales_order_id',
];

interface WithValues {
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  label: string | null;
  refs?: Record<string, string>;
}

const uuidsOf = (v: Record<string, unknown> | null) =>
  Object.values(v ?? {}).filter((x): x is string => typeof x === 'string' && UUID.test(x));

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
       ) x
       where x.label is not null`,
      [ids],
    ));
    names = new Map(rows.map((r) => [r.id, r.label]));
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
    return { ...e, refs, label };
  });
}
