/* ---------------------------------------------------------------------------
   경영 현황

   열람자가 보는 것은 넷뿐이다 (사용자 지시).

     오늘 몇 개가 만들어졌나 · 어떤 제품인가
     이번 달 얼마나 만들었고 얼마나 썼나
     되돌린 것이 얼마나 되나
     이 개체 번호가 무엇인가

   화면마다 질의를 흩어 놓지 않고 뷰로 세운다. 숫자를 두 곳에서 따로 세면
   반드시 어긋난다.

   ── "불량률" 이라고 부르지 않는다 ─────────────────────────────────────────
   이 시스템에는 불량이라는 기록이 없다. 있는 것은 셋이다.

     재작업(재포장) 수량   process_record.rework_qty · 제품 개수 단위
     공정 중 폐기          stock_movement DISPOSAL_WIP · 자재 단위
     예정과 재단의 차이    work_order.planned_units 대비

   이 값들을 합쳐 하나의 비율로 만들면 그 순간 시스템이 무엇을 불량으로 볼지
   정하는 것이 된다. 그건 판정이고 이 시스템이 하지 않는 일이다 (§1).

   그래서 각각을 그대로 세어 내보내고, 화면에는 무엇을 센 것인지 함께 적는다.
   불량률의 정의는 품질이 정하고, 정해지면 그 식을 여기 넣는다.
--------------------------------------------------------------------------- */

/* --- 날짜별 생산 ----------------------------------------------------------
   재단한 날 기준이다. 제조번호가 붙은 날이 곧 그 제품이 생긴 날이다.
-------------------------------------------------------------------------- */
create or replace view v_output_daily as
select pl.manufactured_on                     as made_on,
       dm.product_code, dm.product_name,
       i.code  as item_code,
       i.name  as item_name,
       count(*)::int                          as lots,
       sum(pl.qty_produced)::int              as produced,
       sum(pl.qty_sample)::int                as sampled,
       sum(pl.qty_available)::int             as available
  from product_lot pl
  join item i        on i.id = pl.item_id
  join work_order wo on wo.id = pl.work_order_id
  join device_master dm on dm.id = wo.device_master_id
 group by 1, 2, 3, 4, 5;

grant select on v_output_daily to app_role, app_readonly;

/* --- 달별 생산 · 출고 · 되돌림 --------------------------------------------
   세 가지를 한 줄에 놓는다. 만든 것과 나간 것과 되돌린 것.
-------------------------------------------------------------------------- */
create or replace view v_output_monthly as
with made as (
  select date_trunc('month', pl.manufactured_on)::date as month,
         count(*)::int             as lots,
         sum(pl.qty_produced)::int as produced,
         sum(pl.qty_sample)::int   as sampled
    from product_lot pl group by 1
),
shipped as (
  select date_trunc('month', s.shipped_at)::date as month,
         sum(s.qty)::int as shipped
    from shipment s group by 1
),
reworked as (
  select date_trunc('month', pr.work_date)::date as month,
         sum(pr.rework_qty)::int as rework
    from process_record pr
   where pr.rework_qty is not null
   group by 1
)
select coalesce(made.month, shipped.month, reworked.month) as month,
       coalesce(made.lots, 0)      as lots,
       coalesce(made.produced, 0)  as produced,
       coalesce(made.sampled, 0)   as sampled,
       coalesce(shipped.shipped, 0) as shipped,
       coalesce(reworked.rework, 0) as rework
  from made
  full join shipped  on shipped.month  = made.month
  full join reworked on reworked.month = coalesce(made.month, shipped.month);

grant select on v_output_monthly to app_role, app_readonly;

/* --- 개체 번호 찾기 -------------------------------------------------------
   P2608-0004-007 처럼 뒤에 순번이 붙은 것도, 제조번호만 적은 것도 받는다.
   사람이 라벨에서 옮겨 적을 때 어디까지 적을지 정해 주지 않는다.

   순번이 붙었으면 그 번호가 시료인지 · 어디로 나갔는지까지 답한다.
-------------------------------------------------------------------------- */
create or replace function find_unit(p_text text)
returns table (
  product_lot_id uuid, lot_no text, seq int,
  item_code text, item_name text,
  product_code text, product_name text,
  batch_no text, work_order_id uuid,
  raw_lot_no text, manufactured_on date, expiry_date date,
  qty_produced int, qty_sample int,
  standing text, customer_name text, shipped_at date
) language sql stable as $fn$
  /*
   * 제조번호 형식을 짐작하지 않는다.
   *
   * 처음에는 뒤에 붙은 -숫자를 순번으로 떼어 냈는데, 제조번호 자체가
   * P2608-0001 처럼 -숫자로 끝나서 순번이 없는 입력까지 잘려 나갔다.
   * 채번 규칙은 화면에서 정하므로 형식이 언제든 바뀐다 (§4.10).
   *
   * 그래서 적힌 그대로를 먼저 제조번호로 찾아본다. 있으면 그게 답이고,
   * 없을 때만 뒤의 -숫자를 순번으로 떼어 다시 찾는다. 형식을 몰라도 된다.
   */
  with t as (select btrim(p_text) as raw),
  parsed as (
    select
      case when exists (select 1 from product_lot p where p.lot_no = t.raw)
           then t.raw
           else regexp_replace(t.raw, '-(\d{1,4})$', '') end as lot,
      case when exists (select 1 from product_lot p where p.lot_no = t.raw)
           then null::int
           when t.raw ~ '-\d{1,4}$'
           then (regexp_replace(t.raw, '^.*-(\d{1,4})$', '\1'))::int
           else null::int end as seq
      from t
  )
  select pl.id, pl.lot_no, parsed.seq,
         i.code, i.name, dm.product_code, dm.product_name,
         wo.batch_no, wo.id,
         ml.lot_no, pl.manufactured_on, pl.expiry_date,
         pl.qty_produced, pl.qty_sample,
         case
           when parsed.seq is null                then '제조번호 전체'
           when parsed.seq > pl.qty_produced      then '이 제조번호에 없는 번호'
           when parsed.seq <= pl.qty_sample       then '완제품검사 시료'
           when sh.id is not null                 then '출고됨'
           else '재고'
         end,
         sh.customer_name, sh.shipped_at
    from parsed
    join product_lot pl on pl.lot_no = parsed.lot
    join item i         on i.id = pl.item_id
    join work_order wo  on wo.id = pl.work_order_id
    join device_master dm on dm.id = wo.device_master_id
    join material_lot ml  on ml.id = wo.material_lot_id
    left join shipment sh on sh.product_lot_id = pl.id
                        and parsed.seq is not null
                        and sh.unit_from is not null
                        and parsed.seq between sh.unit_from and sh.unit_to
$fn$;

grant execute on function find_unit(text) to app_role, app_readonly;
