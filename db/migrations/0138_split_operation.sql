/* ---------------------------------------------------------------------------
   0138 · 형명이 갈리는 공정을 따로 적는다 (사용자 2026-11-20)

   지금까지 갈림은 "제품 로트 단위 공정 바로 앞 공정" 으로 셈했다 (0036 ·
   0101). DX2401 은 재단(07)에서 형명별로 갈리고 그 뒤 포장부터 기록이 제품
   로트에 붙어서, 갈림과 기록 단위가 바뀌는 자리가 같았다.

   DX2402 는 다르다. 01 원료 준비 및 절단에서 형명별로 잘라 한 병에 한 형명씩
   담고, 그 병째로 02~07 을 거친다. 그런데 제조기록서는 01~10 이 모두 배치
   한 장이고 형명은 장 안의 줄(형명별 수량 · 병 번호)로 적는다. 갈림은 01
   인데 기록 단위는 그 뒤에도 배치다. 옛 셈으로는 공정도가 07 에서 갈린다고
   그렸다.

   그래서 갈림을 공정에 따로 표시한다.
     · 표시한 공정이 있으면 그 공정이 갈림이다. 현장이 거기서 형명별 수량을
       적고 제품 로트가 생긴다 (cut_product_lot_field 는 cut_operation_id 를 본다)
     · 표시가 없으면 전처럼 셈한다 - DX2401 은 손대지 않아도 그대로다
     · 갈림 공정 자체는 배치 단위다. 자르는 일은 아직 배치 하나로 일어난다
     · 판마다 하나
--------------------------------------------------------------------------- */

alter table dmr_operation
  add column if not exists splits_models boolean not null default false;

comment on column dmr_operation.splits_models is
  '형명이 갈리는 공정. 현장이 여기서 형명별 수량을 적고 제품 로트가 생긴다. 판마다 하나 (0138)';

create unique index if not exists dmr_operation_one_split
  on dmr_operation (device_master_id) where splits_models;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'dmr_operation_split_is_batch') then
    alter table dmr_operation add constraint dmr_operation_split_is_batch
      check (not (splits_models and after_cutting));
  end if;
end $$;


/* === 갈림 공정 찾기 ========================================================
   표시가 먼저다. 없으면 0036 의 셈 그대로 - 제품 로트 단위 공정이 하나라도
   있을 때, 그 이전 공정 가운데 마지막.
-------------------------------------------------------------------------- */
create or replace function cut_operation_id(p_dm uuid)
returns uuid language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select coalesce(
    (select o.id from dmr_operation o
      where o.device_master_id = p_dm and o.splits_models
      limit 1),
    (select o.id
       from dmr_operation o
      where o.device_master_id = p_dm
        and not o.after_cutting
        and exists (select 1 from dmr_operation a
                     where a.device_master_id = p_dm and a.after_cutting)
      order by o.seq desc
      limit 1))
$fn$;

comment on function cut_operation_id(uuid) is
  '형명이 갈리는 공정. 표시한 공정이 먼저, 없으면 제품 로트 단위 공정 바로 앞 (0138)';

grant execute on function cut_operation_id(uuid) to app_role;

create or replace function split_op_name(p_dm uuid)
returns text language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select o.name from dmr_operation o where o.id = cut_operation_id(p_dm)
$fn$;

comment on function split_op_name(uuid) is
  '분기 공정의 이름. 표시한 갈림 공정이 먼저, 없으면 재단 이전 공정 중 마지막. 분기가 없으면 null (0138)';

grant execute on function split_op_name(uuid) to app_role, app_readonly;


/* === 서면 대조가 짚는 항목에 갈림도 넣는다 (0134) ========================== */
drop trigger if exists dmr_operation_unverify_upd on dmr_operation;
create trigger dmr_operation_unverify_upd after update on dmr_operation
  for each row
  when (old.seq is distinct from new.seq or old.code is distinct from new.code
        or old.name is distinct from new.name
        or old.after_cutting is distinct from new.after_cutting
        or old.splits_models is distinct from new.splits_models)
  execute function trg_dmr_unverify_part();


