/*
 * 0164 - 주문에서 생산 계획 · 자재 소요 예보 1: 칸 · 장당 개수 · 계획의 주문 줄
 *
 * 사용자 2026-11-25: «주문에서 생산 계획을 잡고, 자재가 얼마나 드는지 미리 보고 싶다.»
 * 주문 줄(형명 · 수량)로부터 몇 장을 몇 번 돌려야 하는지, 그 지시에 원료 · 시약 · 포장이
 * 얼마나 드는지 미리 셈하려면 세 가지가 필요하다.
 *   1. 판이 한 장에서 형명을 몇 개 뽑는가 - 유효 크기(usable_w x usable_h)와 형명 크기로 센다.
 *   2. 판이 쓰는 원료 품목 - 원료 재고와 견줄 때 어느 품목인지.
 *   3. 계획이 몇 장짜리이고 어느 주문 줄을 위한 것인가 - 지시가 나가면 그 줄도 지시에 함께 건다.
 * 새로 막는 것은 값의 모양뿐이다 (장수 > 0 · 이은 줄의 형명이 판 안 · 원료 칸은 원료 품목).
 * 다시 돌려도 된다.
 */

/* === 1. 판의 칸 ============================================================ */

alter table device_master add column if not exists usable_w numeric;
alter table device_master add column if not exists usable_h numeric;
alter table device_master add column if not exists raw_item_id uuid references item(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'device_master_usable_chk') then
    alter table device_master add constraint device_master_usable_chk
      check ((usable_w is null) = (usable_h is null) and coalesce(usable_w, 1) > 0 and coalesce(usable_h, 1) > 0);
  end if;
end $$;

comment on column device_master.usable_w is '원료 한 장에서 쓸 수 있는 가로 (cm). 장당 개수를 셀 때 쓴다 (0164)';
comment on column device_master.usable_h is '원료 한 장에서 쓸 수 있는 세로 (cm). 가로와 함께 적거나 함께 비운다 (0164)';
comment on column device_master.raw_item_id is '이 판이 쓰는 원료 품목. 원료(RAW) 품목만 (0164)';

create or replace function trg_dm_raw_item()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.raw_item_id is not null
     and not exists (select 1 from item where id = new.raw_item_id and type = 'RAW') then
    raise exception '원료 칸에는 원료 품목만 넣을 수 있습니다';
  end if;
  return new;
end $$;
drop trigger if exists device_master_raw_item on device_master;
create trigger device_master_raw_item before insert or update of raw_item_id on device_master
  for each row execute function trg_dm_raw_item();

/* === 2. 계획의 장수 · 주문 줄 ============================================== */

alter table batch_plan add column if not exists sheets int;
alter table batch_plan add column if not exists sales_order_line_id uuid references sales_order_line(id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'batch_plan_sheets_chk') then
    alter table batch_plan add constraint batch_plan_sheets_chk check (sheets > 0);
  end if;
end $$;
comment on column batch_plan.sheets is '이 계획이 돌릴 원료 장수 (0164)';
comment on column batch_plan.sales_order_line_id is '이 계획이 어느 주문 줄을 위한 것인가 (0164)';
create index if not exists batch_plan_so_line_idx on batch_plan (sales_order_line_id)
  where sales_order_line_id is not null;

/* === 3. 판이 시행 중인가 · 장당 개수 ======================================= */

create or replace function dm_effective(p_dm uuid)
returns boolean language sql stable
set search_path = pg_catalog, public, pg_temp as $$
  select coalesce((select verified_at is not null and status = 'ACTIVE'
                          and effective_from is not null
                          and effective_from <= (timezone('Asia/Seoul', now()))::date
                     from device_master where id = p_dm), false)
$$;
comment on function dm_effective(uuid) is
  '시행 중인 판인가. 확인되고 ACTIVE 이며 시행일이 오늘(서울) 이전 (0164)';

