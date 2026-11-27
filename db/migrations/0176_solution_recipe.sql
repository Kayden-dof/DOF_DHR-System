/* ===========================================================================
   0176 · 원액 원료의 최소 재고선을 처방으로 센다 (사용자 2026-11-27)

   «1L 단위로 소비량 계산해서 1배치에 3.2L 쓴다고 하고 4배치 작업할 때 필요량을 최소 재고선으로 잡자.»

   20X PBS 원료(염화칼륨 RM-013 · 제이인산나트륨 RM-014 · 제일인산칼륨 RM-015)에 선이 없었다.
     · 셈은 발효(ACTIVE) 판 구성표만 보는데 20X PBS 는 작성 중인 DX2401 Rev.01 구성표에만 있다.
     · 원료 비율을 지난 원액 제조 기록에서 가져왔는데, 하나뿐인 로트 L261105-01 은 제이인산나트륨을
       오기(14.4 g)대로 14.41 g 넣어 만들었다. 처방(144 g)의 10분의 1 이다.

     solution_recipe   원액 1 사용 단위에 드는 원료 양 (처방). 있으면 지난 제조 비율 대신 쓴다.
                       20X PBS 는 제조기록서 F706-DX2401-03-01 허용범위 하한 ÷ 정제수 5 L 로 채운다:
                       염화나트륨 160 · 염화칼륨 4 · 제이인산나트륨 28.8 · 제일인산칼륨 4 (g / L).
     item.batch_use    자체 생산 원액의 한 배치(표준 20장) 사용량. 있으면 그 원액을 구성표에 둔 제품의
                       발효 판마다 이 양으로 센다 (구성표 셈과 겹쳐 세지 않음). 20X PBS = 3.2 L.

   한 번만 채운다 - 배포는 이관을 처음부터 다시 돌리므로, 표 · 칸을 처음 만들 때만 값을 넣는다.
   그 뒤 사람이 고친 값을 다음 배포가 되돌리지 않는다.
=========================================================================== */

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'item' and column_name = 'batch_use') then
    alter table item add column batch_use numeric check (batch_use > 0);
    update item set batch_use = 3.2 where code = 'SL-001' and type = 'SOLUTION';
  end if;

  if to_regclass('public.solution_recipe') is null then
    create table solution_recipe (
      id               uuid primary key default gen_random_uuid(),
      solution_item_id uuid not null references item(id),
      input_item_id    uuid not null references item(id),
      qty_per_unit     numeric not null check (qty_per_unit > 0),
      source           text,
      unique (solution_item_id, input_item_id),
      check (solution_item_id <> input_item_id)
    );
    insert into solution_recipe (solution_item_id, input_item_id, qty_per_unit, source)
    select s.id, i.id, v.q,
           '20X PBS 제조기록서 F706-DX2401-03-01 허용범위 하한 ÷ 정제수 5 L (사용자 2026-11-27)'
      from (values ('RM-007', 160::numeric), ('RM-013', 4), ('RM-014', 28.8), ('RM-015', 4)) v(code, q)
      join item i on i.code = v.code
      join item s on s.code = 'SL-001' and s.type = 'SOLUTION';
  end if;
end $$;

comment on column item.batch_use is
  '자체 생산 원액의 한 배치(표준 20장) 사용량, 사용 단위 (0176). 원료 최소 재고선 셈에 쓴다';
comment on table solution_recipe is
  '원액 1 사용 단위에 드는 원료 양 - 처방 (0176). 원료 최소 재고선 셈이 지난 제조 비율 대신 쓴다';

drop trigger if exists solution_recipe_audit on solution_recipe;
create trigger solution_recipe_audit after insert or update or delete on solution_recipe
  for each row execute function trg_audit('id');
grant select, insert, update, delete on solution_recipe to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke all on solution_recipe from app_readonly';
    execute 'grant select on solution_recipe to app_readonly';
  end if;
