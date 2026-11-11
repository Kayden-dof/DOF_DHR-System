/* ===========================================================================
   0136 · 작업요청 및 지시서 (F705-01 Rev.02) 의 요청 내용 (사용자 2026-11-11)

   "그리고 작업 지시서 양식도 스캔본에 있었을거 같은데??"

   회사의 작업 지시서는 F705-01(Rev.02) «작업요청 및 지시서» 한 장이다. 요청자가
   1 · 2 (요청정보 · 특이사항)를 먼저 쓰고 서명하면, 생산팀이 작업지시번호를 붙이고
   3 (검토 · 지시사항)을 쓴다. DHR 의 작업 지시서 인쇄가 이 양식으로 나가려면 요청
   내용을 옮겨 적을 자리가 있어야 한다. 종이가 먼저다 - 여기는 옮겨 적는 자리다
   (0127 의 지시서 번호와 같은 원칙).

   작업 지시 하나에 요청 한 벌. 고칠 수 있고 (오기 정정), 고친 사실은 감사추적에
   남는다. 지우지 않는다. 판정하지 않는다 - 요청 수량과 실제 생산을 견주지 않는다.
=========================================================================== */

create table if not exists work_request (
  work_order_id uuid primary key references work_order(id),
  request_dept  text,                                -- 요청부서
  requester     text,                                -- 담당자 (요청자)
  purpose       text check (purpose in ('SALES', 'PLAN', 'RND', 'OTHER')),
  purpose_note  text,                                -- 기타 ( ) 안의 말
  urgent        boolean not null default false,      -- 작업구분: 긴급 생산
  /* 요청 품목 줄. [{ product, model, qty, due, note }] - 양식은 다섯 줄 */
  lines         jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  notes         text,                                -- 2 특이사항 및 요구사항
  complete_by   date,                                -- 3 완료예정일
  instruction   text,                                -- 3 생산팀 검토 & 지시사항
  registered_by uuid not null references app_user(id),
  registered_at timestamptz not null default now()
);

comment on table work_request is
  '작업요청 및 지시서(F705-01) 의 요청 내용. 종이에서 옮겨 적는다. 작업 지시서 인쇄 첫 장에 나간다 (0136)';

drop trigger if exists work_request_audit on work_request;
create trigger work_request_audit after insert or update or delete
  on work_request for each row execute function trg_audit('work_order_id');

drop trigger if exists work_request_no_delete on work_request;
create trigger work_request_no_delete before delete
  on work_request for each row execute function trg_block_delete();

drop trigger if exists work_request_no_truncate on work_request;
create trigger work_request_no_truncate before truncate
  on work_request for each statement execute function trg_block_delete();

/* 옮겨 적은 사람과 시각은 DB 가 정한다 */
create or replace function trg_work_request_who()
returns trigger language plpgsql as $fn$
declare v_actor uuid := current_user_id();
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if tg_op = 'UPDATE' and new.work_order_id <> old.work_order_id then
    raise exception '작업요청이 가리키는 작업 지시는 바꿀 수 없습니다';
  end if;
  new.registered_by := v_actor;
  new.registered_at := now();
  return new;
end $fn$;

drop trigger if exists work_request_who on work_request;
create trigger work_request_who before insert or update
  on work_request for each row execute function trg_work_request_who();

grant select, insert, update on work_request to app_role;
revoke delete, truncate on work_request from app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke all on work_request from app_readonly';
    execute 'grant select on work_request to app_readonly';
  end if;
end $$;


/* === 시연 자료 비우기가 새 표를 안다 (0132 의 정의에 한 줄) =============== */
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