create or replace function model_per_sheet(p_dm uuid, p_item uuid)
returns int language plpgsql stable
set search_path = pg_catalog, public, pg_temp as $$
declare vw numeric; vh numeric; w numeric; h numeric; n int;
begin
  select usable_w, usable_h into vw, vh from device_master where id = p_dm;
  select p.value into w from model_parts((select code from item where id = p_item)) p where p.role = 'WIDTH' order by p.seq limit 1;
  select p.value into h from model_parts((select code from item where id = p_item)) p where p.role = 'HEIGHT' order by p.seq limit 1;
  if vw is null or vh is null or w is null or h is null or w <= 0 or h <= 0 then return null; end if;
  n := greatest(floor(vw / w) * floor(vh / h), floor(vw / h) * floor(vh / w));
  if n < 1 then return null; end if;
  return n;
end $$;
comment on function model_per_sheet(uuid, uuid) is
  '원료 한 장에서 그 형명이 몇 개 나오는가. 유효 크기를 형명 크기로 나눈 몫, 돌려 놓은 것과 큰 쪽. 모르면 null (0164)';

grant execute on function dm_effective(uuid) to app_role;
grant execute on function model_per_sheet(uuid, uuid) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'grant execute on function dm_effective(uuid) to app_readonly';
    execute 'grant execute on function model_per_sheet(uuid, uuid) to app_readonly';
  end if;
end $$;

/* === 4. 계획 <-> 주문 줄 =================================================== */

create or replace function trg_batch_plan_so_line()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.sales_order_line_id is null then return new; end if;
  if not exists (select 1 from dm_models(new.device_master_id) d
                  where d.id = (select item_id from sales_order_line where id = new.sales_order_line_id)) then
    raise exception '이 주문 줄의 형명은 이 제품표준서 판의 형명이 아닙니다';
  end if;
  return new;
end $$;
drop trigger if exists batch_plan_so_line on batch_plan;
create trigger batch_plan_so_line before insert or update of sales_order_line_id, device_master_id on batch_plan
  for each row execute function trg_batch_plan_so_line();

/* 계획에 지시가 이어지면 그 주문 줄도 지시에 함께 건다. 0159 의 규칙에 걸리면 줄 이음만 건너뛴다 */
create or replace function trg_batch_plan_attach_line()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $$
declare v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
begin
  if new.work_order_id is null or new.sales_order_line_id is null or v_user is null then return new; end if;
  if exists (select 1 from work_order_so_line
              where work_order_id = new.work_order_id
                and sales_order_line_id = new.sales_order_line_id and unlinked_at is null) then
    return new;
  end if;
  begin
    insert into work_order_so_line (work_order_id, sales_order_line_id, linked_by)
    values (new.work_order_id, new.sales_order_line_id, v_user);
  exception when raise_exception then
    /* 0159 의 규칙(취소된 줄 · 판 밖 형명)에 걸린 것만 건너뛴다. 나머지 오류는 그대로 올린다 */
    raise warning '주문 줄을 작업 지시에 걸지 못했습니다 (계획 잇기는 그대로): %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists batch_plan_attach_line on batch_plan;
create trigger batch_plan_attach_line after update of work_order_id on batch_plan
  for each row execute function trg_batch_plan_attach_line();

/* === 5. 덮인 개수 (저장하지 않고 센다) ===================================== */
/*
 * 주문 줄 하나가 이미 얼마나 덮였는가. 아무것도 막지 않고 보이기만 한다.
 *   - 지시 w (취소 아님 · 줄이 살아 있게 걸림):
 *       그 줄 형명의 제품 로트가 있으면 그 로트들 남은 양 x 줄 left / 같은 형명으로 걸린 살아 있는 줄들 left 합
 *       로트가 하나도 없으면(재단 전) ⌊지시 장수 x 줄 left / 걸린 살아 있는 줄 전부 left 합 x 장당 개수⌋
 *       로트는 있는데 그 형명이 아니면 0
 *       left 합이 0 이면 그 지시 몫은 0 (0 으로 나누지 않는다)
 *   - 지시 없는 이은 계획: 장수 x 장당 개수
 */
