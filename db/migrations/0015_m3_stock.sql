-- =============================================================================
-- 0015_m3_stock.sql  ·  재고 증감 · 용액 제조 · 알림
-- 근거: CLAUDE.md §4.7, §6
-- 범위: M3
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'movement_type') then
    create type movement_type as enum
      ('RETURN','DISPOSAL_WIP','DISPOSAL_STOCK','ADJUSTMENT','SOLUTION');
  end if;
end $$;

-- -----------------------------------------------------------------------------
--   SOLUTION 유형이 사내 제조 용액을 처리한다 (§4.7). 20X PBS와 30% 에탄올
--   희석액은 당일 제조·당일 폐기이므로 로트를 만들지 않는다. 제조 시 원료가
--   차감되는 것만 기록한다.
--
--   반납은 원 로트로 복귀시킨다. COA·MSDS 연결을 유지하기 위함이다.
--   개봉 후 반납 불가한 건은 DISPOSAL_WIP으로 처리한다.
-- -----------------------------------------------------------------------------
create table if not exists stock_movement (
  id              uuid primary key default gen_random_uuid(),
  material_lot_id uuid not null references material_lot(id),
  type            movement_type not null,
  qty             numeric not null,          -- 부호 포함. 반납 +, 폐기·소모 -
  work_order_id   uuid references work_order(id),
  product_lot_id  uuid references product_lot(id),
  reason_code     text not null,             -- 파손/오염/계량오차/기한경과/용액제조/기타
  reason_detail   text,
  registered_by   uuid not null references app_user(id),
  registered_at   timestamptz not null default now(),
  check (type <> 'DISPOSAL_WIP' or work_order_id is not null)
);
create index if not exists stock_movement_lot_idx on stock_movement (material_lot_id, registered_at desc);
create index if not exists stock_movement_wo_idx on stock_movement (work_order_id);

-- 부호가 유형과 어긋나면 재고가 조용히 반대로 움직인다.
-- 반납은 +, 폐기·용액제조는 -, 조정은 양쪽 다 허용한다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_movement_sign') then
    alter table stock_movement add constraint stock_movement_sign check (
      case type
        when 'RETURN'         then qty > 0
        when 'DISPOSAL_WIP'   then qty < 0
        when 'DISPOSAL_STOCK' then qty < 0
        when 'SOLUTION'       then qty < 0
        when 'ADJUSTMENT'     then qty <> 0
      end
    );
  end if;
end $$;

-- 증감을 실제 잔여에 반영한다. 음수 재고는 만들지 않는다.
create or replace function trg_sm_apply()
returns trigger language plpgsql as $fn$
declare v_left numeric; v_lot text;
begin
  select qty_available, lot_no into v_left, v_lot
    from material_lot where id = new.material_lot_id for update;

  if v_left + new.qty < 0 then
    raise exception '로트 %의 잔여(%)를 넘어서 차감할 수 없습니다 (요청 %)',
      v_lot, v_left, new.qty;
  end if;

  update material_lot
     set qty_available = qty_available + new.qty,
         status = case
           when qty_available + new.qty = 0 and status = 'AVAILABLE' then 'CONSUMED'
           when qty_available + new.qty > 0 and status = 'CONSUMED'  then 'AVAILABLE'
           else status end
   where id = new.material_lot_id;
  return new;
end $fn$;

drop trigger if exists stock_movement_apply on stock_movement;
create trigger stock_movement_apply after insert
  on stock_movement for each row execute function trg_sm_apply();


-- -----------------------------------------------------------------------------
-- 용액 제조 (§4.7)
--   원료 여러 종이 한 번에 차감된다. 한 번의 제조가 한 묶음으로 남아야
--   나중에 "그날 무엇을 얼마나 썼는가"를 설명할 수 있다.
-- -----------------------------------------------------------------------------
create or replace function make_solution(
  p_lots  uuid[],
  p_qtys  numeric[],
  p_name  text,
  p_note  text default null
) returns int
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare i int; v_actor uuid := current_user_id();
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if array_length(p_lots, 1) is distinct from array_length(p_qtys, 1) then
    raise exception '자재 수와 수량 수가 맞지 않습니다';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception '제조한 용액 이름을 입력하십시오';
  end if;

  for i in 1 .. array_length(p_lots, 1) loop
    insert into stock_movement (material_lot_id, type, qty, reason_code, reason_detail,
                                registered_by)
    values (p_lots[i], 'SOLUTION', -abs(p_qtys[i]), '용액제조',
            p_name || coalesce(' / ' || p_note, ''), v_actor);
  end loop;

  return array_length(p_lots, 1);
