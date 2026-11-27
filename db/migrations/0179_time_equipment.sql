/* ===========================================================================
   0179 · 시각 줄마다 쓴 설비 · 시간은 제조기록서 칸으로 (사용자 2026-11-27)

   «시간은 제조기록서 기준으로 셈해주세요. 기록의 시작 시간 기준은 사용하지 않습니다.»
   «오프라인 서류를 전산화 하는게 기본 … 기록할때의 시간을 기준으로 작업하진 않을 예정»
   «시간을 기입할때 … 해당 공정에 사용되는 장비 리스트를 같이 띄우고 안썼으면 안쓰고, 썼으면 장비를
    같이 클릭해서 전산상에는 기록을 쌓는거지»

   전에는 원가의 시간을 공정 기록의 시작 · 종료(started_at · ended_at)로 셌다. 그것은 종이를 옮겨 적은
   때라 실제 작업 시각이 아니다 (운영 실례: H2O2 처리 작업일 11-05 인데 시작이 11-20 → -359 시간).
   이제 제조기록서의 «시작 ~ 종료» 칸(br_entry)에 적힌 시각으로 센다.

   한 공정에 설비가 여럿이고(DX2401 은 공정마다 2~3대) 시각 줄마다 쓰는 설비가 다르다. 그래서 시각을
   적을 때 그 줄에 쓴 설비를 함께 고른다. 고른 것은 종이에 찍지 않는다 - 전산에만 쌓는다.

     br_time_equipment   시각 칸 하나 (공정 기록 · 양식 · 칸 자리) 에 쓴 설비들. 빈 묶음 = 설비 안 씀
                         줄이 없으면 아직 고르지 않은 것 - 원가 화면이 그 수를 알린다
     br_time_hours()     칸 값 «09:20~09:40» · «11/07 08:54~11/10 08:05» · «보기|10:27~10:38» 를 시간으로
     v_br_time           시각 칸마다 시간과 고른 설비
     v_equipment_hours   설비 · 달(작업일)마다 가동시간 = 그 설비를 고른 시각 줄의 합
     v_process_cost      공수 시간 = 그 기록 시각 줄의 합, 설비 몫 = 줄마다 고른 설비의 시간당 상각비 x 그 줄 시간
                         (열 이름 · 순서는 0076 · 0133 그대로. equip_rate 는 기록 시간에 대한 평균 단가로 낸다)

   고른 설비는 마감(인쇄)한 일차에도 붙일 수 있다 - 종이 기록이 아니라 원가 셈에 쓰는 값이다 (S04 를 걸지 않는다).
   지우지 않는다. 고친 이력은 감사추적에 남는다.
=========================================================================== */

create table if not exists br_time_equipment (
  id                uuid primary key default gen_random_uuid(),
  process_record_id uuid not null references process_record(id),
  doc_id            uuid not null references mfg_doc(id),
  field             text not null check (field ~ '^p\d+t\d+r\d+c\d+$'),
  equipment_ids     uuid[] not null default '{}',
  set_by            uuid not null references app_user(id),
  set_at            timestamptz not null default now(),
  unique (process_record_id, doc_id, field)
);

comment on table br_time_equipment is
  '제조기록서 시각 칸마다 쓴 설비 (0179). 빈 묶음은 설비를 쓰지 않음. 종이에 찍지 않는다';

create index if not exists br_time_equipment_doc_field on br_time_equipment (doc_id, field);

create or replace function trg_br_time_equipment_rules()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
begin
  if exists (select 1 from unnest(new.equipment_ids) x
              where not exists (select 1 from equipment e where e.id = x)) then
    raise exception '설비 대장에 없는 설비가 있습니다';
  end if;
  new.set_by := coalesce(current_user_id(), new.set_by);
  new.set_at := now();
  return new;
end $fn$;

drop trigger if exists br_time_equipment_rules on br_time_equipment;
create trigger br_time_equipment_rules before insert or update on br_time_equipment
  for each row execute function trg_br_time_equipment_rules();

drop trigger if exists br_time_equipment_audit on br_time_equipment;
create trigger br_time_equipment_audit after insert or update or delete
  on br_time_equipment for each row execute function trg_audit('id');
drop trigger if exists br_time_equipment_no_delete on br_time_equipment;
create trigger br_time_equipment_no_delete before delete
  on br_time_equipment for each row execute function trg_block_delete();
drop trigger if exists br_time_equipment_no_truncate on br_time_equipment;
create trigger br_time_equipment_no_truncate before truncate
  on br_time_equipment for each statement execute function trg_block_delete();

grant select, insert, update on br_time_equipment to app_role;
revoke delete, truncate on br_time_equipment from app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    revoke all on br_time_equipment from app_readonly;
    grant select on br_time_equipment to app_readonly;
  end if;
end $$;


/* === 칸 값 → 시간 ======================================================== */
/*
 *   «09:20~09:40»                 같은 날. 끝이 앞서면 자정을 넘긴 것
 *   «11/07 08:54~11/10 08:05»     날짜가 붙은 칸 (dt). 해는 작업일의 해, 끝이 앞서면 해를 넘긴 것
 *   «추가 충진 O, …|10:27~10:38»  보기에 딸린 시각 - 마지막 «|» 뒤
 * 모양이 맞지 않으면 null - 셈하지 않는다 (지어내지 않는다).
 */
