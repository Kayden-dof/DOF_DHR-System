/* ===========================================================================
   0172 · 자체 생산품은 최소 재고선 아래로 치지 않는다 (사용자 2026-11-26)

   «최소 재고선 아래 항목으로 이야기할 때는 그 PBS 는 뺍시다. 내가 생산하면 되는 건 최소 재고선 아래
   기준을 적용할 필요 없을 듯합니다.»

   현황의 «최소 재고선 아래 1종» 이 SL-001 20X PBS(재고 3.4 L / 선 12.8 L) 였다. 원액은 사 오는 것이
   아니라 원료로 만들어 쓰므로, 모자라면 발주가 아니라 원액 제조를 하면 된다. 발주 화면의 경보에 올라도
   할 수 있는 일이 없다.

   이제
     · v_reorder_alert 가 자체 생산 품목(원액 SOLUTION · 완제품 FIN)을 보지 않는다. 현황 · 재고 · 발주
       화면이 모두 이 뷰를 센다.
     · suggest_min_stock 이 원액에 선을 적지 않는다. 원액의 한 배치 소요량은 그대로 셈해 원료(염화칼륨
       등)의 선으로 넘긴다 - 원료는 사 오는 것이므로 선이 있어야 한다.
     · 원액에 남아 있던 선과 제안값을 지운다 (SL-001 12.8 L 는 예전 사용량 셈이 남긴 값이었다).
=========================================================================== */

create or replace view v_reorder_alert as
with pending as (
  select po.item_id, sum(greatest(po.qty - po_received(po.id), 0)) as on_order
    from purchase_order po
   where po.status = 'ORDERED'
   group by po.item_id
)
select i.id, i.code, i.name, i.usage_uom, i.lead_days,
       coalesce(sum(ml.qty_available), 0) as on_hand,
       coalesce(max(p.on_order), 0) as on_order,
       i.min_stock, i.min_stock_auto, i.min_stock_basis
  from item i
  left join material_lot ml on ml.item_id = i.id and ml.status = 'AVAILABLE'
  left join pending p on p.item_id = i.id
 where i.is_active and i.min_stock is not null
   and i.type not in ('SOLUTION', 'FIN')
 group by i.id
having coalesce(sum(ml.qty_available), 0) + coalesce(max(p.on_order), 0) < i.min_stock;

grant select on v_reorder_alert to app_role, app_readonly;

create or replace function suggest_min_stock(p_days int default 90)
returns int language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  c_sheets constant int := 20;      -- 표준 배치 장입 (사용자 2026-11-26 «20장입»)
  c_pack_min constant int := 2000;  -- 개당 기준 포장재의 최소 재고선 (사용자 2026-11-26 «지금은 2000장»)
  n int := 0; r record; v_min numeric; v_basis text; v_detail text; v_done uuid[] := '{}';
