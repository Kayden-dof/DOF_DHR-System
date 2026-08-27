-- =============================================================================
-- 0020_print_pages.sql · 인쇄 매수
--
-- 편철 표지가 존재하는 이유는 매수 대조다. 표지에 적힌 장수와 실제 종이를 세어
-- 맞춰 보는 것이 묶음에서 한 장이 빠진 것을 알아채는 유일한 방법이다.
--
-- 그런데 record_print 는 인쇄 "횟수"만 세고 있었다. 제조기록서가 생산 규격
-- 기록지까지 두 장이 된 뒤로는 횟수와 장수가 어긋난다. 매수를 따로 남긴다.
--
-- 기존 행은 1로 둔다. 그때는 한 장짜리였으므로 값이 맞다.
-- =============================================================================

alter table record_print
  add column if not exists pages int not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'record_print_pages_check'
       and conrelid = 'record_print'::regclass
  ) then
    alter table record_print
      add constraint record_print_pages_check check (pages > 0);
  end if;
end $$;

-- 인쇄 기록 함수에 매수를 받는 인자를 더한다.
--
-- create or replace 는 인자 수가 다르면 교체가 아니라 중복 정의를 만든다.
-- 새 인자에 기본값이 있으므로 옛 시그니처로 부르면 어느 쪽인지 정할 수 없어
-- "is not unique" 로 터진다. 옛 것을 먼저 지운다.
drop function if exists print_day_record(uuid, int, uuid, text);
drop function if exists record_print_log(print_kind, text, uuid, uuid, int, uuid, uuid);
-- 0027 의 9인자 판이 이미 있는 DB 에 재적용될 때 두 판이 남으면 8인자 호출이
-- 낡은 쪽에 붙는다. 지우고 시작한다. 최종 모양은 0027 이 정한다.
drop function if exists record_print_log(print_kind, text, uuid, uuid, int, uuid, uuid, int, uuid);

create or replace function record_print_log(
  p_kind          print_kind,
  p_data_hash     text,
  p_work_order    uuid default null,
  p_product_lot   uuid default null,
  p_day_no        int  default null,
  p_worker        uuid default null,
  p_material_lot  uuid default null,
  p_pages         int  default 1
) returns record_print
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_seq int; v_row record_print; v_actor uuid := current_user_id();
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from record_print
   where kind = p_kind
     and work_order_id is not distinct from p_work_order
     and product_lot_id is not distinct from p_product_lot
     and day_no is not distinct from p_day_no
     and worker_id is not distinct from p_worker
     and material_lot_id is not distinct from p_material_lot;

  insert into record_print (kind, work_order_id, product_lot_id, day_no, worker_id,
                            material_lot_id, seq, data_hash, printed_by, pages)
  values (p_kind, p_work_order, p_product_lot, p_day_no, p_worker,
          p_material_lot, v_seq, p_data_hash, v_actor, greatest(coalesce(p_pages, 1), 1))
  returning * into v_row;

  return v_row;
end $fn$;

create or replace function print_day_record(
  p_work_order uuid, p_day_no int, p_worker uuid, p_data_hash text,
  p_pages int default 1
) returns record_print
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_row record_print; v_actor uuid := current_user_id();
begin
  v_row := record_print_log('DAY_RECORD', p_data_hash, p_work_order, null,
                            p_day_no, p_worker, null, p_pages);

  insert into day_lock (work_order_id, day_no, worker_id, locked_by)
  values (p_work_order, p_day_no, p_worker, v_actor)
  on conflict (work_order_id, day_no, worker_id) do nothing;

  return v_row;
end $fn$;

grant execute on function record_print_log(print_kind, text, uuid, uuid, int, uuid, uuid, int)
  to app_role;
grant execute on function print_day_record(uuid, int, uuid, text, int) to app_role;
