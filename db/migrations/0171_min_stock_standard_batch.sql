/* ===========================================================================
   0171 · 최소 재고선 4배치 - 표준 배치 20장 · 포장재는 가장 작은 형명 · 원액 원료까지 (사용자 2026-11-26)

   «포장재는 제일 작은 사이즈를 20장입해서 배치를 돌렸을 때 몇 장이 소모되는지를 기준으로 최소 재고선을
   잡아주면 됩니다. 그리고 얘네(염화칼륨 · 제이인산나트륨 · 제일인산칼륨 · 이산화탄소)는 왜 계산에 빠져 있죠?»

   0169 에서 빠진 것과 까닭
     · 포장재(개당 기준) - 개당 소요량 x 배치당 예상 수량(expected_units)으로 셌는데, 운영의 예상 수량이
       비어 있어 셈이 서지 않았다.
     · 원액 원료(염화칼륨 등) - 구성표에는 원액 20X PBS 가 들고, 원료는 그 원액을 만들 때 든다. 구성표만
       보았으니 원료가 보이지 않았다.
     · 이산화탄소 - 어느 구성표에도 없다. 셀 근거가 없으니 이번에도 제안값만 둔다 (지어내지 않는다).

   이제
     · 기준 판: 발효(ACTIVE)된 판 전부를 보고 품목마다 큰 쪽. 작성 중(DRAFT) 판은 보지 않는다 - 구성표를
       고치면 판이 작성 중으로 돌아가므로(서면 대조를 다시), 다시 발효한 뒤 «최소 재고선 다시 셈» 으로 잡힌다.
     · 표준 배치 = 20장 (사용자 «20장입»). 장입 구간 기준은 20장이 드는 구간의 지시 수량.
     · 개당 기준(포장재 등) = 개당 소요량 x 20장 x 가장 작은 형명의 장당 개수(model_per_sheet 가 가장 큰 형명).
       장당 개수를 모르면 배치당 예상 수량으로.
     · 원액 원료 = 그 원액의 한 배치 소요량 x (지난 원액 제조에서 원액 한 단위에 든 원료의 양).
     · 최소 재고선 = 한 배치 소요 x 4. 근거 문장을 남기고 개수 단위는 올린다. 값이 같으면 고치지 않는다.
=========================================================================== */

create or replace function suggest_min_stock(p_days int default 90)
returns int language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  c_sheets constant int := 20;   -- 표준 배치 장입 (사용자 2026-11-26 «20장입»)
  n int := 0; r record; v_min numeric; v_basis text;
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
    select i.id, i.usage_uom, p.product_code, p.revision, p.per_batch, p.per_unit, p.through,
           p.small_code, p.per_sheet
      from pick p join item i on i.id = p.item_id
     where i.is_active
  loop
    /* 개수로 세는 단위는 올린다 */
    v_min := case when r.usage_uom in ('EA', '개', '장', '매', '통', '병', 'BOX', 'box', '박스', 'roll', 'ROLL', '롤')
                  then ceil(r.per_batch * 4) else round(r.per_batch * 4, 3) end;
    v_basis := format('한 배치 소요 %s %s (%s %s · %s장%s%s) x 4 배치',
                      trim(trailing '.' from trim(trailing '0' from round(r.per_batch, 3)::text)),
                      r.usage_uom, r.product_code, r.revision, c_sheets,
                      case when r.per_unit and r.small_code is not null
                           then format(' · 가장 작은 형명 %s 장당 %s개', r.small_code, r.per_sheet) else '' end,
                      case when r.through is not null
                           then format(' · 원액 %s 을 거쳐 · 지난 제조 비율', r.through) else '' end);
    update item
       set min_stock = v_min, min_stock_auto = v_min, min_stock_basis = v_basis
     where id = r.id
       and (min_stock is distinct from v_min or min_stock_auto is distinct from v_min
            or min_stock_basis is distinct from v_basis);
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
     where i.is_active and i.type <> 'FIN'
       and (i.min_stock_basis is null or i.min_stock_basis not like '%x 4 배치')
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
  '최소 재고선: 표준 배치 20장 소요 x 4 (포장재는 가장 작은 형명, 원액 원료는 지난 제조 비율)를 min_stock 으로. 그 밖은 사용량 셈을 제안값으로 (0171)';

select suggest_min_stock(90);
