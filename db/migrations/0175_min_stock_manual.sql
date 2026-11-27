/* ===========================================================================
   0175 · 최소 재고선을 사람이 바로 고친다 (사용자 2026-11-27)

   «재고에서 최소 재고선을 바로 고칠 수 있도록 기능 구현해 줘. 자동으로 최소 재고선을 다시 세는
    위치에서 정정해 줄 수 있어야 할 것 같아.»

   자재 구성표에 든 품목은 «최소 재고선 다시 셈» (suggest_min_stock, 0171 · 0172) 이 한 배치 소요 x 4
   (개당 포장재는 2,000) 로 선을 덮어쓴다. 그래서 사람이 품목 창에서 고쳐도 다음 다시 셈에서 돌아갔다.

     min_stock_manual  사람이 선을 직접 정했다. 다시 셈은 이 품목의 선(min_stock)을 두고 자동값 ·
                       근거(min_stock_auto · min_stock_basis)만 새로 적는다. 재고 화면의 «자동값으로
                       되돌리기» 가 false 로 돌리며 선을 자동값으로 맞춘다.

   구성표 밖 품목은 원래 다시 셈이 선을 건드리지 않는다 (제안값만). 이 칸은 그 품목에도 서지만 뜻은
   «사람이 정한 값» 그대로다.
=========================================================================== */

alter table item add column if not exists min_stock_manual boolean not null default false;

comment on column item.min_stock_manual is
  '최소 재고선을 사람이 직접 정함 (0175). 참이면 «최소 재고선 다시 셈» 이 min_stock 을 덮지 않고 자동값 · 근거만 고친다';

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
    /*
     * 직접 정정한 선은 두고 자동값 · 근거만 고친다 (0175 · 사용자 2026-11-27 «재고에서 최소 재고선을
     * 바로 고칠 수 있도록»). 자동값은 늘 새로 셈해 둬야 «자동값으로 되돌리기» 가 지금 구성표의 값으로 간다.
     */
    update item
       set min_stock = case when min_stock_manual then min_stock else v_min end,
           min_stock_auto = v_min, min_stock_basis = v_basis
     where id = r.id
       and ((not min_stock_manual and min_stock is distinct from v_min)
            or min_stock_auto is distinct from v_min
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
  '최소 재고선: 표준 배치 20장 소요 x 4 (포장재는 가장 작은 형명, 원액 원료는 지난 제조 비율)를 min_stock 으로. 직접 정정한 품목(min_stock_manual)은 선을 두고 자동값만. 그 밖은 사용량 셈을 제안값으로. 자체 생산(원액 · 완제품)은 두지 않는다 (0172 · 0175)';
