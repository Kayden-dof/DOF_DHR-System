/* ---------------------------------------------------------------------------
   품목을 쓰는 제품 (자재 › 재고 의 제품 탭 · 품목 수정 창이 함께 쓴다)

   사용자 2026-11-26 «재고 탭의 재료를 DX2401 / DX2402 별로, 제품이 생기면 그 BOM 에 맞게».
   셈에 넣는 것 (how):
     BOM   그 제품 판(모든 개정)의 공정 구성표에 든 품목 · 판의 원료 품목 (raw_item_id) ·
           그 제품이 쓰는 원액을 만들 때 든 원료 (지난 원액 제조 기록 v_solution_input)
     HAND  품목에 손으로 적은 쓰는 제품 (item.product_codes, 0174 · 사용자 2026-11-27).
           서면 구성표에 없는 자재(차트 라벨 · BI · 단상자 등)를 제품에 잇는다.
   한 품목이 여러 제품에 들면 줄이 여럿이다. 두 화면이 따로 셈하면 탭과 수정 창이 어긋난다 -
   그래서 여기 한 곳에 둔다.
--------------------------------------------------------------------------- */
import type { Db } from './db';

export interface ItemProduct { product_code: string; item_id: string; how: 'BOM' | 'HAND' }

export async function loadItemProducts(db: Db): Promise<ItemProduct[]> {
  return db.rows<ItemProduct>(
    `with direct as (
       select dm.product_code, bom.component_item_id as item_id
         from dmr_bom bom
         join dmr_operation o on o.id = bom.operation_id
         join device_master dm on dm.id = o.device_master_id
        where dm.product_code is not null
       union
       select dm.product_code, dm.raw_item_id
         from device_master dm
        where dm.product_code is not null and dm.raw_item_id is not null
     ),
     via as (
       select d.product_code, ml.item_id
         from direct d
         join material_lot sl on sl.item_id = d.item_id
         join v_solution_input v on v.solution_lot_id = sl.id
         join material_lot ml on ml.id = v.material_lot_id
     ),
     bom as (
       select product_code, item_id from direct
       union
       select product_code, item_id from via
     )
     select product_code, item_id::text as item_id, 'BOM' as how from bom
     union all
     select h.product_code, h.item_id::text, 'HAND'
       from (select unnest(i.product_codes) as product_code, i.id as item_id
               from item i where i.product_codes is not null) h
      where h.product_code in (select product_code from device_master)
        and not exists (select 1 from bom b where b.item_id = h.item_id and b.product_code = h.product_code)`);
}

/** 품목 코드가 붙는 제품 코드들 (판이 있는 것만) */
export async function loadProductCodes(db: Db): Promise<string[]> {
  return (await db.rows<{ code: string }>(
    `select distinct product_code as code from device_master
      where product_code is not null order by 1`)).map((r) => r.code);
}