begin
  for r in
    with base as (
      /* 발효(ACTIVE)된 판 전부. 시행 중인 판과 곧 시행할 판의 구성표가 다를 수 있다 - 품목마다 큰 쪽을 쓴다 (pick) */
      select dm.id, dm.product_code, dm.revision, dm.expected_units
        from device_master dm
       where dm.status = 'ACTIVE'
    ),
    small as (
      /* 가장 작은 형명 = 원료 한 장에서 가장 많이 나오는 형명 */
      select b.id as dm,
             (select m.code from dm_models(b.id) m
               where model_per_sheet(b.id, m.id) is not null
               order by model_per_sheet(b.id, m.id) desc, m.code limit 1) as code,
             (select max(model_per_sheet(b.id, m.id)) from dm_models(b.id) m) as per_sheet
        from base b
    ),
    line as (
      select b.id as dm, b.product_code, b.revision, bom.component_item_id as item_id, bom.basis::text as basis,
             case bom.basis
               when 'SHEET_TIER' then (
                 select t.qty from dmr_bom_tier t
                  where t.dmr_bom_id = bom.id and c_sheets >= t.min_sheets
                    and (t.max_sheets is null or c_sheets <= t.max_sheets)
                  order by t.min_sheets desc limit 1)
               when 'PER_UNIT' then bom.qty_per_unit * coalesce(c_sheets * s.per_sheet, b.expected_units)
             end as qty
        from base b
        join small s on s.dm = b.id
        join dmr_operation o on o.device_master_id = b.id
        join dmr_bom bom on bom.operation_id = o.id
    ),
    direct as (
      select item_id, dm, product_code, revision, sum(qty) as per_batch, bool_or(basis = 'PER_UNIT') as per_unit
        from line where qty is not null group by item_id, dm, product_code, revision
    ),
    /* 원액 한 단위(사용 단위)를 만들 때 든 원료의 양 - 지난 원액 제조 기록의 합으로 */
    sol as (
      select sl.item_id as solution_item, sum(sl.qty_received) as made
        from material_lot sl
       where sl.id in (select solution_lot_id from v_solution_input)
       group by sl.item_id
    ),
    ratio as (
      select sl.item_id as solution_item, ml.item_id as input_item, sum(v.qty) / s.made as per_unit
        from v_solution_input v
        join material_lot sl on sl.id = v.solution_lot_id
        join material_lot ml on ml.id = v.material_lot_id
        join sol s on s.solution_item = sl.item_id
       where s.made > 0
       group by sl.item_id, ml.item_id, s.made
    ),
    via as (
      select ra.input_item as item_id, d.dm, d.product_code, d.revision,
             sum(d.per_batch * ra.per_unit) as per_batch,
             string_agg(distinct si.code, ' · ') as through
        from direct d
        join ratio ra on ra.solution_item = d.item_id
        join item si on si.id = d.item_id
       group by ra.input_item, d.dm, d.product_code, d.revision
    ),
    total as (
      select item_id, dm, product_code, revision, sum(per_batch) as per_batch,
             bool_or(per_unit) as per_unit, string_agg(through, ' · ') as through
        from (select item_id, dm, product_code, revision, per_batch, per_unit, null::text as through from direct
              union all
              select item_id, dm, product_code, revision, per_batch, false, through from via) u
       group by item_id, dm, product_code, revision
    ),
    pick as (
      select distinct on (t.item_id) t.*, s.code as small_code, s.per_sheet
        from total t join small s on s.dm = t.dm
       where t.per_batch > 0
       order by t.item_id, t.per_batch desc
    )
    select i.id, i.usage_uom, i.type::text as type, p.product_code, p.revision, p.per_batch, p.per_unit, p.through,
           p.small_code, p.per_sheet
      from pick p join item i on i.id = p.item_id
     where i.is_active
       and i.type <> 'SOLUTION'   -- 자체 생산 원액은 선을 두지 않는다 (0172). 원료 셈(via)에는 그대로 든다
  loop
    v_detail := format('한 배치 소요 %s %s (%s %s · %s장%s%s)',
                       trim(trailing '.' from trim(trailing '0' from round(r.per_batch, 3)::text)),
                       r.usage_uom, r.product_code, r.revision, c_sheets,
                       case when r.per_unit and r.small_code is not null
                            then format(' · 가장 작은 형명 %s 장당 %s개', r.small_code, r.per_sheet) else '' end,
                       case when r.through is not null
                            then format(' · 원액 %s 을 거쳐 · 지난 제조 비율', r.through) else '' end);
    if r.type = 'PACK' and r.per_unit then
      /* 개당 기준 포장재는 지금은 고정 수량 (사용자 2026-11-26 «포장재 최소 수량은 2000장으로 합시다 지금은») */
      v_min := c_pack_min;
      v_basis := format('포장재 최소 수량 %s (사용자 2026-11-26) · 참고 %s', c_pack_min, v_detail);
    else
      /* 개수로 세는 단위는 올린다 */
      v_min := case when r.usage_uom in ('EA', '개', '장', '매', '통', '병', 'BOX', 'box', '박스', 'roll', 'ROLL', '롤')
                    then ceil(r.per_batch * 4) else round(r.per_batch * 4, 3) end;
      v_basis := v_detail || ' x 4 배치';
    end if;
    update item
       set min_stock = v_min, min_stock_auto = v_min, min_stock_basis = v_basis
     where id = r.id
       and (min_stock is distinct from v_min or min_stock_auto is distinct from v_min
            or min_stock_basis is distinct from v_basis);
    v_done := v_done || r.id;
    n := n + 1;
  end loop;

  /* 구성표에도 원액 원료에도 없는 품목: 예전 사용량 셈을 제안값으로만 (0015 · 0169 그대로) */
  for r in
    select i.id, i.usage_uom, coalesce(i.lead_days, 14) as lead_days,
           coalesce(sum(mi.qty), 0) as used,
           count(distinct pr.work_order_id) as batches
      from item i
      left join material_lot ml on ml.item_id = i.id
      left join material_issue mi on mi.material_lot_id = ml.id
           and mi.issued_at >= now() - make_interval(days => p_days)
      left join process_record pr on pr.id = mi.process_record_id
     where i.is_active and i.type not in ('FIN', 'SOLUTION')
       and not (i.id = any(v_done))
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

comment on function suggest_min_stock(int) is
  '최소 재고선: 표준 배치 20장 소요 x 4 (포장재는 가장 작은 형명, 원액 원료는 지난 제조 비율)를 min_stock 으로. 그 밖은 사용량 셈을 제안값으로. 자체 생산(원액 · 완제품)은 두지 않는다 (0172)';

update item
   set min_stock = null, min_stock_auto = null, min_stock_basis = null
 where type in ('SOLUTION', 'FIN')
   and (min_stock is not null or min_stock_auto is not null or min_stock_basis is not null);