create or replace function so_line_covered(p_line uuid)
returns int language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  with l as (select id, item_id from sales_order_line where id = p_line),
  w as (
    select wo.id, wo.sheet_count, wo.device_master_id
      from work_order wo
     where wo.status <> 'CANCELLED'
       and exists (select 1 from work_order_so_line x
                    where x.work_order_id = wo.id and x.sales_order_line_id = p_line and x.unlinked_at is null)
  ),
  share as (
    select case
      when exists (select 1 from product_lot pl where pl.work_order_id = w.id) then
        case
          when not exists (select 1 from product_lot pl, l where pl.work_order_id = w.id and pl.item_id = l.item_id) then 0::numeric
          else coalesce((select sum(pl.qty_available) from product_lot pl, l
                          where pl.work_order_id = w.id and pl.item_id = l.item_id), 0)
               * so_line_left(p_line)
               / nullif((select sum(so_line_left(x.sales_order_line_id))
                           from work_order_so_line x join sales_order_line sl on sl.id = x.sales_order_line_id, l
                          where x.work_order_id = w.id and x.unlinked_at is null and sl.item_id = l.item_id), 0)
        end
      else
        floor(w.sheet_count::numeric * so_line_left(p_line)
              * coalesce((select model_per_sheet(w.device_master_id, l.item_id) from l), 0)
              / nullif((select sum(so_line_left(x.sales_order_line_id))
                          from work_order_so_line x
                         where x.work_order_id = w.id and x.unlinked_at is null), 0))
      end as n
    from w
  )
  select (coalesce((select sum(floor(coalesce(n, 0))) from share), 0)
        + coalesce((select sum(bp.sheets * coalesce(model_per_sheet(bp.device_master_id, l.item_id), 0))
                      from batch_plan bp, l
                     where bp.sales_order_line_id = p_line and bp.work_order_id is null and bp.sheets is not null), 0))::int
$fn$;
comment on function so_line_covered(uuid) is
  '그 주문 줄이 이미 덮인 개수. 걸린 지시의 몫 + 지시 없는 이은 계획. 막지 않고 보이기만 한다 (0164)';

/* === 6. 제안 대상 줄 ======================================================= */
create or replace function order_plan_lines()
returns table (line_id uuid, order_id uuid, customer_name text, customer_po_no text, due_on date,
               item_id uuid, item_code text, line_qty int, left_qty int, covered int, fg_stock int,
               dm_id uuid, dm_label text, per_sheet int, sheet_min int, sheet_max int, band text, multi_wo boolean)
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select l.id, o.id, c.name, o.customer_po_no, o.due_on,
         l.item_id, i.code, l.qty, so_line_left(l.id), so_line_covered(l.id),
         (select coalesce(sum(pl.qty_available), 0)::int from product_lot pl where pl.item_id = l.item_id),
         d.id, coalesce(d.product_code, di.code) || ' ' || d.revision,
         model_per_sheet(d.id, l.item_id), d.sheet_min, d.sheet_max, model_band(i.code),
         exists (select 1 from work_order_so_line x
                  where x.sales_order_line_id = l.id and x.unlinked_at is null
                    and exists (select 1 from work_order_so_line y
                                 where y.work_order_id = x.work_order_id and y.id <> x.id and y.unlinked_at is null))
    from sales_order_line l
    join sales_order o on o.id = l.sales_order_id
    join customer c on c.id = o.customer_id
    join item i on i.id = l.item_id
    join lateral (select dm.*
                    from device_master dm
                   where dm_effective(dm.id)
                     and exists (select 1 from dm_models(dm.id) m where m.id = l.item_id)
                   order by dm.effective_from desc, (model_per_sheet(dm.id, l.item_id) is not null) desc, dm.id
                   limit 1) d on true
    join item di on di.id = d.item_id
   where l.cancelled_at is null and o.cancelled_at is null
     and so_line_left(l.id) > 0
   order by o.due_on nulls last, o.customer_po_no
$fn$;
comment on function order_plan_lines() is
  '생산 계획을 제안할 주문 줄. 남은 수량이 있고 그 형명이 드는 시행 중인 판이 있는 줄. fg_stock 은 보이기만 한다 (0164)';

grant execute on function so_line_covered(uuid) to app_role;
grant execute on function order_plan_lines() to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'grant execute on function so_line_covered(uuid) to app_readonly';
    execute 'grant execute on function order_plan_lines() to app_readonly';
  end if;
end $$;