create or replace function br_time_hours(p_value text, p_day date) returns numeric
language plpgsql immutable
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v text := btrim(regexp_replace(coalesce(p_value, ''), '^.*\|', ''));
  m text[];
  y int := extract(year from coalesce(p_day, date '2000-01-01'))::int;
  s timestamp;
  e timestamp;
begin
  m := regexp_match(v,
    '^(?:(\d{1,2})/(\d{1,2})\s+)?(\d{1,2}):(\d{2})\s*~\s*(?:(\d{1,2})/(\d{1,2})\s+)?(\d{1,2}):(\d{2})$');
  if m is null then return null; end if;
  if m[1] is not null and m[5] is not null then
    s := make_timestamp(y, m[1]::int, m[2]::int, m[3]::int, m[4]::int, 0);
    e := make_timestamp(y, m[5]::int, m[6]::int, m[7]::int, m[8]::int, 0);
    if e < s then e := e + interval '1 year'; end if;
  else
    s := make_timestamp(2000, 1, 1, m[3]::int, m[4]::int, 0);
    e := make_timestamp(2000, 1, 1, m[7]::int, m[8]::int, 0);
    if e < s then e := e + interval '1 day'; end if;
  end if;
  return round(extract(epoch from e - s) / 3600.0, 4);
exception when others then
  return null;
end $fn$;

comment on function br_time_hours(text, date) is
  '제조기록서 시각 칸 값을 시간으로 (0179). 모양이 맞지 않으면 null';


/* === 시각 칸마다 시간 · 고른 설비 ========================================= */
create or replace view v_br_time as
select be.process_record_id, be.doc_id, be.field, be.value,
       pr.work_order_id, pr.product_lot_id, pr.work_date,
       br_time_hours(be.value, pr.work_date) as hours,
       (te.id is not null)                    as equip_set,
       coalesce(te.equipment_ids, '{}')       as equipment_ids
  from br_entry be
  join process_record pr on pr.id = be.process_record_id
  left join br_time_equipment te
         on te.process_record_id = be.process_record_id and te.doc_id = be.doc_id and te.field = be.field
 where br_time_hours(be.value, pr.work_date) is not null;

comment on view v_br_time is '제조기록서 시각 칸마다 시간과 고른 설비 (0179)';


/* === 설비 · 달마다 가동시간 ================================================ */
create or replace view v_equipment_hours as
select x.equipment_id, e.code, date_trunc('month', t.work_date)::date as month,
       round(sum(t.hours), 2) as hours, count(*)::int as rows
  from v_br_time t
  cross join lateral unnest(t.equipment_ids) as x(equipment_id)
  join equipment e on e.id = x.equipment_id
 group by 1, 2, 3;

comment on view v_equipment_hours is '설비 · 달(작업일)마다 가동시간. 그 설비를 고른 시각 줄의 합 (0179)';


/* === 원가: 시간은 제조기록서 칸으로 ========================================= */
create or replace view v_process_cost as
with t as (
  select process_record_id, sum(hours) as hours
    from v_br_time group by 1
),
eq as (
  select b.process_record_id,
         sum(b.hours * equipment_hourly_cost(e.code)) as cost,
         bool_or(equipment_hourly_cost(e.code) is null) as missing
    from v_br_time b
    cross join lateral unnest(b.equipment_ids) as x(equipment_id)
    join equipment e on e.id = x.equipment_id
   group by 1
)
select pr.id as process_record_id,
       pr.work_order_id,
       pr.product_lot_id,
       pr.worker_id,
       pr.equipment_id,
       pr.work_date,
       (t.hours is not null)                                            as timed,
       coalesce(round(t.hours, 4), 0)                                   as hours,
       (select max(labour_rate_at(ur.role, pr.work_date))
          from user_role ur where ur.user_id = pr.worker_id)            as labour_rate,
       case
         when eq.process_record_id is null then 0
         when eq.missing then null
         else round(eq.cost / nullif(t.hours, 0), 4)
       end                                                              as equip_rate
  from process_record pr
  left join t  on t.process_record_id = pr.id
  left join eq on eq.process_record_id = pr.id;

comment on view v_process_cost is
  '기록 한 줄의 작업 시간(제조기록서 시각 칸의 합)과 공수 단가 · 설비 평균 시간당 단가 (0179)';

grant select on v_br_time to app_role, app_readonly;
grant select on v_equipment_hours to app_role, app_readonly;
grant select on v_process_cost to app_role, app_readonly;


/* === 시연 자료 비우기: 시각 줄 설비도 (0179) ================================
 * 본문은 0159 의 정의 그대로이고 br_entry 앞에 br_time_equipment 한 줄만 더했다. 이 표도 지우기를 막으므로
 * 증명이 서 있는 앞쪽에서 지운다. 이관은 처음부터 다시 돌므로 마지막에 도는 이 정의가 남는다.
 */
