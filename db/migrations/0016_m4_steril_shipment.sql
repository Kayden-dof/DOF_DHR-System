-- =============================================================================
-- 0016_m4_steril_shipment.sql  ·  멸균 위탁 · 출고 · 원가 집계
-- 근거: CLAUDE.md §4.8, §4.9, §9 M4
-- 범위: M4
-- =============================================================================

-- -----------------------------------------------------------------------------
--   WS-09는 50개(25ea 2줄) 박스 단위로 발송한다. 한 박스에 여러 제품 로트가
--   들어갈 수 있으므로 M:N이다. 판정은 서면으로 하고 시스템은 발송·회수 시점과
--   성적서 번호만 기록한다 (§4.8).
-- -----------------------------------------------------------------------------
create table if not exists steril_batch (
  id            uuid primary key default gen_random_uuid(),
  batch_no      text not null unique,
  request_no    text,                        -- 의뢰서 번호
  vendor_name   text not null,
  shipped_at    date,
  received_at   date,
  cert_no       text,                        -- 멸균 성적서 번호
  registered_by uuid not null references app_user(id)
);

create table if not exists steril_batch_lot (
  steril_batch_id uuid not null references steril_batch(id),
  product_lot_id  uuid not null references product_lot(id),
  qty             int not null check (qty > 0),
  primary key (steril_batch_id, product_lot_id)
);
create index if not exists steril_batch_lot_pl_idx on steril_batch_lot (product_lot_id);

-- 회수일이 발송일보다 빠를 수 없다. 산술로 정해지는 것만 막는다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'steril_batch_dates') then
    alter table steril_batch add constraint steril_batch_dates
      check (received_at is null or shipped_at is null or received_at >= shipped_at);
  end if;
end $$;

-- 발송하면 제품 로트가 멸균중이 되고, 회수하면 시험 대기로 돌아온다.
-- 판정하지 않는다. 어디에 있는지만 따라간다.
create or replace function trg_steril_status()
returns trigger language plpgsql as $fn$
begin
  if new.shipped_at is not null and (old is null or old.shipped_at is null) then
    update product_lot set status = 'STERILIZING'
     where id in (select product_lot_id from steril_batch_lot where steril_batch_id = new.id)
       and status = 'PACKED';
  end if;
  if new.received_at is not null and (old is null or old.received_at is null) then
    update product_lot set status = 'TESTED'
     where id in (select product_lot_id from steril_batch_lot where steril_batch_id = new.id)
       and status = 'STERILIZING';
  end if;
  return new;
end $fn$;

drop trigger if exists steril_batch_status on steril_batch;
create trigger steril_batch_status after insert or update
  on steril_batch for each row execute function trg_steril_status();


-- -----------------------------------------------------------------------------
-- 출고 (§4.9)
-- -----------------------------------------------------------------------------
create table if not exists shipment (
  id             uuid primary key default gen_random_uuid(),
  product_lot_id uuid not null references product_lot(id),
  customer_name  text not null,
  qty            int not null check (qty > 0),
  shipped_at     date not null,
  shipped_by     uuid not null references app_user(id)
);
create index if not exists shipment_lot_idx on shipment (product_lot_id);
create index if not exists shipment_date_idx on shipment (shipped_at desc);

-- 출고하면 출하 가능 수량이 줄어든다. 남은 것보다 많이 내보낼 수 없다.
create or replace function trg_shipment_apply()
returns trigger language plpgsql as $fn$
declare v_left int; v_lot text; v_status pl_status;
begin
  select qty_available, lot_no, status into v_left, v_lot, v_status
    from product_lot where id = new.product_lot_id for update;

  if v_left < new.qty then
    raise exception '제조번호 %의 출하 가능 수량(%)보다 많이 출고할 수 없습니다 (요청 %)',
      v_lot, v_left, new.qty;
  end if;

  update product_lot
     set qty_available = qty_available - new.qty,
         status = case when qty_available - new.qty = 0 then 'SHIPPED' else status end
   where id = new.product_lot_id;
  return new;
end $fn$;

drop trigger if exists shipment_apply on shipment;
create trigger shipment_apply after insert
  on shipment for each row execute function trg_shipment_apply();


-- -----------------------------------------------------------------------------
-- 원가 집계 (§9 M4 "제품 원가와 자재 지출이 분리 산출")
--
-- 두 가지는 다른 물건이다.
--   제품 원가  제품 로트에 실제로 들어간 자재의 매입가. 폐기분을 넣지 않는다 (§10)
--   자재 지출  기간에 사들인 자재 금액. 어디에 쓰였는지와 무관하다
-- -----------------------------------------------------------------------------

-- 배치에 들어간 자재 원가. 재단 전 공정은 배치 전체에 걸리므로
-- 제품 로트로 나눌 때는 생산 수량 비율로 배분한다.
create or replace view v_batch_cost as
select wo.id as work_order_id, wo.batch_no,
       -- 원재료: 배치에 지정된 로트에서 장입 장수만큼
       coalesce((select ml.unit_price * wo.sheet_count
                   from material_lot ml where ml.id = wo.material_lot_id), 0) as raw_cost,
       -- 재단 전 공정 자재
       coalesce((select sum(mi.qty * coalesce(ml.unit_price, 0))
                   from material_issue mi
                   join process_record pr on pr.id = mi.process_record_id
                   join material_lot ml on ml.id = mi.material_lot_id
                  where pr.work_order_id = wo.id and pr.product_lot_id is null), 0) as pre_cut_cost,
       -- 재단 후 공정 자재 (제품 로트별로 이미 갈림)
       coalesce((select sum(mi.qty * coalesce(ml.unit_price, 0))
                   from material_issue mi
                   join process_record pr on pr.id = mi.process_record_id
                   join material_lot ml on ml.id = mi.material_lot_id
                  where pr.work_order_id = wo.id and pr.product_lot_id is not null), 0) as post_cut_cost
  from work_order wo;

create or replace view v_product_lot_cost as
with base as (
  select pl.id, pl.lot_no, pl.item_id, pl.work_order_id, pl.qty_produced,
         sum(pl.qty_produced) over (partition by pl.work_order_id) as batch_qty
    from product_lot pl
)
select b.id as product_lot_id, b.lot_no, b.item_id, b.work_order_id, b.qty_produced,
       -- 배치 공통분(원재료 + 재단 전 공정)을 생산 수량 비율로 배분
       round((bc.raw_cost + bc.pre_cut_cost)
             * (b.qty_produced::numeric / nullif(b.batch_qty, 0)), 2) as shared_cost,
       -- 이 로트에만 들어간 재단 후 자재
       coalesce((select sum(mi.qty * coalesce(ml.unit_price, 0))
                   from material_issue mi
                   join process_record pr on pr.id = mi.process_record_id
                   join material_lot ml on ml.id = mi.material_lot_id
                  where pr.product_lot_id = b.id), 0) as own_cost
  from base b
  join v_batch_cost bc on bc.work_order_id = b.work_order_id;

-- 자재 지출. 기간별 매입 금액이며 제품 원가와 섞지 않는다.
create or replace view v_material_spend as
select date_trunc('month', timezone('Asia/Seoul', ml.received_at))::date as month,
       i.id as item_id, i.code, i.name, i.type,
       sum(ml.qty_received) as qty,
       sum(ml.qty_received * coalesce(ml.unit_price, 0)) as amount
  from material_lot ml
  join item i on i.id = ml.item_id
 group by 1, 2, 3, 4, 5;
