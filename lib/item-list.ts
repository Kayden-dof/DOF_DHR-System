/* ---------------------------------------------------------------------------
   품목 목록과 단가 (설정 › 품목 · 자재 › 품목이 함께 쓴다)

   단가는 사용 단위 기준이다 (사용자 2026-11-26 «품목 자재에서 완제품도 그렇고 전체 다 단가 정보도»).
   사는 자재는 기본 공급처 단가 → 다른 공급처 단가 → 최근 입고 단가 차례, 원액은 최근 제조 로트
   단가, 완제품은 경영 › 원가와 같은 v_item_cost 의 개당 자재 원가 (만든 적 있는 형명만).
   두 화면이 따로 셈하면 같은 품목의 단가가 화면마다 달라진다 - 그래서 여기 한 곳에 둔다.
--------------------------------------------------------------------------- */
import type { Db } from './db';

export interface ItemPriceFields {
  code: string; type: string;
  price: string | null; price_basis: string | null; default_price: string | null;
}

export async function loadItemRows<T extends ItemPriceFields>(db: Db, o: {
  type: string | null; q: string | null;
  /** 자재 › 품목 - 완제품을 뺀다 */
  materialOnly: boolean;
}): Promise<T[]> {
  const rows = await db.rows<T>(
    `select i.*, count(ml.id)::int as lot_count,
            (select x.current_price::text from item_supplier x
              where x.item_id = i.id and x.supplier_id = i.default_supplier_id) as default_price,
            pr.price::text as price, pr.basis as price_basis
       from item i
       left join material_lot ml on ml.item_id = i.id and ml.status = 'AVAILABLE'
       left join lateral (
         select p.price, p.basis from (
           select x.current_price as price, s.name as basis,
                  case when x.supplier_id = i.default_supplier_id then 1 else 2 end as k
             from item_supplier x join supplier s on s.id = x.supplier_id
            where x.item_id = i.id and x.current_price is not null
              and i.type not in ('FIN', 'SOLUTION')
           union all
           select l.unit_price, case when l.made_on is null then '최근 입고' else '최근 제조' end, 3
             from (select ml2.unit_price, ml2.made_on from material_lot ml2
                    where ml2.item_id = i.id and ml2.unit_price is not null
                    order by ml2.received_at desc limit 1) l
            where i.type <> 'FIN'
         ) p order by p.k limit 1
       ) pr on true
      where (not $3::boolean or i.type <> 'FIN')
        and ($1::text is null or i.type::text = $1)
        and ($2::text is null or i.code ilike '%'||$2||'%' or i.name ilike '%'||$2||'%')
      group by i.id, pr.price, pr.basis
      order by i.type, i.code`,
    [o.type, o.q, o.materialOnly]);

  if (o.materialOnly || (o.type && o.type !== 'FIN') || !rows.some((r) => r.type === 'FIN')) return rows;
  const fin = new Map((await db.rows<{ item_code: string; per_unit: string | null }>(
    `select item_code, (sum(shared_cost + own_cost) / nullif(sum(qty), 0))::text as per_unit
       from v_item_cost group by item_code`)).map((c) => [c.item_code, c.per_unit]));
  return rows.map((r) => {
    if (r.type !== 'FIN') return r;
    const per = fin.get(r.code) ?? null;
    return { ...r, price: per, price_basis: per ? '자재 원가' : null };
  });
}