end $$;

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
    past as (
      select sl.item_id as solution_item, ml.item_id as input_item, sum(v.qty) / s.made as per_unit
        from v_solution_input v
        join material_lot sl on sl.id = v.solution_lot_id
        join material_lot ml on ml.id = v.material_lot_id
        join sol s on s.solution_item = sl.item_id
       where s.made > 0
       group by sl.item_id, ml.item_id, s.made
    ),
    /*
     * 원액 1 단위(사용 단위)에 드는 원료. 처방표(solution_recipe, 0176)가 있으면 처방, 없으면 지난 제조
     * 기록의 비율. 20X PBS 의 하나뿐인 로트 L261105-01 은 제이인산나트륨을 오기대로 14.41 g 넣어 만들어
     * 지난 비율로는 열 배 작게 셈된다 (사용자 2026-11-27 «1L 단위로 소비량 계산해서»).
     */
    ratio as (
      select sr.solution_item_id as solution_item, sr.input_item_id as input_item, sr.qty_per_unit as per_unit,
             true as recipe
        from solution_recipe sr
      union all
      select p.solution_item, p.input_item, p.per_unit, false
        from past p
       where not exists (select 1 from solution_recipe sr where sr.solution_item_id = p.solution_item)
    ),
    /*
     * 한 배치 사용량을 정해 둔 원액 (item.batch_use, 0176 · 사용자 2026-11-27 «1배치에 3.2L 쓴다고 하고»).
     * 그 원액을 어느 판 구성표에든 둔 제품이면, 그 제품의 발효 판마다 이 사용량을 쓴다 - 20X PBS 는 작성 중인
     * DX2401 Rev.01 구성표에만 있고 시행 중인 Rev.00 서면에는 투입자재로 없지만, 현장은 작업표준서대로 쓴다.
     * 정해 둔 원액은 구성표 셈(direct)으로 다시 세지 않는다.
     */
    fixed_use as (
      select distinct b.id as dm, b.product_code, b.revision, si.id as solution_item, si.batch_use as per_batch
        from item si
        join dmr_bom bom2 on bom2.component_item_id = si.id
        join dmr_operation o2 on o2.id = bom2.operation_id
        join device_master dm2 on dm2.id = o2.device_master_id
        join base b on b.product_code = dm2.product_code
       where si.type = 'SOLUTION' and si.batch_use is not null
    ),
    sol_line as (
      select d.dm, d.product_code, d.revision, d.item_id as solution_item, d.per_batch, null::numeric as fixed
        from direct d join item si on si.id = d.item_id
       where si.type = 'SOLUTION' and si.batch_use is null
      union all
      select f.dm, f.product_code, f.revision, f.solution_item, f.per_batch, f.per_batch from fixed_use f
    ),
    via as (
      select ra.input_item as item_id, s.dm, s.product_code, s.revision,
             sum(s.per_batch * ra.per_unit) as per_batch,
             string_agg(distinct si.code
                        || case when s.fixed is not null
                                then format(' 배치당 %s %s', trim(trailing '.' from trim(trailing '0' from s.fixed::text)), si.usage_uom)
                                else '' end
                        || case when ra.recipe then format(' · 1 %s 당 처방', si.usage_uom) else ' · 지난 제조 비율' end, ' · ') as through
        from sol_line s
        join ratio ra on ra.solution_item = s.solution_item
        join item si on si.id = s.solution_item
       group by ra.input_item, s.dm, s.product_code, s.revision
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
                            then format(' · 원액 %s', r.through) else '' end);
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
  '최소 재고선: 표준 배치 20장 소요 x 4 (포장재는 가장 작은 형명, 원액 원료는 처방 x 원액 사용량)를 min_stock 으로. 직접 정정한 품목은 선을 두고 자동값만. 그 밖은 사용량 셈을 제안값으로. 자체 생산(원액 · 완제품)은 두지 않는다 (0172 · 0175 · 0176)';
