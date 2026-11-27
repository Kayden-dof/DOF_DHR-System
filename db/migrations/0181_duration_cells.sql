/* ===========================================================================
   0181 · 걸린 시간을 숫자로 적는 칸도 시간으로 센다 (사용자 2026-11-27)

   «아 여기도 처리시간 30분에 진탕기 쓰는데...»

   0179 는 «시작 ~ 종료» 칸만 셌다. 제조기록서에는 걸린 시간을 숫자로 적는 칸도 있다 - H2O2 처리의
   «처리 시간 · 30 ~ 35 분» 줄은 결과 칸에 «30» 만 적는다. 그 칸 양식 글은 비어 있고 단위는 같은 줄
   기준 칸(«30 ~ 35 분»)에서 빌려 온다 (lib/br-form rowUnit 과 같은 잣대).

     br_cell_unit(form, field)   그 칸의 단위가 분이면 'min', 시간이면 'h', 아니면 null
                                 칸 양식 글이 단위 하나뿐이거나 비어 있을 때, 같은 줄 앞쪽 칸의 마지막 글이
                                 «분 · 시간 · min · h · hr» 로 끝나면(«이상 · 이내 · 이하 · 미만» 붙어도) 그 단위
     br_duration_hours(v, unit)  «30» + 'min' → 0.5 시간
     v_br_time                   시작 ~ 종료 칸에 걸린 시간 칸을 더한다. 열 이름 · 순서는 0179 그대로이고 kind 를 끝에 붙인다

   이 칸도 시각 칸처럼 쓴 설비를 고른다 (br_time_equipment · 기록서 화면).
=========================================================================== */

create or replace function br_cell_unit(p_form jsonb, p_field text) returns text
language plpgsql immutable
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  k     int[];
  cells jsonb;
  own   text;
  ref   text;
  u     text;
begin
  k := (regexp_match(coalesce(p_field, ''), '^p(\d+)t(\d+)r(\d+)c(\d+)$'))::int[];
  if k is null then return null; end if;
  cells := p_form -> 'pages' -> k[1] -> 'tables' -> k[2] -> 'rows' -> k[3] -> 'cells';
  if cells is null or jsonb_typeof(cells) <> 'array' then return null; end if;

  select btrim(coalesce(x ->> 't', '')) into own
    from jsonb_array_elements(cells) x where (x ->> 'c')::int = k[4] limit 1;
  /* 칸 자체에 글이 있으면 단위 하나뿐일 때만 (그 밖의 글이 있는 칸은 걸린 시간 칸이 아니다) */
  if own <> '' then
    u := substring(own from '^(분|시간|min|hr|h)$');
    if u is null then return null; end if;
  else
    select btrim(x ->> 't') into ref
      from jsonb_array_elements(cells) x
     where (x ->> 'c')::int < k[4] and btrim(coalesce(x ->> 't', '')) <> ''
     order by (x ->> 'c')::int desc limit 1;
    u := substring(coalesce(ref, '') from '(분|시간|min|hr|h)\s*(?:이상|이내|이하|미만)?\s*$');
  end if;
  return case when u in ('분', 'min') then 'min' when u in ('시간', 'h', 'hr') then 'h' else null end;
exception when others then
  return null;
end $fn$;

comment on function br_cell_unit(jsonb, text) is
  '제조기록서 칸의 시간 단위 (0181). 분 = min, 시간 = h, 아니면 null. 칸 글이 비면 같은 줄 기준 칸에서 빌린다';

create or replace function br_duration_hours(p_value text, p_unit text) returns numeric
language sql immutable
set search_path = pg_catalog, public, pg_temp as $fn$
  select case
    when p_unit is null or coalesce(p_value, '') !~ '^\s*\d+(\.\d+)?\s*$' then null
    when p_unit = 'min' then round(btrim(p_value)::numeric / 60.0, 4)
    else round(btrim(p_value)::numeric, 4)
  end
$fn$;

comment on function br_duration_hours(text, text) is '걸린 시간 칸 값을 시간으로 (0181). 숫자가 아니면 null';


create or replace view v_br_time as
with x as (
  select be.process_record_id, be.doc_id, be.field, be.value,
         pr.work_order_id, pr.product_lot_id, pr.work_date,
         br_time_hours(be.value, pr.work_date) as range_h,
         case when br_time_hours(be.value, pr.work_date) is null
              then br_duration_hours(be.value, br_cell_unit(d.form, be.field)) end as dur_h
    from br_entry be
    join process_record pr on pr.id = be.process_record_id
    join mfg_doc d on d.id = be.doc_id
)
select x.process_record_id, x.doc_id, x.field, x.value,
       x.work_order_id, x.product_lot_id, x.work_date,
       coalesce(x.range_h, x.dur_h)           as hours,
       (te.id is not null)                    as equip_set,
       coalesce(te.equipment_ids, '{}')       as equipment_ids,
       case when x.range_h is not null then 'range' else 'duration' end as kind
  from x
  left join br_time_equipment te
         on te.process_record_id = x.process_record_id and te.doc_id = x.doc_id and te.field = x.field
 where coalesce(x.range_h, x.dur_h) is not null;

comment on view v_br_time is
  '제조기록서 시간 칸마다 시간과 고른 설비 (0179 · 0181). kind: range = 시작 ~ 종료 칸, duration = 걸린 시간 숫자 칸';

grant select on v_br_time to app_role, app_readonly;
