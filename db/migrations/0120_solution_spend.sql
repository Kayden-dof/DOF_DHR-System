/* ---------------------------------------------------------------------------
   원액은 매입이 아니므로 자재 지출에서 뺀다
   (사용자 결정 2026-10-23 · 0117 ~ 0119 에서 이어짐)
   근거 CLAUDE.md §1 · §4.4 · §9 M4 (자재 지출과 제품 원가를 섞지 않는다)

   ── 같은 돈이 두 번 잡힌다 ───────────────────────────────────────────
   자재 지출은 기간별 매입 금액이다 (0016). 자재 로트의 받은 수량 x 단가를
   받은 달에 센다. 원액이 자재 로트 한 줄로 서면서(0118) 그 줄도 받은
   수량과 단가를 갖는다. 그대로 두면 한 번 쓴 돈이 두 번 지출로 나간다.

     원료 시약을 사 올 때              시약 로트가 서면서 한 번
     그 시약으로 원액을 만들 때        원액 로트가 서면서 또 한 번

   원액 단가는 원료 단가의 가중 평균이다 (0119). 새로 산 것이 아니라 이미 산
   시약이 모양을 바꾼 것이다. 현황판의 지출(v_board_period · 0048)도 같은
   로트 표를 같은 식으로 세므로 함께 뺀다.

   ── 어떻게 빼는가 ───────────────────────────────────────────────────
   제조일이 있는 로트가 원액 로트다 (made_on · 0118). 매입을 세는 자리에서
   그 줄만 거른다. 두 뷰의 열 이름 · 형 · 순서는 그대로이고, 이 뷰들을 읽는
   화면(원가 · 현황판)과 권한도 건드리지 않는다 - create or replace 는 걸려
   있는 권한을 그대로 둔다.

   원액의 값이 사라지는 것이 아니다. 원액이 공정에 들어가면 투입량 x 단가로
   배치 원가(v_batch_cost)에 잡힌다. PBS 시약값이 원가에 들어가는 자리는
   거기다. 지출과 원가는 섞지 않는다 (§9 M4).

   판정하지 않는다 (§1). 무엇이 매입이냐를 정하는 것이 아니라 이미 적힌
   로트의 갈래(입고 · 사내 제조)로 센다.

   ── 이 파일이 최종 모양을 정한다 ─────────────────────────────────────
   이관은 배포마다 처음부터 다시 돈다. 0016 과 0048 이 앞서 다시 돌면서 옛
   정의로 덮고, 마지막에 도는 이 파일이 원액을 뺀 모양으로 되돌린다.
   두 뷰의 본문은 0016 · 0048 의 정의 그대로이고 매입을 세는 줄에 조건
   하나만 더했다.
   --------------------------------------------------------------------------- */


/* === 1. 자재 지출 (0016) ================================================ */
create or replace view v_material_spend as
select date_trunc('month', timezone('Asia/Seoul', ml.received_at))::date as month,
       i.id as item_id, i.code, i.name, i.type,
       sum(ml.qty_received) as qty,
       sum(ml.qty_received * coalesce(ml.unit_price, 0)) as amount
  from material_lot ml
  join item i on i.id = ml.item_id
 where ml.made_on is null
 group by 1, 2, 3, 4, 5;


/* === 2. 현황판 지출 (0048) ============================================== */
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
   where ml.made_on is null
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
