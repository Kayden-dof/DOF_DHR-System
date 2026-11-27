/* ---------------------------------------------------------------------------
   원액 처방 (0176 · 사용자 2026-11-27 «처방과 한 배치 사용량을 화면에서 고칠 수 있게»)

   원액 1 사용 단위(20X PBS 면 1 L)에 드는 원료 양과, 원액의 한 배치(표준 20장) 사용량.
   최소 재고선 다시 셈(suggest_min_stock)이 «처방 x 한 배치 사용량 x 4» 로 원료의 선을 잡는다.
   자재 › 품목 · 설정 › 품목의 수정 창이 함께 쓴다.
--------------------------------------------------------------------------- */
import type { Db } from './db';

export interface RecipeLine { solution_item_id: string; input_item_id: string; qty: string }
export interface RecipeInput { id: string; code: string; name: string; usage_uom: string }

/** 원액마다 처방 줄 (원료 코드 차례) */
export async function loadRecipes(db: Db): Promise<RecipeLine[]> {
  return db.rows<RecipeLine>(
    `select r.solution_item_id::text as solution_item_id, r.input_item_id::text as input_item_id,
            r.qty_per_unit::text as qty
       from solution_recipe r join item i on i.id = r.input_item_id
      order by i.code`);
}

/** 처방에 넣을 수 있는 원료 - 사 오는 자재 (원액 · 완제품 빼고) */
export async function loadRecipeInputs(db: Db): Promise<RecipeInput[]> {
  return db.rows<RecipeInput>(
    `select id::text as id, code, name, usage_uom from item
      where is_active and type not in ('SOLUTION', 'FIN') order by code`);
}
