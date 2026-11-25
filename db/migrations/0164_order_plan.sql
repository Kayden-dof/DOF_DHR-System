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
               * greatest(0, so_line_left(p_line))
               / nullif((select sum(greatest(0, so_line_left(x.sales_order_line_id)))
                           from work_order_so_line x join sales_order_line sl on sl.id = x.sales_order_line_id, l
                          where x.work_order_id = w.id and x.unlinked_at is null and sl.item_id = l.item_id), 0)
        end
      else
        floor(w.sheet_count::numeric * greatest(0, so_line_left(p_line))
              * coalesce((select model_per_sheet(w.device_master_id, l.item_id) from l), 0)
              / nullif((select sum(greatest(0, so_line_left(x.sales_order_line_id)))
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

/* === 7. 자재 필요 (저장하지 않고 센다) ===================================== */
/*
 * 기간 [p_from, p_to] 안에 드는 계획과, 지금 진행 중인 지시가 앞으로 쓸 자재. 아무것도 막지 않고 보이기만 한다.
 *   PLAN - 지시 없는 계획 중 장수가 있고 시작일이 기간 안인 것. 판의 구성표대로 센다.
 *          장입 구간 품목은 장수로, 개수 비례 품목은 이은 줄 형명의 장당 개수로. 줄이 없으면 개수를 몰라 비운다.
 *          판의 원료 품목은 장수만큼 (두께 구간은 이은 줄 형명의 것).
 *   WO   - 끝나지 않은 지시. 구성표 필요량에서 이미 투입한 순량(투입 - 반납)을 뺀 나머지. 원료는 지시가 이미
 *          로트를 골랐으므로 넣지 않는다. 예정 개수가 없는 지시의 개수 비례 품목, 구간 밖 장수의 장입 구간 품목은
 *          몰라서 비운다 (그 지시에서 그 품목을 이미 투입했으면 모름 줄은 내지 않는다).
 * 구매 · 입고 · 재고는 모두 사용 단위라 환산하지 않는다 (0102).
 */
create or replace function material_needs(p_from date, p_to date)
returns table (item_id uuid, band text, need_on date, qty numeric, unit_known boolean,
               source text, source_id uuid, source_label text)
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  with plans as (
    select bp.id, bp.label, bp.sheets, bp.start_on, bp.device_master_id,
           sl.item_id as line_item, i.code as line_code
      from batch_plan bp
      left join sales_order_line sl on sl.id = bp.sales_order_line_id
      left join item i on i.id = sl.item_id
     where bp.work_order_id is null and bp.sheets is not null
       and bp.start_on between p_from and p_to
  ),
  plan_bom as (
    select p.id, p.label, p.sheets, p.start_on, p.line_item,
           b.component_item_id, b.basis, o.id as op_id,
           case when b.basis = 'SHEET_TIER' then required_qty(o.id, b.component_item_id, p.sheets, 0)
                when p.line_item is not null and model_per_sheet(p.device_master_id, p.line_item) is not null
                  then required_qty(o.id, b.component_item_id, p.sheets,
                                    p.sheets * model_per_sheet(p.device_master_id, p.line_item))
           end as q
      from plans p
      join dmr_operation o on o.device_master_id = p.device_master_id
      join dmr_bom b on b.operation_id = o.id
  ),
  wo_req as (
    select wo.id, wo.batch_no, b.component_item_id,
           case when b.basis = 'PER_UNIT' and wo.planned_units is null then null
                else required_qty(o.id, b.component_item_id, wo.sheet_count, coalesce(wo.planned_units, 0))
           end as r
      from work_order wo
      join dmr_operation o on o.device_master_id = wo.device_master_id
      join dmr_bom b on b.operation_id = o.id
     where wo.status not in ('DONE', 'CANCELLED')
  ),
  wo_bom as (
    select id, batch_no, component_item_id, sum(coalesce(r, 0)) as known_need, bool_or(r is null) as unk
      from wo_req
     group by id, batch_no, component_item_id
  ),
  issued as (
    select pr.work_order_id as wo_id, ml.item_id,
           sum(mi.qty - coalesce((select sum(sm.qty) from stock_movement sm
                                   where sm.material_issue_id = mi.id and sm.type = 'RETURN'), 0)) as net
      from material_issue mi
      join process_record pr on pr.id = mi.process_record_id
      join material_lot ml on ml.id = mi.material_lot_id
     group by pr.work_order_id, ml.item_id
  )
  select pb.component_item_id, null::text, pb.start_on, pb.q, pb.q is not null,
         'PLAN'::text, pb.id, pb.label
    from plan_bom pb
  union all
  select dm.raw_item_id, case when p.line_code is null then null else model_band(p.line_code) end,
         p.start_on, p.sheets::numeric, true, 'PLAN'::text, p.id, p.label
    from plans p join device_master dm on dm.id = p.device_master_id
   where dm.raw_item_id is not null
  union all
  select w.component_item_id, null::text, p_from, w.known_need - coalesce(x.net, 0), true,
         'WO'::text, w.id, w.batch_no
    from wo_bom w left join issued x on x.wo_id = w.id and x.item_id = w.component_item_id
   where w.known_need - coalesce(x.net, 0) > 0
  union all
  select w.component_item_id, null::text, p_from, null::numeric, false,
         'WO'::text, w.id, w.batch_no
    from wo_bom w left join issued x on x.wo_id = w.id and x.item_id = w.component_item_id
   where w.unk and x.net is null
$fn$;
comment on function material_needs(date, date) is
  '기간 안의 계획과 진행 중인 지시가 쓸 자재. 계획은 구성표 · 장당 개수로, 지시는 필요 - 투입 순량. 모르면 qty null (0164)';

/* === 8. 자재 부족 (재고 · 발주중과 맞댄다) ================================= */
/*
 * (품목, 두께 구간) 마다 필요 합을 재고(필요일에 기한이 남은 AVAILABLE 로트)와 발주중(ORDERED 의 남은 양)에 맞댄다.
 * 원료는 같은 두께 구간 로트만 센다 (구간 없는 필요는 구간 없는 로트만). 재고는 마지막 필요일까지 기한이 남은 것만.
 * 발주중은 두께 구간이 없어, 구간이 여럿이면 필요일 · 구간 순으로 재고로 모자란 만큼씩 나눠 담는다 (이중으로 세지 않는다).
 * 부족이 있는 것, 발주 기한이 이른 것부터.
 */
create or replace function material_shortage(p_from date, p_to date)
returns table (item_id uuid, item_code text, item_name text, item_type text, usage_uom text, band text,
               need_qty numeric, unknown boolean, first_need_on date, stock_qty numeric,
               on_order_qty numeric, next_expected_on date, short_qty numeric, lead_days int, order_by date)
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  with n as (
    select m.item_id, m.band,
           coalesce(sum(m.qty) filter (where m.unit_known), 0) as need_qty,
           bool_or(not m.unit_known) as unk,
           min(m.need_on) as first_need_on,
           max(m.need_on) as last_need_on
      from material_needs(p_from, p_to) m
     group by m.item_id, m.band
  ),
  /* 재고: 마지막 필요일까지 기한이 남은 AVAILABLE 로트. 원료는 같은 두께 구간만 (구간이 없는 필요는 구간이 없는 로트만) */
  s as (
    select i.id, i.code, i.name, i.type::text as type, i.usage_uom, i.lead_days,
           n.band, n.need_qty, n.unk, n.first_need_on,
           (select coalesce(sum(ml.qty_available), 0) from material_lot ml
             where ml.item_id = n.item_id and ml.status = 'AVAILABLE'
               and (ml.expiry_date is null or ml.expiry_date >= n.last_need_on)
               and (i.type <> 'RAW' or ml.thickness_band is not distinct from n.band)) as stock_qty,
           (select coalesce(sum(greatest(0, po.qty - po_received(po.id))), 0) from purchase_order po
             where po.item_id = n.item_id and po.status = 'ORDERED') as po_total,
           (select min(po.expected_at) from purchase_order po
             where po.item_id = n.item_id and po.status = 'ORDERED') as next_expected_on
      from n join item i on i.id = n.item_id
  ),
  /* 발주중은 두께 구간이 없다. 같은 품목의 구간들에 필요일 순 · 구간 순으로 재고로 모자란 만큼씩 나눠 담는다 */
  g as (
    select s.*, greatest(0, s.need_qty - s.stock_qty) as gap,
           count(*) over (partition by s.id) as groups,
           coalesce(sum(greatest(0, s.need_qty - s.stock_qty))
                      over (partition by s.id order by s.first_need_on, s.band nulls last
                            rows between unbounded preceding and 1 preceding), 0) as gap_before
      from s
  ),
  r as (
    select g.*, case when g.groups = 1 then g.po_total
                     else greatest(0, least(g.gap, g.po_total - g.gap_before)) end as on_order_qty
      from g
  )
  select r.id, r.code, r.name, r.type, r.usage_uom, r.band, r.need_qty, coalesce(r.unk, false), r.first_need_on,
         r.stock_qty, r.on_order_qty, r.next_expected_on,
         greatest(0, r.need_qty - r.stock_qty - r.on_order_qty),
         r.lead_days, r.first_need_on - r.lead_days
    from r
   order by (greatest(0, r.need_qty - r.stock_qty - r.on_order_qty) > 0) desc,
            r.first_need_on - r.lead_days nulls last, r.code, r.band nulls last
$fn$;
comment on function material_shortage(date, date) is
  '자재 부족 셈. 필요 - 재고(필요일에 기한이 남은 것) - 발주중. 막지 않고 보이기만 한다 (0164)';

grant execute on function material_needs(date, date) to app_role;
grant execute on function material_shortage(date, date) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'grant execute on function material_needs(date, date) to app_readonly';
    execute 'grant execute on function material_shortage(date, date) to app_readonly';
  end if;
end $$;