CREATE OR REPLACE FUNCTION public.purge_demo_data()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_me uuid; v_seeded timestamptz; v_after bigint; v_counts jsonb;
begin
  v_me := current_user_id();
  if v_me is null then
    raise exception '로그인 정보가 없습니다';
  end if;

  if not exists (select 1 from user_role
                  where user_id = v_me and role = 'SYS_ADMIN') then
    raise exception '시스템관리자만 시연 자료를 비울 수 있습니다';
  end if;

  select seeded_at into v_seeded from demo_marker limit 1;
  if v_seeded is null then
    raise exception '시연 자료 표시가 없습니다. 비울 것이 없거나 이미 비웠습니다';
  end if;

  /*
   * 표시를 남긴 뒤에 한 줄이라도 움직였으면 거부한다.
   *
   * audit_log 는 모든 입력과 변경을 남기므로, 그 뒤에 행이 있다는 것은 지어낸
   * 자료와 실제 작업이 섞였다는 뜻이다. 섞인 뒤에는 갈라낼 방법이 없고,
   * 갈라내지 못하면 지워서는 안 된다.
   */
  select count(*) into v_after from audit_log where acted_at > v_seeded;
  if v_after > 0 then
    raise exception
      '시연 자료를 넣은 뒤에 기록이 %건 더 쌓였습니다. 지어낸 자료와 실제 기록을 '
      '갈라낼 수 없으므로 비우지 않습니다', v_after;
  end if;

  if not only_demo_data() then
    raise exception '시연 자료 표시 앞에 다른 기록이 있거나 기준선이 없습니다. '
      '이 DB 는 시연 전용이라고 증명되지 않습니다';
  end if;

  select jsonb_build_object(
      '작업지시', (select count(*) from work_order),
      '제품로트', (select count(*) from product_lot),
      '공정기록', (select count(*) from process_record),
      '자재로트', (select count(*) from material_lot),
      '출고',     (select count(*) from shipment),
      '주문',     (select count(*) from sales_order))
    into v_counts;

  /* 배치에서 갈라져 나온 것부터. 참조가 걸린 순서를 거슬러 올라간다 */
  delete from shipment;
  /* 작업 지시 · 주문 줄을 가리킨다 (0159). 지우기를 막는 표라 증명이 서 있는 앞쪽에서 */
  delete from work_order_so_line;
  /*
   * 주문 장부도 비운다 (0159). 시연 자료는 출고마다 주문을 낸다 (seed-flow) - 남겨 두면 지어낸 거래처와
   * 주문이 첫날부터 남은 수량을 가진 채 서 있다. 줄이 주문서를, 주문서가 거래처를 가리키므로 그 차례로.
   * 지우기를 막는 표라 증명이 서 있는 앞쪽(출고 바로 뒤)에서 지운다.
   */
  delete from sales_order_line;
  delete from sales_order;
  delete from customer;
  delete from steril_batch_lot;
  delete from steril_batch;
  delete from product_nonconformity;
  delete from wip_nonconformity;
  delete from stock_movement;      -- material_issue 를 가리킨다 (0056). 먼저 지운다
  delete from material_issue;
  delete from day_lock;
  /* 인쇄물에 담긴 제품 로트. record_print 를 가리키므로 먼저 지운다 (0105) */
  delete from record_print_lot;
  delete from record_print;
  delete from record_correction;   -- process_record 를 가리킨다 (0128)
  delete from br_time_equipment;   -- process_record 를 가리킨다 (0179)
  delete from br_entry;            -- process_record 를 가리킨다 (0132)
  /* 원액 로트를 가리킨다 (0145). 지우기를 막는 표라 증명이 서 있는 앞쪽에서 지운다 */
  delete from solution_br_entry;
  /* 제품 로트 · 배치를 가리킨다 (0149). 지우기를 막는 표라 앞쪽에서 */
  delete from process_skip;
  delete from process_record;
  delete from product_lot;
  delete from work_order_plan;
  delete from work_request;        -- work_order 를 가리킨다 (0136)
  delete from work_order;

  /*
   * 자재 로트도 지운다. 남겨 두면 잔여 수량이 지어낸 불출만큼 깎인 채로 남아,
   * 실물과 맞지 않는 재고가 첫날부터 서 있게 된다. 실 운영은 실제 성적서 번호로
   * 다시 입고하면서 시작하는 것이 맞다.
   *
   * material_lot 이 purchase_order 를 가리키므로 로트를 먼저 지운다.
   */
  delete from material_lot;
  delete from purchase_order;

  delete from demo_marker;

  /* 지운 사실은 남긴다. 지우는 것과 지웠다는 사실을 지우는 것은 다르다 */
  insert into audit_log (table_name, record_id, action, actor_id, old_value, new_value)
  values ('demo_marker', gen_random_uuid(), 'PURGE', v_me, v_counts,
          jsonb_build_object('purged_at', now(), 'seeded_at', v_seeded));

  return format('시연 자료를 비웠습니다. 작업지시 %s · 제품로트 %s · 공정기록 %s · 자재로트 %s',
                v_counts->>'작업지시', v_counts->>'제품로트',
                v_counts->>'공정기록', v_counts->>'자재로트');
end $function$;
