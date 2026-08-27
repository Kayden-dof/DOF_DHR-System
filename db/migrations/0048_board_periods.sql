/* ---------------------------------------------------------------------------
   일 · 주 · 달을 한 자리에서 센다

   경영 현황을 일 · 주 · 달로 나눠 보고 싶다 (사용자 요청). 기간마다 뷰를 따로
   만들면 같은 셈이 세 벌이 되고, 한 곳을 고칠 때 나머지 둘을 빠뜨린다.
   그래서 기간을 열로 두고 한 뷰에 담는다.

     period  'day' | 'week' | 'month'
     bucket  그 기간의 첫날

   주는 월요일에 시작한다. date_trunc('week') 가 ISO 주라 월요일이다. 달력이
   월요일부터인 곳에서 일하므로 그대로 쓴다.

   ── 재단 전과 후를 더하지 않는다 ──────────────────────────────────────────
   재단 전은 장이고 재단 후는 개다 (0047). 한 줄에 나란히 두되 더하지 않는다.
   sheets_* 는 장이고 그 밖은 개다. 열 이름으로 구분한다.
--------------------------------------------------------------------------- */

create or replace view v_board_period as
with p as (
  select unnest(array['day', 'week', 'month']) as period
),
made as (
  select p.period,
         case p.period
           when 'day'   then pl.manufactured_on
           when 'week'  then date_trunc('week',  pl.manufactured_on)::date
           else              date_trunc('month', pl.manufactured_on)::date
         end as bucket,
         count(*)::int             as lots,
         sum(pl.qty_produced)::int as produced,
         sum(pl.qty_sample)::int   as sampled
    from product_lot pl, p
   group by 1, 2
),
shipped as (
  select p.period,
         case p.period
           when 'day'   then s.shipped_at
           when 'week'  then date_trunc('week',  s.shipped_at)::date
           else              date_trunc('month', s.shipped_at)::date
         end as bucket,
         sum(s.qty)::int as shipped
    from shipment s, p
   group by 1, 2
),
/* 제품 부적합. 제조일 기준으로 묶는다 - 만든 것과 견주는 값이므로 */
nc as (
  select p.period,
         case p.period
           when 'day'   then pl.manufactured_on
           when 'week'  then date_trunc('week',  pl.manufactured_on)::date
           else              date_trunc('month', pl.manufactured_on)::date
         end as bucket,
         sum(n.qty) filter (where n.outcome = 'REWORK')::int     as rework,
         sum(n.qty) filter (where n.outcome = 'CONCESSION')::int as concession,
         sum(n.qty) filter (where n.outcome = 'SCRAP')::int      as scrap
    from product_nonconformity n
    join product_lot pl on pl.id = n.product_lot_id, p
   group by 1, 2
),
/* 재단 전. 장 단위이고 배치 발행일 기준이다 */
charged as (
  select p.period,
         case p.period
           when 'day'   then (timezone('Asia/Seoul', wo.issued_at))::date
           when 'week'  then date_trunc('week',  timezone('Asia/Seoul', wo.issued_at))::date
           else              date_trunc('month', timezone('Asia/Seoul', wo.issued_at))::date
         end as bucket,
         sum(wo.sheet_count)::int as sheets
    from work_order wo, p
   where wo.status <> 'CANCELLED'
   group by 1, 2
),
wip as (
  select p.period,
         case p.period
           when 'day'   then (timezone('Asia/Seoul', wo.issued_at))::date
           when 'week'  then date_trunc('week',  timezone('Asia/Seoul', wo.issued_at))::date
           else              date_trunc('month', timezone('Asia/Seoul', wo.issued_at))::date
         end as bucket,
         sum(n.sheets) filter (where n.outcome = 'SCRAP')::int  as sheet_scrap,
         sum(n.sheets) filter (where n.outcome = 'REWORK')::int as sheet_rework
    from wip_nonconformity n
    join work_order wo on wo.id = n.work_order_id, p
   group by 1, 2
),
spend as (
  select p.period,
         case p.period
           when 'day'   then (timezone('Asia/Seoul', ml.received_at))::date
           when 'week'  then date_trunc('week',  timezone('Asia/Seoul', ml.received_at))::date
           else              date_trunc('month', timezone('Asia/Seoul', ml.received_at))::date
         end as bucket,
         sum(ml.qty_received * coalesce(ml.unit_price, 0)) as amount
    from material_lot ml, p
   group by 1, 2
),
keys as (
  select period, bucket from made
  union select period, bucket from shipped
  union select period, bucket from charged
  union select period, bucket from spend
)
select k.period, k.bucket,
       coalesce(made.lots, 0)         as lots,
       coalesce(made.produced, 0)     as produced,
       coalesce(made.sampled, 0)      as sampled,
       coalesce(shipped.shipped, 0)   as shipped,
       coalesce(nc.rework, 0)         as rework,
       coalesce(nc.concession, 0)     as concession,
       coalesce(nc.scrap, 0)          as scrap,
       coalesce(nc.rework, 0) + coalesce(nc.concession, 0) + coalesce(nc.scrap, 0) as found,
       case when coalesce(made.produced, 0) > 0
            then round(coalesce(nc.scrap, 0)::numeric  * 100 / made.produced, 2) end as scrap_pct,
       case when coalesce(made.produced, 0) > 0
            then round(coalesce(nc.rework, 0)::numeric * 100 / made.produced, 2) end as rework_pct,
       coalesce(charged.sheets, 0)      as sheets,
       coalesce(wip.sheet_scrap, 0)     as sheet_scrap,
       coalesce(wip.sheet_rework, 0)    as sheet_rework,
       case when coalesce(charged.sheets, 0) > 0
            then round(coalesce(wip.sheet_scrap, 0)::numeric * 100 / charged.sheets, 2)
       end as sheet_scrap_pct,
       coalesce(spend.amount, 0)        as spend
  from keys k
  left join made    on made.period    = k.period and made.bucket    = k.bucket
  left join shipped on shipped.period = k.period and shipped.bucket = k.bucket
  left join nc      on nc.period      = k.period and nc.bucket      = k.bucket
  left join charged on charged.period = k.period and charged.bucket = k.bucket
  left join wip     on wip.period     = k.period and wip.bucket     = k.bucket
  left join spend   on spend.period   = k.period and spend.bucket   = k.bucket;

grant select on v_board_period to app_role, app_readonly;
