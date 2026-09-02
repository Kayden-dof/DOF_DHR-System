/* ---------------------------------------------------------------------------
   제조기록서의 자료 - 인쇄와 대조가 같은 것을 본다

   자료 식별자는 이 payload 를 HMAC 으로 요약한 값이다 (lib/print.ts).
   인쇄물 조회 화면이 "지금 자료로 다시 계산한 값" 을 보여 주려면 인쇄할 때와
   똑같은 모양을 만들어야 하는데, 두 화면이 각자 질의를 들고 있으면 언젠가
   갈라진다. 갈라지는 순간 조회 화면은 멀쩡한 종이를 두고 "자료가 바뀌었다"
   고 말하게 된다. 그건 §8.5 가 금지한 잘못된 신호다.

   그래서 한 곳에 둔다. 인쇄 화면은 이것을 그려서 내보내고, 조회 화면은
   이것을 요약해 종이에 찍힌 값과 견준다.

   ── 왜 제조기록서만인가 ───────────────────────────────────────────────────
   자료가 얼어 있어야 대조가 뜻을 갖는다.

   제조기록서는 인쇄하면 그 묶음이 잠기고 (S04) 공정 기록도 자재 투입도 더
   바뀌지 않는다. 그래서 나중에 다시 계산한 값이 다르면 그건 실제로 무언가
   달라진 것이다.

   다른 양식은 그렇지 않다. 편철 표지는 일차가 늘면 바뀌고, 라벨요청서는
   재단이 진행되면 바뀌고, 출하 승인 요청서는 고른 로트에 따라 달라진다.
   그것들까지 대조하면 정상 진행에도 계속 "다르다" 가 뜬다.
--------------------------------------------------------------------------- */
import type { Db } from './db';

/* ---------------------------------------------------------------------------
   해시에 담을 것과 종이에 그릴 것은 다르다 (4차 감사 B4)

   자료 식별자는 "잠긴 뒤에 무언가 달라졌는가" 를 묻는 장치다. 그러려면 담는
   것이 전부 S04 가 얼리는 값이어야 한다.

   멸균은 그렇지 않다. steril_batch_lot 은 포장 일차가 마감되고 인쇄되어
   잠긴 **뒤에** 생기고, cert_no 와 shipped_at 은 회수 시점에 들어온다.
   그래서 정상적으로 일하기만 해도 - 포장 일차를 마감해 인쇄하고, 다음 날
   멸균을 등록하면 - 그 종이의 식별자를 조회했을 때 "값이 다릅니다" 가 떴다.
   **멸균을 거치는 모든 배치에서 일어났다.**

   종이에서 빼지 않는다. 몇 개가 나갔는지는 회수 수량과 대조할 근거이고, 그
   자리는 §7 이 요구한 것이다. 다만 **해시에서는 뺀다.** 인쇄 시점의 사실을
   종이에 적는 것과, 그 값이 나중에 바뀌지 않았다고 보증하는 것은 다른 일이다.
--------------------------------------------------------------------------- */

/** 자료 식별자에 담을 모양. 잠긴 뒤에 움직이는 값은 뺀다 */
export function hashable(p: { head: unknown; records: RecRow[] }) {
  return {
    head: p.head,
    records: p.records.map(({ steril, ...rest }) => rest),
  };
}

export interface Head {
  batch_no: string; wo_no: string; sheet_count: number; dmr_revision: string;
  item_code: string; item_name: string;
  raw_lot_no: string; raw_item_code: string; raw_supplier: string;
  raw_coa_no: string; raw_coa_date: string; raw_thickness: string | null;
  supplier_lot_no: string;
  worker_name: string; work_date: string;
}