/* === 개정 복사도 갈림 표시를 옮긴다 (0137 정의에 한 칸) ==================== */
create or replace function copy_dmr_structure(p_src uuid, p_dst uuid)
returns int language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare n int := 0; r record; new_op uuid; b record; new_bom uuid;
begin
  if p_src = p_dst then
    raise exception '같은 제품표준서로는 복사할 수 없습니다';
  end if;
  if not exists (select 1 from device_master where id = p_src) then
    raise exception '가져올 제품표준서를 찾을 수 없습니다';
  end if;
  if not exists (select 1 from device_master where id = p_dst) then
    raise exception '옮겨 넣을 제품표준서를 찾을 수 없습니다';
  end if;
  if exists (select 1 from dmr_operation where device_master_id = p_dst) then
    raise exception '받을 제품표준서에 이미 공정이 있습니다. 비어 있는 표준서에만 복사할 수 있습니다';
  end if;

  for r in
    select * from dmr_operation where device_master_id = p_src order by seq
  loop
    insert into dmr_operation
      (device_master_id, seq, code, name, after_cutting, typical_day, takes_rework,
       splits_models)
    values
      (p_dst, r.seq, r.code, r.name, r.after_cutting, r.typical_day, r.takes_rework,
       r.splits_models)
    returning id into new_op;
    n := n + 1;

    for b in select * from dmr_bom where operation_id = r.id loop
      insert into dmr_bom (operation_id, component_item_id, basis, qty_per_unit)
      values (new_op, b.component_item_id, b.basis, b.qty_per_unit)
      returning id into new_bom;

      insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty, qty_max)
      select new_bom, t.min_sheets, t.max_sheets, t.qty, t.qty_max
        from dmr_bom_tier t where t.dmr_bom_id = b.id;
    end loop;

    /* 걸린 설비도 함께 온다. 살아 있는 연결만 */
    insert into operation_equipment (operation_id, equipment_id, is_active)
    select new_op, oe.equipment_id, true
      from operation_equipment oe
     where oe.operation_id = r.id and oe.is_active;
  end loop;

  /* 공정 시간표 한 벌 (0137). 받는 쪽에 이미 있으면 두지 않는다 */
  insert into dmr_timeline (device_master_id, steps, basis, updated_by)
  select p_dst, t.steps, t.basis,
         coalesce(nullif(current_setting('app.user_id', true), '')::uuid, t.updated_by)
    from dmr_timeline t
   where t.device_master_id = p_src
  on conflict (device_master_id) do nothing;

  return n;
end $$;

grant execute on function copy_dmr_structure(uuid, uuid) to app_role;


/* === 이 판의 형명 =========================================================
   갈림 공정에서 고를 형명은 그 제품의 것이어야 한다. 지금까지는 완제품 품목을
   모두 내놓았다 - 제품이 하나일 때는 그래도 됐지만, DX2402 형명(PC…)을 올리면
   DX2401 배치의 재단 칸에 늑연골 형명이 섞인다.

   제품과 형명은 형명 체계의 접두어로 이어진다 (0075 · 설정 > 제품 세우기와
   같은 셈). 대표 형명이 어느 체계에 들면 그 체계의 형명만, 어느 체계에도 들지
   않으면 어느 체계에도 들지 않는 완제품만 낸다. 접두어가 빈 체계는 모든 형명에
   맞으므로 이 셈에서 뺀다.
-------------------------------------------------------------------------- */
create or replace function dm_models(p_dm uuid)
returns table (id uuid, code text, name text)
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  with rep as (
    select (select ms.prefix from model_scheme ms
             where ms.is_active and ms.prefix <> ''
               and left(i.code, length(ms.prefix)) = ms.prefix
             order by length(ms.prefix) desc limit 1) as prefix
      from device_master dm join item i on i.id = dm.item_id
     where dm.id = p_dm)
  select i.id, i.code, i.name
    from item i cross join rep
   where i.type = 'FIN' and i.is_active
     and case
           when rep.prefix is not null
             then left(i.code, length(rep.prefix)) = rep.prefix
           else not exists (select 1 from model_scheme ms
                             where ms.is_active and ms.prefix <> ''
                               and left(i.code, length(ms.prefix)) = ms.prefix)
         end
   order by i.code
$fn$;

comment on function dm_models(uuid) is
  '제품표준서의 형명. 대표 형명과 같은 형명 체계의 완제품, 체계가 없으면 체계 밖 완제품 (0138)';

grant execute on function dm_models(uuid) to app_role, app_readonly;
