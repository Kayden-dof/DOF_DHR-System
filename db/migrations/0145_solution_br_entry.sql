/* ===========================================================================
   0145 · PBS 제조기록서를 원액 로트에 적는다 (사용자 2026-11-20 «원액 제조 때 (권고)»)

   "PBS 제조기록서는 어디에 써야 할까.. 어디서 기입하는게 맞을까??"

   별첨 F706-DX2401-03-01(20X PBS 제조)은 배치의 WS-03 공정 기록에 붙어 있었다 (br_entry ·
   0132). 그런데 20X PBS 한 로트(5 L)를 여러 배치가 0.8 L 씩 쓴다. 배치마다 같은 PBS 를
   다시 적어야 했고 배치끼리 값이 어긋날 수 있었다. 원료 차감 · 원료 로트 · 양 · 만든
   사람 · 제조일은 이미 원액 로트에 있다 (0118 · 0119).

   그래서 PBS 제조기록서는 원액 로트에 한 번 적는다. 칸 자리마다 한 줄이고, br_entry 와
   같은 틀이다 (양식 칸 자리 · 값 · 서명 칸 고침의 사유). 배치의 WS-03 기록서는 «관리번호
   부여» 칸에서 원액 로트를 고르기만 하고, 별첨은 그 로트의 기록을 보여 주고 인쇄에 붙인다.

     · 원액 로트(제조일이 있는 로트)에만 적는다.
     · 누가 · 언제는 DB 가 정한다. 지우지 않는다 - 값을 비우면 시스템 값(원액 제조 기록)으로
       돌아간다. 감사추적에 남는다.
=========================================================================== */

create table if not exists solution_br_entry (
  id              uuid primary key default gen_random_uuid(),
  material_lot_id uuid not null references material_lot(id),
  doc_id          uuid not null references mfg_doc(id),
  field           text not null check (field ~ '^p\d+t\d+r\d+c\d+$'),
  value           text not null default '',
  sign            text check (sign in ('worker', 'date')),
  why             text,
  entered_by      uuid not null references app_user(id),
  entered_at      timestamptz not null default now(),
  unique (material_lot_id, doc_id, field)
);

comment on table solution_br_entry is
  '원액 로트에 적은 제조기록서 칸 (PBS 제조기록서 등). 양식 칸 자리마다 한 줄. 배치의 별첨이 이것을 보여 준다 (0145)';

create index if not exists solution_br_entry_lot_idx on solution_br_entry (material_lot_id);

drop trigger if exists solution_br_entry_audit on solution_br_entry;
create trigger solution_br_entry_audit after insert or update or delete
  on solution_br_entry for each row execute function trg_audit('id');

drop trigger if exists solution_br_entry_no_delete on solution_br_entry;
create trigger solution_br_entry_no_delete before delete
  on solution_br_entry for each row execute function trg_block_delete();

drop trigger if exists solution_br_entry_no_truncate on solution_br_entry;
create trigger solution_br_entry_no_truncate before truncate
  on solution_br_entry for each statement execute function trg_block_delete();

/* 원액 로트에만, 누가 · 언제는 DB 가. 칸의 자리는 바꾸지 못한다 */
create or replace function trg_solution_br_entry_who()
returns trigger language plpgsql as $fn$
declare v_actor uuid := current_user_id();
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if not exists (select 1 from material_lot where id = new.material_lot_id and made_on is not null) then
    raise exception '원액 로트에만 제조기록서를 적을 수 있습니다';
  end if;
  if tg_op = 'UPDATE' and (new.material_lot_id <> old.material_lot_id
                           or new.doc_id <> old.doc_id or new.field <> old.field) then
    raise exception '적은 칸의 자리는 바꿀 수 없습니다';
  end if;
  new.entered_by := v_actor;
  new.entered_at := now();
  return new;
end $fn$;

drop trigger if exists solution_br_entry_who on solution_br_entry;
create trigger solution_br_entry_who before insert or update
  on solution_br_entry for each row execute function trg_solution_br_entry_who();

grant select, insert, update on solution_br_entry to app_role;
revoke delete, truncate on solution_br_entry from app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke all on solution_br_entry from app_readonly';
    execute 'grant select on solution_br_entry to app_readonly';
  end if;
end $$;


/* === 시연 자료 비우기가 새 표를 안다 (0136 의 정의에 한 줄) =============== */
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
