/*
 * 0167 - 주문에서 생산 계획 최종 고침 (0164 는 이미 운영에 있어 그 동작은 여기서 고친다)
 *
 * 1. 계획 · 지시 이음은 바뀔 때만.
 *    `update of 칸` 트리거는 값이 바뀔 때가 아니라 SET 에 그 칸이 적힐 때마다 돈다. 일정 화면의 저장은
 *    지시 칸 · 판 칸을 늘 다시 적으므로
 *      - 사람이 작업 지시 화면에서 사유를 적고 뗀 주문 줄이, 그 계획의 메모 · 날짜만 고쳐도 다시 걸렸다.
 *      - 형명 품목이 비활성이 되면 그 계획은 날짜조차 고칠 수 없었다 (주문 줄 형명을 저장마다 다시 검사).
 *    두 트리거에 when (old ... is distinct from new ...) 를 단다. 형명 검사는 넣을 때 · 줄이나 판을 바꿀 때만 돈다.
 *    지시를 A → B 로 바꿀 때 A 에 남은 이음은 시스템이 떼지 않는다 - 사람이 정한 것이라 화면이 떼라고 알린다.
 * 2. «완제품 재고» 는 내보낼 수 있는 남은 양만.
 *    이 줄에 살아 있게 걸린 지시의 로트는 이미 덮인 개수에 들어 있어 두 번 보였다. 그 로트와 출하 · 폐기된 로트
 *    (pl_status 'SHIPPED' · 'DISPOSED', 0012) 는 뺀다.
 * 3. 원료 두께 구간은 영문 · 숫자만 견준다.
 *    thickness_band 는 자유 입력이다. 0159 출고 검토는 '05-10' 과 '0510' 을 같게 보는데, 부족 셈은 글자 그대로
 *    견주어 적는 꼴이 다르면 재고를 0 으로 보고 거짓 부족을 냈다. 0159 와 같은 규칙으로 맞춘 뒤 견준다.
 * 4. 시작일이 지났는데 지시가 없는 계획도 소요에 넣는다.
 *    덮인 개수에는 들어가는데 소요에서는 빠졌다. 기간 끝 이전에 시작하는 계획은 모두 넣고, 필요일은
 *    시작일과 기간 첫날 가운데 늦은 날.
 *
 * 함수의 돌려주는 칸 · 순서 · 형은 그대로다 (화면 · 액션이 읽는다). 새로 막는 것은 없다. 다시 돌려도 된다.
 */

/* === 1. 계획 <-> 지시 · 주문 줄 트리거 ===================================== */

/* 지시가 실제로 바뀐 저장에서만 주문 줄을 새 지시에 건다 (함수 본문은 0164 그대로) */
drop trigger if exists batch_plan_attach_line on batch_plan;
create trigger batch_plan_attach_line after update of work_order_id on batch_plan
  for each row when (old.work_order_id is distinct from new.work_order_id)
  execute function trg_batch_plan_attach_line();

/*
 * 주문 줄 형명 검사는 넣을 때(줄이 있을 때)와, 줄이나 판이 실제로 바뀐 고침에서만.
 * 이름 batch_plan_so_line 은 고침 쪽에 남긴다 (스키마 기준선이 그 이름을 본다).
 */
drop trigger if exists batch_plan_so_line on batch_plan;
drop trigger if exists batch_plan_so_line_ins on batch_plan;
create trigger batch_plan_so_line_ins before insert on batch_plan
  for each row when (new.sales_order_line_id is not null)
  execute function trg_batch_plan_so_line();
create trigger batch_plan_so_line before update of sales_order_line_id, device_master_id on batch_plan
  for each row when (old.sales_order_line_id is distinct from new.sales_order_line_id
                     or old.device_master_id is distinct from new.device_master_id)
  execute function trg_batch_plan_so_line();

/* === 2. 제안 대상 줄 - 완제품 재고 ========================================= */
create or replace function order_plan_lines()
returns table (line_id uuid, order_id uuid, customer_name text, customer_po_no text, due_on date,
               item_id uuid, item_code text, line_qty int, left_qty int, covered int, fg_stock int,
               dm_id uuid, dm_label text, per_sheet int, sheet_min int, sheet_max int, band text, multi_wo boolean)
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select l.id, o.id, c.name, o.customer_po_no, o.due_on,
         l.item_id, i.code, l.qty, so_line_left(l.id), so_line_covered(l.id),
         /* 내보낼 수 있는 그 형명 로트의 남은 양. 이 줄에 살아 있게 걸린 지시의 로트는 덮인 개수에 이미 있어 뺀다
            (so_line_covered 가 세는 지시와 같은 조건 - 취소 아님 · 이음이 살아 있음). 출하 · 폐기 로트도 뺀다 */
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
   order by o.due_on nulls last, o.customer_po_no
$fn$;
comment on function order_plan_lines() is
  '생산 계획을 제안할 주문 줄. 남은 수량이 있고 그 형명이 드는 시행 중인 판이 있는 줄. '
  'fg_stock 은 내보낼 수 있는 남은 양 (이 줄에 걸린 지시의 로트 · 출하 · 폐기 로트 뺌), 보이기만 한다 (0164 · 0167)';

/* === 3. 자재 필요 - 지난 계획도 ============================================ */
/*
 * 0164 와 같고, 계획 갈래만 바뀐다: 지시 없는 계획 중 장수가 있고 기간 끝 이전에 시작하는 것 (시작일이 지난 것도).
 * 필요일은 시작일과 기간 첫날 가운데 늦은 날.
 */
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
      left join item i on i.id = sl.item_id
     where bp.work_order_id is null and bp.sheets is not null
       and bp.start_on <= p_to
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
  '기간 안의 계획과 진행 중인 지시가 쓸 자재. 계획은 구성표 · 장당 개수로 (시작일이 지난 계획은 기간 첫날에), '
  '지시는 필요 - 투입 순량. 모르면 qty null (0164 · 0167)';

/* === 4. 자재 부족 - 두께 구간 꼴 맞추기 ==================================== */
/*
 * 0164 와 같고, 원료 재고의 두께 구간 대조만 바뀐다: 로트 쪽 · 필요 쪽 모두 영문 · 숫자만 남기고 대문자로 맞춘 뒤
 * 견준다 (0159 ship_spec_check 와 같은 규칙). 남는 것이 없으면 구간 없음으로 본다. 돌려주는 band 는 필요 쪽 그대로.
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
               and (i.type <> 'RAW'
                    or nullif(upper(regexp_replace(coalesce(ml.thickness_band, ''), '[^0-9A-Za-z]', '', 'g')), '')
                       is not distinct from
                       nullif(upper(regexp_replace(coalesce(n.band, ''), '[^0-9A-Za-z]', '', 'g')), ''))) as stock_qty,
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
  '자재 부족 셈. 필요 - 재고(필요일에 기한이 남은 것, 원료는 두께 구간을 영문 · 숫자로 맞춰 견줌) - 발주중. '
  '막지 않고 보이기만 한다 (0164 · 0167)';

grant execute on function order_plan_lines() to app_role;
grant execute on function material_needs(date, date) to app_role;
grant execute on function material_shortage(date, date) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'grant execute on function order_plan_lines() to app_readonly';
    execute 'grant execute on function material_needs(date, date) to app_readonly';
    execute 'grant execute on function material_shortage(date, date) to app_readonly';
  end if;
end $$;
