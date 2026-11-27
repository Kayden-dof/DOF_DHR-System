/* ===========================================================================
   0177 · 취소가 배치 계획에 전해진다 · 주문에서 계획은 출고 마감일 먼저 (정밀 점검 E · 2026-11-27)

   사용자 2026-11-27 «E 진행 (권고)» - 계획 ↔ 지시 · 취소 전파.

   ── 1. 취소된 주문 · 줄의 계획은 자재 소요에서 뺀다 ──────────────────────────────
   주문이나 주문 줄을 취소해도 그 줄로 올린 배치 계획은 일정에 남고(지우는 것은 사람의 몫), material_needs 의
   계획 갈래는 취소를 보지 않고 장수대로 자재를 요구했다. 자재 › 소요 · 부족이 원료 · 포장재를 계속 부족으로
   보여 발주를 불렀다. 이제 취소된 줄 · 주문에 이은 계획은 소요에 넣지 않는다. 계획은 지우지 않는다.

   ── 2. 지시가 취소된 계획은 지시 없는 계획으로 다시 센다 ─────────────────────────
   계획에 이은 지시를 취소하면 그 계획은 «지시 있음» 이라 계획 갈래에서 빠지고, 지시는 취소라 지시 갈래에서도
   빠져 덮인 개수 · 소요 어디에도 남지 않았다. 계획은 여전히 만들 배치이므로 지시가 없던 때처럼 센다.
   이음(work_order_id)은 그대로 둔다 - 화면이 «지시 취소» 로 알리고, 사람이 새 지시를 잇는다.

   ── 3. 주문에서 계획의 차례는 출고 마감일 먼저 ────────────────────────────────────
   현황 · 수주는 출고 마감일(ship_by, 0173)로 남은 날을 세는데 주문에서 계획은 납품요청일(due_on)로 줄을
   세우고 «납기 넘김» 을 셌다 (운영 SD_261110-02 납품요청 11-19 · 출고 마감 12-31). 차례는 여기서
   coalesce(ship_by, due_on) 으로 바꾸고, 넘김 셈은 화면 · 액션이 출고 마감일을 먼저 쓴다.
   돌려주는 칸은 그대로 둔다 - 배포는 이관을 처음부터 다시 돌리므로, 칸을 바꾸면 앞선 0164 · 0167 의
   create or replace 가 «돌려주는 형을 바꿀 수 없음» 으로 멈춘다.

   새로 막는 것은 없다. 다시 돌려도 된다.
=========================================================================== */

/* === 1 · 2. 덮인 개수 =================================================== */
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
                     where bp.sales_order_line_id = p_line and bp.sheets is not null
                       /* 지시가 없거나, 이은 지시가 취소된 계획 (0177) */
                       and (bp.work_order_id is null
                            or exists (select 1 from work_order cw
                                        where cw.id = bp.work_order_id and cw.status = 'CANCELLED'))), 0))::int
$fn$;
comment on function so_line_covered(uuid) is
  '그 주문 줄이 이미 덮인 개수. 걸린 지시의 몫 + 지시 없는(또는 이은 지시가 취소된) 이은 계획. 막지 않고 보이기만 한다 (0164 · 0177)';


/* === 3. 주문에서 계획 - 차례만 출고 마감일 먼저 (본문 · 칸은 0167 그대로) ==== */
create or replace function order_plan_lines()
returns table (line_id uuid, order_id uuid, customer_name text, customer_po_no text, due_on date,
               item_id uuid, item_code text, line_qty int, left_qty int, covered int, fg_stock int,
               dm_id uuid, dm_label text, per_sheet int, sheet_min int, sheet_max int, band text, multi_wo boolean)
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select l.id, o.id, c.name, o.customer_po_no, o.due_on,
         l.item_id, i.code, l.qty, so_line_left(l.id), so_line_covered(l.id),
         (select coalesce(sum(pl.qty_available), 0)::int
            from product_lot pl
           where pl.item_id = l.item_id
             and pl.status not in ('SHIPPED', 'DISPOSED')
             and not exists (select 1 from work_order_so_line x join work_order wo on wo.id = x.work_order_id
                              where x.work_order_id = pl.work_order_id and x.sales_order_line_id = l.id
                                and x.unlinked_at is null and wo.status <> 'CANCELLED')),
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
   order by coalesce(o.ship_by, o.due_on) nulls last, o.customer_po_no
$fn$;
comment on function order_plan_lines() is
  '생산 계획을 제안할 주문 줄. 남은 수량이 있고 그 형명이 드는 시행 중인 판이 있는 줄, 출고 마감일(없으면 납품요청일) 차례. '
  'fg_stock 은 내보낼 수 있는 남은 양 (이 줄에 걸린 지시의 로트 · 출하 · 폐기 로트 뺌), 보이기만 한다 (0164 · 0167 · 0177)';


/* === 1 · 2. 자재 필요 - 계획 갈래 (나머지는 0167 그대로) ================== */
create or replace function material_needs(p_from date, p_to date)
returns table (item_id uuid, band text, need_on date, qty numeric, unit_known boolean,
               source text, source_id uuid, source_label text)
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  with plans as (
    select bp.id, bp.label, bp.sheets, greatest(bp.start_on, p_from) as need_on, bp.device_master_id,
           sl.item_id as line_item, i.code as line_code
      from batch_plan bp
      left join sales_order_line sl on sl.id = bp.sales_order_line_id
      left join sales_order so on so.id = sl.sales_order_id
      left join item i on i.id = sl.item_id
     where bp.sheets is not null
       and bp.start_on <= p_to
       /* 지시가 없거나, 이은 지시가 취소된 계획 (0177) */
       and (bp.work_order_id is null
            or exists (select 1 from work_order cw where cw.id = bp.work_order_id and cw.status = 'CANCELLED'))
       /* 취소된 주문 · 줄로 올린 계획은 소요에 넣지 않는다 (0177). 계획은 일정에 남는다 */
       and (sl.id is null or (sl.cancelled_at is null and so.cancelled_at is null))
  ),
  plan_bom as (
    select p.id, p.label, p.sheets, p.need_on, p.line_item,
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
  select pb.component_item_id, null::text, pb.need_on, pb.q, pb.q is not null,
         'PLAN'::text, pb.id, pb.label
    from plan_bom pb
  union all
  select dm.raw_item_id, case when p.line_code is null then null else model_band(p.line_code) end,
         p.need_on, p.sheets::numeric, true, 'PLAN'::text, p.id, p.label
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
  '기간 안의 계획과 진행 중인 지시가 쓸 자재. 계획은 구성표 · 장당 개수로 (시작일이 지난 계획은 기간 첫날에, '
  '이은 지시가 취소된 계획도, 취소된 주문 · 줄의 계획은 빼고), 지시는 필요 - 투입 순량. 모르면 qty null (0164 · 0167 · 0177)';

grant execute on function so_line_covered(uuid) to app_role;
grant execute on function order_plan_lines() to app_role;
grant execute on function material_needs(date, date) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'grant execute on function so_line_covered(uuid) to app_readonly';
    execute 'grant execute on function order_plan_lines() to app_readonly';
    execute 'grant execute on function material_needs(date, date) to app_readonly';
  end if;
end $$;
