/* ---------------------------------------------------------------------------
   공급자 단가 적기 (0008)

   단가는 이력 한 줄과 지금 단가 한 칸으로 적는다. 이전 단가는 이력에 남고 지워지지 않는다.
   공급자 화면과 품목 화면이 같은 길로 적는다 - 두 곳이 따로 쓰면 한쪽만 이력을 남긴다.
   단가는 사용 단위 기준 공급가액이다.
--------------------------------------------------------------------------- */
import type { Db } from './db';

export async function recordPrice(db: Db, p: {
  item: string; supplier: string; price: number;
  /** YYYY-MM-DD. 비우면 오늘 (KST) */
  from: string | null;
  by: string;
}): Promise<void> {
  await db.rows(
    `insert into price_history (item_id, supplier_id, price, effective_from, registered_by)
     values ($1, $2, $3, coalesce(nullif($4, '')::date, (timezone('Asia/Seoul', now()))::date), $5)`,
    [p.item, p.supplier, p.price, p.from ?? '', p.by]);
  await db.rows(
    `insert into item_supplier (item_id, supplier_id, current_price)
     values ($1, $2, $3)
     on conflict (item_id, supplier_id) do update set current_price = excluded.current_price`,
    [p.item, p.supplier, p.price]);
}