end $fn$;


-- -----------------------------------------------------------------------------
-- 최소 재고선 (§6)
--   발주중 수량을 포함해 중복 알림을 막는다.
-- -----------------------------------------------------------------------------
create or replace view v_reorder_alert as
select i.id, i.code, i.name, i.usage_uom, i.lead_days,
       coalesce(sum(ml.qty_available), 0) as on_hand,
       coalesce((select sum(po.qty) from purchase_order po
                  where po.item_id = i.id and po.status = 'ORDERED'), 0) as on_order,
       i.min_stock, i.min_stock_auto, i.min_stock_basis
  from item i
  left join material_lot ml on ml.item_id = i.id and ml.status = 'AVAILABLE'
 where i.is_active and i.min_stock is not null
 group by i.id
having coalesce(sum(ml.qty_available), 0)
     + coalesce((select sum(po.qty) from purchase_order po
                  where po.item_id = i.id and po.status = 'ORDERED'), 0) < i.min_stock;

-- 재고 현황. 자재는 로트별 합, 완제품은 유효기한 순이 기본이다 (§6).
create or replace view v_material_stock as
select i.id as item_id, i.code, i.name, i.type, i.usage_uom, i.min_stock,
       coalesce(sum(ml.qty_available) filter (where ml.status = 'AVAILABLE'), 0) as on_hand,
       count(ml.id) filter (where ml.status = 'AVAILABLE')  as lot_count,
       min(ml.expiry_date) filter (where ml.status = 'AVAILABLE') as nearest_expiry
  from item i
  left join material_lot ml on ml.item_id = i.id
 where i.is_active and i.type <> 'FIN'
 group by i.id;

create or replace view v_finished_stock as
select pl.id, pl.lot_no, pl.item_id, i.code, i.name,
       pl.qty_available, pl.qty_produced, pl.qty_sample,
       pl.manufactured_on, pl.expiry_date, pl.status, pl.location,
       (pl.expiry_date - (timezone('Asia/Seoul', now()))::date) as days_left,
       wo.batch_no
  from product_lot pl
  join item i on i.id = pl.item_id
  join work_order wo on wo.id = pl.work_order_id;

-- -----------------------------------------------------------------------------
-- 최소 재고선 자동 산출 (§6)
--   min_stock_auto에 제안값만 넣고 min_stock을 덮어쓰지 않는다.
--   산출 근거를 문장으로 남긴다. 근거 없는 숫자는 아무도 믿지 않는다.
-- -----------------------------------------------------------------------------
create or replace function suggest_min_stock(p_days int default 90)
returns int language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare n int := 0; r record;
begin
  for r in
    select i.id, i.code, i.usage_uom, coalesce(i.lead_days, 14) as lead_days,
           coalesce(sum(mi.qty), 0) as used,
           count(distinct pr.work_order_id) as batches
      from item i
      left join material_lot ml on ml.item_id = i.id
      left join material_issue mi on mi.material_lot_id = ml.id
           and mi.issued_at >= now() - make_interval(days => p_days)
      left join process_record pr on pr.id = mi.process_record_id
     where i.is_active and i.type <> 'FIN'
     group by i.id
  loop
    if r.used > 0 then
      update item
         set min_stock_auto = ceil(r.used / p_days::numeric * r.lead_days * 1.5),
             min_stock_basis = format(
               '최근 %s일 사용량 %s %s (배치 %s건) 기준. 일평균 x 리드타임 %s일 x 1.5',
               p_days, round(r.used, 2), r.usage_uom, r.batches, r.lead_days)
       where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $fn$;
