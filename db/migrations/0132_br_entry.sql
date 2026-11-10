/* ===========================================================================
   0132 · 제조기록서 칸을 현장에서 적는다 (사용자 2026-11-10)

   "지금 제조기록서 상에 체크와 적어야 하는 부분들은 모두 생산자가 체크 하거나
   기록 할수 있도록 작업기록지에 기능 구현해줄것"

   제조기록서(F706) 양식 모양(mfg_doc.form · 0130)의 칸 가운데 사람이 고르거나
   적는 칸(□ 확인 · 결과 값 · 시작 ~ 종료 · 특이사항 …)을 현장 화면에서 적는다.
   적은 값은 그 공정 기록에 칸 자리(field: p쪽 t표 r줄 c열)로 붙고, 제조기록서
   인쇄가 그 칸에 파란 글씨로 찍는다.

   판정하지 않는다 (§1) - 허용범위 안인지 묻지 않고 적힌 것을 옮길 뿐이다.

   ── 잠금 ──────────────────────────────────────────────────────────────
   공정 기록과 같은 잠금을 받는다 (S04). 일차를 마감(인쇄)하면 그 묶음의 칸은
   더 바뀌지 않는다. 지우지 않는다 - 칸을 비우는 것은 빈 값으로 고치는 것이고
   이전 값은 감사추적에 남는다.

   ── 누가 ──────────────────────────────────────────────────────────────
   그 공정 기록의 작업자 · 순환자, 그리고 생산관리자 · 시스템관리자. 적은 사람과
   시각은 DB 가 정한다 (화면이 보낸 값을 믿지 않는다).
=========================================================================== */

create table if not exists br_entry (
  id                uuid primary key default gen_random_uuid(),
  process_record_id uuid not null references process_record(id),
  doc_id            uuid not null references mfg_doc(id),
  field             text not null check (field ~ '^p\d+t\d+r\d+c\d+$'),
  value             text not null default '',
  entered_by        uuid not null references app_user(id),
  entered_at        timestamptz not null default now(),
  unique (process_record_id, doc_id, field)
);

comment on table br_entry is
  '현장에서 적은 제조기록서 칸. 양식(mfg_doc.form)의 칸 자리마다 한 줄이다. 공정 기록의 잠금(S04)을 받는다 (0132)';

create index if not exists br_entry_pr_idx on br_entry (process_record_id);

drop trigger if exists br_entry_audit on br_entry;
create trigger br_entry_audit after insert or update or delete
  on br_entry for each row execute function trg_audit('id');

drop trigger if exists br_entry_no_delete on br_entry;
create trigger br_entry_no_delete before delete
  on br_entry for each row execute function trg_block_delete();

drop trigger if exists br_entry_no_truncate on br_entry;
create trigger br_entry_no_truncate before truncate
  on br_entry for each statement execute function trg_block_delete();

/* S04: 그 공정 기록의 일차가 잠겼으면 적지 못한다 */
drop trigger if exists br_entry_s04 on br_entry;
create trigger br_entry_s04 before insert or update
  on br_entry for each row execute function trg_s04_locked();

/* 누가 · 언제는 DB 가 정한다. 그 기록의 작업자 · 순환자 · 생산관리자 · 시스템관리자만 */
create or replace function trg_br_entry_who()
returns trigger language plpgsql as $fn$
declare v_actor uuid := current_user_id(); r record;
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  select worker_id, rotation_worker_id into r from process_record where id = new.process_record_id;
  if v_actor is distinct from r.worker_id and v_actor is distinct from r.rotation_worker_id
     and not exists (select 1 from user_role
                      where user_id = v_actor and role in ('PROD_MGR', 'SYS_ADMIN')) then
    raise exception '다른 사람의 공정 기록에는 적을 수 없습니다';
  end if;
  if tg_op = 'UPDATE' and (new.process_record_id <> old.process_record_id
                           or new.doc_id <> old.doc_id or new.field <> old.field) then
    raise exception '적은 칸의 자리는 바꿀 수 없습니다';
  end if;
  new.entered_by := v_actor;
  new.entered_at := now();
  return new;
end $fn$;

drop trigger if exists br_entry_who on br_entry;
create trigger br_entry_who before insert or update
  on br_entry for each row execute function trg_br_entry_who();

grant select, insert, update on br_entry to app_role;
revoke delete, truncate on br_entry from app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke all on br_entry from app_readonly';
    execute 'grant select on br_entry to app_readonly';
  end if;
end $$;


/* === 시연 자료 비우기가 새 표를 안다 (0128 의 정의에 한 줄) =============== */
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
  delete from process_record;
  delete from product_lot;
  delete from work_order_plan;
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
