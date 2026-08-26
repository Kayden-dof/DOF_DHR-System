-- =============================================================================
-- 0014_m2_print_lock.sql  ·  인쇄 · 잠금(S04) · 공정 마감(S05)
-- 근거: CLAUDE.md §4.9, §5 S04·S05, §7
-- 범위: M2
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'print_kind') then
    create type print_kind as enum
      ('WORK_ORDER','DAY_RECORD','COVER','LABEL','LABEL_REQUEST','RELEASE_REQUEST');
  end if;
end $$;

create table if not exists record_print (
  id              uuid primary key default gen_random_uuid(),
  kind            print_kind not null,
  work_order_id   uuid references work_order(id),
  product_lot_id  uuid references product_lot(id),
  day_no          int,
  worker_id       uuid references app_user(id),
  material_lot_id uuid references material_lot(id),
  seq             int not null,              -- 종류별 인쇄 회차
  data_hash       text not null,
  printed_by      uuid not null references app_user(id),
  printed_at      timestamptz not null default now(),
  retrieved_at    timestamptz,
  retrieve_reason text
);
create index if not exists record_print_kind_idx
  on record_print (kind, work_order_id, day_no, worker_id);
create index if not exists record_print_lot_idx on record_print (product_lot_id);

-- S04. 기록지 묶음 = 잠금 단위. 인쇄 단위와 일치시킨다
create table if not exists day_lock (
  work_order_id uuid not null references work_order(id),
  day_no        int  not null,
  worker_id     uuid not null references app_user(id),
  locked_by     uuid not null references app_user(id),
  locked_at     timestamptz not null default now(),
  primary key (work_order_id, day_no, worker_id)
);


-- -----------------------------------------------------------------------------
-- S04 · 잠금 (§5)
--
--   잠금 키가 (work_order, day_no, worker)인 이유: 기록지 묶음 키와 같아야 한다.
--   같은 날 두 사람이 작업하면 기록지가 두 장 나오고 각자 자기 것만 마감한다.
--
--   잠금 해제 함수를 만들지 않는다 (§10). 누락은 다음 일차에 정정 기록으로
--   추가하고 사유를 남긴다.
-- -----------------------------------------------------------------------------
create or replace function is_locked(p_wo uuid, p_day int, p_worker uuid)
returns boolean language sql stable as $fn$
  select exists (select 1 from day_lock
                  where work_order_id = p_wo and day_no = p_day and worker_id = p_worker)
$fn$;

create or replace function trg_s04_locked()
returns trigger language plpgsql as $fn$
declare wo uuid; d int; w uuid; bn text;
begin
  if tg_table_name = 'process_record' then
    wo := coalesce(new.work_order_id, old.work_order_id);
    d  := coalesce(new.day_no, old.day_no);
    w  := coalesce(new.worker_id, old.worker_id);
  else
    select pr.work_order_id, pr.day_no, pr.worker_id into wo, d, w
      from process_record pr
     where pr.id = coalesce(new.process_record_id, old.process_record_id);
  end if;

  if is_locked(wo, d, w) then
    select batch_no into bn from work_order where id = wo;
    raise exception 'S04: 인쇄 완료된 기록은 수정할 수 없습니다 (배치 %, %일차)',
      coalesce(bn, wo::text), d;
  end if;
  return new;
end $fn$;

drop trigger if exists process_record_s04 on process_record;
create trigger process_record_s04 before insert or update
  on process_record for each row execute function trg_s04_locked();

drop trigger if exists material_issue_s04 on material_issue;
create trigger material_issue_s04 before insert or update
  on material_issue for each row execute function trg_s04_locked();


-- -----------------------------------------------------------------------------
-- S05 · 자재 미기록 시 다음 공정 불가 (§5)
--
--   품목 단위로 판정한다. 로트 개수는 세지 않는다.
--   원재료는 지시서에 이미 지정되어 있으므로 자재 구성표에 넣지 않는다.
--   S05는 시약·공정 자재·포장재에만 적용된다.
-- -----------------------------------------------------------------------------
create or replace function complete_process(p_pr uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_wo uuid; v_op uuid; v_reason text; missing text;
begin
  select work_order_id, operation_id, no_material_reason
    into v_wo, v_op, v_reason
    from process_record where id = p_pr for update;

  if not found then
    raise exception '공정 기록을 찾을 수 없습니다';
  end if;

  if v_reason is null then
    select string_agg(i.name, ', ') into missing
      from dmr_bom b join item i on i.id = b.component_item_id
     where b.operation_id = v_op
       and not exists (
         select 1 from material_issue mi
           join material_lot ml on ml.id = mi.material_lot_id
          where mi.process_record_id = p_pr
            and ml.item_id = b.component_item_id);

    if missing is not null then
      raise exception 'S05: 자재가 기록되지 않았습니다 (%). 기록하거나 해당없음 사유를 입력하세요', missing;
    end if;
  end if;

  update process_record set ended_at = coalesce(ended_at, now()) where id = p_pr;

  update work_order set status = 'IN_PROCESS'
   where id = v_wo and status = 'ISSUED';
end $fn$;


-- -----------------------------------------------------------------------------
-- 인쇄 (§7)
--
-- 인쇄는 부가 기능이 아니라 1급 기능이다. 회차는 종류·대상별로 센다.
-- 같은 자료를 두 번 뽑으면 2회차로 남고, 그것이 재발행의 흔적이 된다.
-- -----------------------------------------------------------------------------
create or replace function record_print_log(
  p_kind          print_kind,
  p_data_hash     text,
  p_work_order    uuid default null,
  p_product_lot   uuid default null,
  p_day_no        int  default null,
  p_worker        uuid default null,
  p_material_lot  uuid default null
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
                            material_lot_id, seq, data_hash, printed_by)
  values (p_kind, p_work_order, p_product_lot, p_day_no, p_worker,
          p_material_lot, v_seq, p_data_hash, v_actor)
  returning * into v_row;

  return v_row;
end $fn$;

-- 제조기록서를 뽑으면 그 묶음이 잠긴다 (S04). 인쇄와 잠금은 한 트랜잭션이다.
-- 이미 잠긴 묶음을 다시 뽑는 것은 막지 않는다. 재발행 회차만 올라간다.
create or replace function print_day_record(
  p_work_order uuid, p_day_no int, p_worker uuid, p_data_hash text
) returns record_print
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_row record_print; v_actor uuid := current_user_id();
begin
  v_row := record_print_log('DAY_RECORD', p_data_hash, p_work_order, null,
                            p_day_no, p_worker, null);

  insert into day_lock (work_order_id, day_no, worker_id, locked_by)
  values (p_work_order, p_day_no, p_worker, v_actor)
  on conflict (work_order_id, day_no, worker_id) do nothing;

  return v_row;
end $fn$;
