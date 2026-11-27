/* ===========================================================================
   0178 · 판매 단가와 달별 수입 · 지출 (사용자 2026-11-27)

   «시덴코는 1cm2에 1000원으로 가져가거든(VAT 미포함). 생산 원가 대비 판매가의 비율이 어느정도
    되는지도 경영에서 언급할수있으면 좋을거 같은데» → «그렇게 해 줘»
   «경영쪽은 비용의 전체를 다 볼수있게 … 출고가 되는 경우에는 출고기준으로 수입을 잡아야할거 같음.
    입금은 바로 되는게 아닐거라서 … 입금까지는 신경쓸수 없을듯»

   0159 는 «단가는 ERP» 로 두었다. 이번에 단가만 들인다 - 경영이 원가와 견주고, 한 달의 수입을 보려는
   것이다. 거래명세서 · 세금계산서 · 입금 · 결제는 여전히 ERP 몫이다.

     customer.price_per_cm2       거래처의 cm² 당 기본 단가 (원 · VAT 별도). 주문 줄 단가를 면적으로 미리 채운다
     sales_order_line.unit_price  주문 줄의 개당 단가 (원 · VAT 별도). 비울 수 있다 - 비면 금액을 세지 않는다
     v_sales_price                형명별 판매 단가. 단가가 적힌 살아 있는 주문 줄의 수량 가중 평균
     v_board_money                달별 수입 · 지출

   ── 세 숫자는 잡히는 때가 다르다 ────────────────────────────────────────
     출고 금액       출고한 달. 출고 수량 x 그 주문 줄 단가 (입금이 아니다)
     출고분 원가     출고한 달. 출고 수량 x 그 제품 로트의 개당 원가 - 출고 금액과 짝이 맞는 원가
     생산 투입 자재  만든 달 (제조일). 그 달 제조번호가 붙은 제품 로트의 자재 원가 합
     생산 공수 · 설비 만든 달. 같은 로트의 가공비 (단가가 적힌 만큼)
     자재 입고       자재가 들어온 달. 발주 입고 매입 금액 (v_material_spend · 원액 제외 0120)
   자재 지출을 둘로 가른다 (사용자 같은 날 «생산에 따른 자재지출과 발주 입고에 따른 자재 지출이 구분되어야»).
   입고는 산 돈이고, 투입은 그 가운데 제품이 된 만큼이다. 차이는 재고로 남았거나 아직 재단 전인 배치에 있다.
   그래서 «출고 금액 - 자재 지출» 은 이익이 아니라 돈의 들고 남이다. 원가는 v_product_lot_cost 가
   한 번만 낸다 (§10) - 여기서는 더하기만 한다. 원가에는 공수 · 설비 단가가 있는 만큼만, 멸균 위탁비는 없다.
=========================================================================== */

alter table customer add column if not exists price_per_cm2 numeric;
alter table sales_order_line add column if not exists unit_price numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_price_per_cm2_ck') then
    alter table customer add constraint customer_price_per_cm2_ck check (price_per_cm2 is null or price_per_cm2 > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_order_line_unit_price_ck') then
    alter table sales_order_line add constraint sales_order_line_unit_price_ck check (unit_price is null or unit_price >= 0);
  end if;
end $$;

comment on column customer.price_per_cm2 is
  'cm² 당 기본 판매 단가 (원 · VAT 별도). 주문 줄 단가를 면적 x 이 값으로 미리 채운다 (0178)';
comment on column sales_order_line.unit_price is
  '개당 판매 단가 (원 · VAT 별도). 비면 출고 금액에 들지 않는다 (0178)';


/* === 형명별 판매 단가 ====================================================== */
create or replace view v_sales_price as
select l.item_id,
       round(sum(l.qty * l.unit_price) / nullif(sum(l.qty), 0), 2) as unit_price,
       sum(l.qty)::int as qty
  from sales_order_line l
  join sales_order o on o.id = l.sales_order_id
 where l.unit_price is not null and l.cancelled_at is null and o.cancelled_at is null
 group by l.item_id;

comment on view v_sales_price is
  '형명별 판매 단가 (원 · VAT 별도). 단가가 적힌 살아 있는 주문 줄의 수량 가중 평균 (0178)';


/* === 달별 수입 · 지출 ====================================================== */
create or replace view v_board_money as
with lot_cost as (
  select c.product_lot_id,
         c.shared_cost + c.own_cost as material,
         c.shared_conv_cost + c.own_conv_cost as conv,
         (c.shared_cost + c.own_cost + c.shared_conv_cost + c.own_conv_cost)
           / nullif(c.qty_produced, 0) as unit_cost
    from v_product_lot_cost c
),
ship as (
  select date_trunc('month', sh.shipped_at)::date as month,
         sum(sh.qty)::int as shipped_qty,
         sum(sh.qty * l.unit_price) as revenue,
         coalesce(sum(sh.qty) filter (where l.unit_price is null), 0)::int as unpriced_qty,
         sum(sh.qty * lc.unit_cost) as shipped_cost
    from shipment sh
    left join sales_order_line l on l.id = sh.sales_order_line_id
    left join lot_cost lc on lc.product_lot_id = sh.product_lot_id
   group by 1
),
made as (
  select date_trunc('month', pl.manufactured_on)::date as month,
         sum(lc.material) as made_material,
         sum(lc.conv) as made_conv
    from product_lot pl
    join lot_cost lc on lc.product_lot_id = pl.id
   group by 1
),
spend as (
  select month, sum(amount) as spend from v_material_spend group by 1
),
months as (
  select month from ship union select month from made union select month from spend
)
select m.month,
       coalesce(s.shipped_qty, 0)            as shipped_qty,
       round(coalesce(s.revenue, 0))         as revenue,
       coalesce(s.unpriced_qty, 0)           as unpriced_qty,
       round(coalesce(s.shipped_cost, 0))    as shipped_cost,
       round(coalesce(d.made_material, 0))   as made_material,
       round(coalesce(d.made_conv, 0))       as made_conv,
       round(coalesce(p.spend, 0))           as spend
  from months m
  left join ship s  on s.month = m.month
  left join made d  on d.month = m.month
  left join spend p on p.month = m.month;

comment on view v_board_money is
  '달별 수입 · 지출 (0178). 출고 금액 · 출고분 원가는 출고한 달, 생산 투입 자재 · 가공비는 제조한 달, 자재 입고(spend)는 들어온 달';

grant select on v_sales_price to app_role, app_readonly;
grant select on v_board_money to app_role, app_readonly;
