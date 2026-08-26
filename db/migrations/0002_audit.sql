-- =============================================================================
-- 0002_audit.sql  -  감사추적 · 삭제 차단 (S03)
-- 근거: CLAUDE.md §4.9 (audit_log), §5 S03, §4.1 (current_user_id)
-- 범위: M0
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 세션 사용자 (§4.1)
-- trg_audit()가 참조하므로 §4.1보다 먼저 정의한다.
-- has_role()은 user_role 표에 의존하므로 0003에 둔다.
-- -----------------------------------------------------------------------------
create or replace function current_user_id() returns uuid
language sql stable as $fn$
  select nullif(current_setting('app.user_id', true), '')::uuid
$fn$;


-- -----------------------------------------------------------------------------
-- 감사추적 (§4.9)
-- -----------------------------------------------------------------------------
create table if not exists audit_log (
  id         bigserial primary key,
  table_name text not null,
  record_id  uuid not null,
  action     text not null,
  actor_id   uuid,
  acted_at   timestamptz not null default now(),
  old_value  jsonb,
  new_value  jsonb
);
create index if not exists audit_log_table_name_record_id_idx
  on audit_log (table_name, record_id);


-- -----------------------------------------------------------------------------
-- 감사 트리거 (§5 S03)
--
-- [사양과의 차이 1 - 식별자 컬럼]
--   §5의 trg_audit()은 record_id를 to_jsonb(new)->>'id'로 고정한다. 그런데
--   user_role은 기본키가 (user_id, role)이라 'id' 컬럼이 없다. 그대로 쓰면
--   record_id가 null이 되어 NOT NULL 위반으로 user_role INSERT 자체가 막힌다.
--   트리거 인자로 식별자 컬럼명을 받도록 확장했다. 인자를 주지 않으면 'id'가
--   기본값이므로 M1 이후 표는 사양 그대로 붙이면 된다.
--
--     create trigger x_audit after insert or update on x
--       for each row execute function trg_audit();              -- id 사용
--     create trigger y_audit after insert or update or delete on y
--       for each row execute function trg_audit('user_id');     -- 지정
--
-- [사양과의 차이 2 - DELETE 대응]
--   §5는 after insert or update만 상정한다. 삭제가 차단된 표에서는 그것으로
--   충분하지만, app_user/user_role은 §5의 REVOKE DELETE 목록에 없다. 즉 역할
--   회수는 정상 경로다. DELETE에도 붙일 수 있도록 old_value/new_value를
--   연산별로 채운다. INSERT/UPDATE 동작은 사양과 동일하다.
--
-- [사양과의 차이 3 - search_path]
--   security definer 함수에 search_path를 고정한다. 고정하지 않으면 호출자가
--   search_path를 조작해 audit_log나 참조 함수를 가로챌 수 있다.
-- -----------------------------------------------------------------------------
create or replace function trg_audit()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  key_col text := coalesce(tg_argv[0], 'id');
  j       jsonb;
  rid     uuid;
begin
  j := coalesce(to_jsonb(new), to_jsonb(old));

  if not (j ? key_col) then
    raise exception '감사추적: %.% 컬럼이 없습니다 (트리거 인자를 확인하십시오)',
      tg_table_name, key_col;
  end if;

  rid := (j ->> key_col)::uuid;
  if rid is null then
    raise exception '감사추적: %.%가 null입니다', tg_table_name, key_col;
  end if;

  insert into audit_log (table_name, record_id, action, actor_id, old_value, new_value)
  values (tg_table_name,
          rid,
          tg_op,
          current_user_id(),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $fn$;


-- -----------------------------------------------------------------------------
-- 삭제 차단 (§5 S03, §1 "삭제 자체가 없다")
--
-- REVOKE DELETE는 app_role만 막는다. 표 소유자와 슈퍼유저는 권한 검사를
-- 우회하므로 트리거로 한 번 더 막는다. §2의 S03 구현란이 "REVOKE DELETE +
-- TRIGGER"인 이유다.
--
-- TRUNCATE는 DELETE와 별개 권한이고 행 트리거도 타지 않는다. 문장 트리거로
-- 따로 막는다. 막지 않으면 DELETE를 전부 봉해도 표를 통째로 비울 수 있다.
--
-- 어느 표에 거는가는 §5의 REVOKE DELETE 목록을 따른다. app_user·user_role은
-- 그 목록에 없다. 역할 회수는 정상 작업이므로 차단하지 않고 감사만 남긴다.
--
-- 해제 함수·예외 플래그는 만들지 않는다 (§10).
-- -----------------------------------------------------------------------------
create or replace function trg_block_delete()
returns trigger language plpgsql as $fn$
begin
  raise exception 'S03: 기록은 삭제할 수 없습니다 (%, %)', tg_table_name, tg_op;
end $fn$;

drop trigger if exists audit_log_no_delete on audit_log;
create trigger audit_log_no_delete before delete on audit_log
  for each row execute function trg_block_delete();

drop trigger if exists audit_log_no_truncate on audit_log;
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function trg_block_delete();

-- 고쳐 쓸 수 있는 감사기록은 감사기록이 아니다. 사양에 명시는 없으나
-- §1 "기록은 삭제되지 않는다"의 취지를 audit_log 자신에게도 적용한다.
create or replace function trg_block_update()
returns trigger language plpgsql as $fn$
begin
  raise exception 'S03: 감사기록은 수정할 수 없습니다 (%)', tg_table_name;
end $fn$;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update before update on audit_log
  for each row execute function trg_block_update();