export interface RecRow {
  operation_seq: number; operation_code: string; operation_name: string;
  attempt: number;
  product_lot_no: string | null; product_item_code: string | null;
  product_item_name: string | null; product_qty: number | null;
  product_sample: number | null;
  started_at: Date | null; ended_at: Date | null;
  equipment_id: string | null; rework_qty: number | null; no_material_reason: string | null;
  rotation_name: string | null;
  issues: { item_code: string; item_name: string; lot_no: string;
            qty: string; usage_uom: string; amend_reason: string | null }[];
  /** 위탁 멸균으로 나간 수량. 자재가 아니라 제품이라 투입 자재 칸에 들어가지 않는다 */
  steril: { batch_no: string; qty: number; vendor_name: string;
            shipped_at: string | null; cert_no: string | null }[];
}

export interface DayRecordPayload { head: Head; records: RecRow[] }

export async function dayRecordPayload(
  db: Db, id: string, dayNo: number, worker: string,
): Promise<DayRecordPayload | null> {
  const head = await db.one<Head>(
    `select wo.batch_no, wo.wo_no, wo.sheet_count, wo.dmr_revision,
            i.code as item_code, i.name as item_name,
            ml.lot_no as raw_lot_no, ri.code as raw_item_code,
            s.name as raw_supplier, ml.coa_no as raw_coa_no,
            ml.coa_date::text as raw_coa_date, ml.thickness_band as raw_thickness,
            ml.supplier_lot_no,
            u.full_name as worker_name,
            (select min(pr.work_date)::text from process_record pr
              where pr.work_order_id = wo.id and pr.day_no = $2
                and pr.worker_id = $3) as work_date
       from work_order wo
       join device_master dm on dm.id = wo.device_master_id
       join item i on i.id = dm.item_id
       join material_lot ml on ml.id = wo.material_lot_id
       join item ri on ri.id = ml.item_id
       join supplier s on s.id = ml.supplier_id
       join app_user u on u.id = $3
      where wo.id = $1`, [id, dayNo, worker]);
  if (!head) return null;

  return {
    head,
    records: await db.rows<RecRow>(
      `select o.seq as operation_seq, o.code as operation_code, o.name as operation_name,
              pr.attempt, pl.lot_no as product_lot_no,
              pi.code as product_item_code, pi.name as product_item_name,
              pl.qty_produced as product_qty, pl.qty_sample as product_sample,
              pr.started_at, pr.ended_at,
              pr.equipment_id, pr.rework_qty, pr.no_material_reason,
              ru.full_name as rotation_name,
              coalesce((
                select json_agg(json_build_object(
                  'item_code', i.code, 'item_name', i.name, 'lot_no', ml.lot_no,
                  'qty', mi.qty, 'usage_uom', i.usage_uom,
                  'amend_reason', mi.amend_reason) order by i.code)
                  from material_issue mi
                  join material_lot ml on ml.id = mi.material_lot_id
                  join item i on i.id = ml.item_id
                 where mi.process_record_id = pr.id), '[]'::json) as issues,
              /*
               * 멸균은 위탁이라 자재를 넣는 공정이 아니라 제품을 내보내는 공정이다.
               * 몇 개가 나갔는지가 기록서에 없으면 회수 수량과 대조할 근거가 없다.
               * 수량은 steril_batch_lot 에 있고 제품 로트로 이어 붙인다.
               */
              coalesce((
                select json_agg(json_build_object(
                  'batch_no', sb.batch_no, 'qty', sbl.qty,
                  'vendor_name', sb.vendor_name,
                  'shipped_at', sb.shipped_at::text, 'cert_no', sb.cert_no)
                  order by sb.batch_no)
                  from steril_batch_lot sbl
                  join steril_batch sb on sb.id = sbl.steril_batch_id
                 where pr.product_lot_id is not null
                   and sbl.product_lot_id = pr.product_lot_id), '[]'::json) as steril
         from process_record pr
         join dmr_operation o on o.id = pr.operation_id
         left join product_lot pl on pl.id = pr.product_lot_id
         left join item pi on pi.id = pl.item_id
         left join app_user ru on ru.id = pr.rotation_worker_id
        where pr.work_order_id = $1 and pr.day_no = $2 and pr.worker_id = $3
        order by o.seq, pr.attempt`, [id, dayNo, worker]),
  };
}
