/* ===========================================================================
   0149 · 제품 로트의 재단 이후 공정 건너뛰기 (사용자 2026-11-20)

   "멸균 선량 샘플같은건 멸균을 따로 안하니까 멸균 제조기록은 스킵 가능하도록 기능 부여해줘."

   재단 이후 공정은 제품 로트마다 기록한다. 멸균 선량 샘플로 만든 로트는 멸균 공정을 거치지
   않으니 멸균 제조기록이 없다 - 그 로트의 그 공정을 «건너뜀» 으로 적는다.

     process_skip  배치 · 공정 · 제품 로트 · 사유 · 누가 · 언제. 지우지 않는다. 잘못 적었으면
                   취소(누가 · 언제 · 사유)한다. 살아 있는 건너뛰기는 (공정, 로트) 하나.
     skip_operation(배치, 공정, 로트, 사유)   재단 이후 공정 · 그 배치의 로트 · 아직 기록 없음
     unskip_operation(건너뛰기, 사유)        취소
   건너뛴 (공정, 로트)에는 공정 기록을 새로 시작하지 않는다 - 취소한 뒤에 기록한다.

   작업자 · 생산관리자 · 시스템관리자가 적는다 (공정을 기록하는 사람). 제품 로트 상태(멸균 중 ·
   멸균 회수)는 멸균 위탁 발송 · 회수가 바꾸므로 여기서 건드리지 않는다.
=========================================================================== */

create table if not exists process_skip (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references work_order(id),
  operation_id   uuid not null references dmr_operation(id),
  product_lot_id uuid not null references product_lot(id),
  reason         text not null check (btrim(reason) <> ''),
  skipped_by     uuid not null references app_user(id),
  skipped_at     timestamptz not null default now(),
  cancelled_by   uuid references app_user(id),
  cancelled_at   timestamptz,
  cancel_reason  text,
  check ((cancelled_at is null) = (cancelled_by is null)),
  check (cancelled_at is null or btrim(coalesce(cancel_reason, '')) <> '')
);
create unique index if not exists process_skip_live_uk
  on process_skip (operation_id, product_lot_id) where cancelled_at is null;
create index if not exists process_skip_wo_idx on process_skip (work_order_id);

comment on table process_skip is
  '제품 로트의 재단 이후 공정 건너뛰기 (멸균 선량 샘플의 멸균 등). 지우지 않고 취소한다 (0149)';

drop trigger if exists process_skip_audit on process_skip;
create trigger process_skip_audit after insert or update or delete
  on process_skip for each row execute function trg_audit('id');

drop trigger if exists process_skip_no_delete on process_skip;
create trigger process_skip_no_delete before delete
  on process_skip for each row execute function trg_block_delete();

drop trigger if exists process_skip_no_truncate on process_skip;
create trigger process_skip_no_truncate before truncate
  on process_skip for each statement execute function trg_block_delete();

/* 적기 · 취소는 아래 함수로만 */
grant select on process_skip to app_role;
revoke insert, update, delete, truncate on process_skip from app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke all on process_skip from app_readonly';
    execute 'grant select on process_skip to app_readonly';
  end if;
end $$;


/* === 건너뛰기 ============================================================ */
create or replace function skip_operation(p_wo uuid, p_op uuid, p_lot uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  v_why   text := btrim(coalesce(p_reason, ''));
  v_id    uuid;
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if not exists (select 1 from user_role
                  where user_id = v_actor and role in ('WORKER', 'PROD_MGR', 'SYS_ADMIN')) then
    raise exception '공정을 기록하는 사람(작업자 · 생산관리자)만 건너뜁니다';
  end if;
  if v_why = '' then
    raise exception '왜 건너뛰는지 적으십시오';
  end if;
  if not exists (select 1 from dmr_operation o join work_order w on w.device_master_id = o.device_master_id
                  where o.id = p_op and w.id = p_wo and o.after_cutting) then
    raise exception '이 배치의 재단 이후 공정이 아닙니다. 건너뛸 수 있는 것은 제품 로트별 공정입니다';
  end if;
  if not exists (select 1 from product_lot where id = p_lot and work_order_id = p_wo) then
    raise exception '이 배치의 제품 로트가 아닙니다';
  end if;
  if exists (select 1 from process_record
              where work_order_id = p_wo and operation_id = p_op and product_lot_id = p_lot) then
    raise exception '이 로트는 이 공정을 이미 기록했습니다. 건너뛸 수 없습니다';
  end if;
  if exists (select 1 from process_skip
              where operation_id = p_op and product_lot_id = p_lot and cancelled_at is null) then
    raise exception '이미 건너뛴 로트입니다';
  end if;

  perform set_config('app.change_reason', '공정 건너뜀 · ' || v_why, true);
  insert into process_skip (work_order_id, operation_id, product_lot_id, reason, skipped_by)
  values (p_wo, p_op, p_lot, v_why, v_actor)
  returning id into v_id;
  return v_id;
end $fn$;


/* === 취소 ================================================================ */
create or replace function unskip_operation(p_skip uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  v_why   text := btrim(coalesce(p_reason, ''));
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if not exists (select 1 from user_role
                  where user_id = v_actor and role in ('WORKER', 'PROD_MGR', 'SYS_ADMIN')) then
    raise exception '공정을 기록하는 사람(작업자 · 생산관리자)만 취소합니다';
  end if;
  if v_why = '' then
    raise exception '왜 취소하는지 적으십시오';
  end if;
  perform set_config('app.change_reason', '공정 건너뜀 취소 · ' || v_why, true);
  update process_skip
     set cancelled_by = v_actor, cancelled_at = now(), cancel_reason = v_why
   where id = p_skip and cancelled_at is null;
  if not found then
    raise exception '취소할 건너뛰기가 없습니다';
  end if;
end $fn$;

revoke all on function skip_operation(uuid, uuid, uuid, text) from public;
revoke all on function unskip_operation(uuid, text) from public;
grant execute on function skip_operation(uuid, uuid, uuid, text) to app_role;
grant execute on function unskip_operation(uuid, text) to app_role;


/* === 건너뛴 로트에는 공정 기록을 시작하지 않는다 ========================= */
create or replace function trg_process_record_not_skipped()
returns trigger language plpgsql as $fn$
begin
  if new.product_lot_id is not null and exists (
       select 1 from process_skip
        where operation_id = new.operation_id and product_lot_id = new.product_lot_id
          and cancelled_at is null) then
    raise exception '이 로트는 이 공정을 건너뛰었습니다. 건너뛰기를 취소한 뒤 기록하십시오';
  end if;
  return new;
end $fn$;

drop trigger if exists process_record_not_skipped on process_record;
create trigger process_record_not_skipped before insert on process_record
  for each row execute function trg_process_record_not_skipped();


/* === 시연 자료 비우기: 새 표를 제품 로트 · 배치보다 먼저 ================= */
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
      '출고',     (select count(*) from shipment))
    into v_counts;

  /* 배치에서 갈라져 나온 것부터. 참조가 걸린 순서를 거슬러 올라간다 */
  delete from shipment;
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
