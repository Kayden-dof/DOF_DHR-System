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
create index if not exists batch_plan_so_line on batch_plan (sales_order_line_id)
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
  select p.value into w from model_parts((select code from item where id = p_item)) p where p.role = 'WIDTH' limit 1;
  select p.value into h from model_parts((select code from item where id = p_item)) p where p.role = 'HEIGHT' limit 1;
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
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists batch_plan_attach_line on batch_plan;
create trigger batch_plan_attach_line after update of work_order_id on batch_plan
  for each row execute function trg_batch_plan_attach_line();
