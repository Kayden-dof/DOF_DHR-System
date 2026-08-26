-- =============================================================================
-- 0003_users.sql  —  사용자 · 역할
-- 근거: CLAUDE.md §4.1
-- 범위: M0
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'role_code') then
    create type role_code as enum ('WORKER','PROD_MGR','QP','SYS_ADMIN');
  end if;
end $$;

create table if not exists app_user (
  id           uuid primary key default gen_random_uuid(),
  login_code   text not null unique,          -- 숫자 문자열. 패드 로그인
  pin_hash     text,                          -- 숫자 비밀번호 해시. QP는 null
  full_name    text not null,
  is_active    boolean not null default true,
  is_developer boolean not null default false,
  can_login    boolean not null default true  -- QP는 false. 인쇄물에 이름만
);

create table if not exists user_role (
  user_id uuid not null references app_user(id),
  role    role_code not null,
  primary key (user_id, role)
);


-- -----------------------------------------------------------------------------
-- 개발 계정 QP 금지 (§1-4, §10)
--
-- 사양의 trg_no_dev_qp()는 user_role 쪽만 막는다. 역방향 —— QP를 이미 가진
-- 계정을 나중에 is_developer=true로 바꾸는 경로 —— 는 열려 있어서 같은 금지
-- 상태에 도달할 수 있다. app_user 쪽에도 같은 불변식을 건다. 개발 계정으로
-- 전환하려면 QP 역할을 먼저 회수해야 한다. 완화가 아니라 조임이다.
-- -----------------------------------------------------------------------------
create or replace function trg_no_dev_qp()
returns trigger language plpgsql as $fn$
begin
  if new.role = 'QP'
     and (select is_developer from app_user where id = new.user_id) then
    raise exception '개발 계정에는 품질책임자 역할을 부여할 수 없습니다';
  end if;
  return new;
end $fn$;

drop trigger if exists user_role_no_dev on user_role;
create trigger user_role_no_dev before insert or update
  on user_role for each row execute function trg_no_dev_qp();

create or replace function trg_no_qp_dev()
returns trigger language plpgsql as $fn$
begin
  if new.is_developer
     and exists (select 1 from user_role
                  where user_id = new.id and role = 'QP') then
    raise exception '품질책임자 역할을 가진 계정은 개발 계정으로 전환할 수 없습니다';
  end if;
  return new;
end $fn$;

drop trigger if exists app_user_no_qp_dev on app_user;
create trigger app_user_no_qp_dev before insert or update
  on app_user for each row execute function trg_no_qp_dev();


-- -----------------------------------------------------------------------------
-- 역할 조회 (§4.1)
-- -----------------------------------------------------------------------------
create or replace function has_role(r role_code) returns boolean
language sql stable as $fn$
  select exists (select 1 from user_role
                  where user_id = current_user_id() and role = r)
$fn$;


-- -----------------------------------------------------------------------------
-- 감사추적 (§5 S03)
--
-- user_role은 id 컬럼이 없다. 식별자로 user_id를 쓴다. 어느 역할이 붙고
-- 떨어졌는지는 new_value/old_value의 role 값으로 남는다.
--
-- 이 두 표는 §5의 REVOKE DELETE 목록에 없다. 즉 삭제가 허용되므로 DELETE도
-- 감사 대상에 넣는다. 넣지 않으면 "누가 언제 어떤 권한을 가졌는가"의 회수
-- 시점이 통째로 사라진다.
-- -----------------------------------------------------------------------------
drop trigger if exists app_user_audit on app_user;
create trigger app_user_audit after insert or update or delete
  on app_user for each row execute function trg_audit();

drop trigger if exists user_role_audit on user_role;
create trigger user_role_audit after insert or update or delete
  on user_role for each row execute function trg_audit('user_id');


-- -----------------------------------------------------------------------------
-- TRUNCATE 차단 (§5 S03)
--
-- 이 두 표는 DELETE를 막지 않는다 —— 역할 회수는 정상 작업이고, 그 이력은 위
-- 감사 트리거가 남긴다. 그런데 TRUNCATE는 행 트리거를 타지 않으므로 감사기록
-- 없이 표를 통째로 비울 수 있다. 삭제를 금지하는 것이 아니라 감사되는 경로로
-- 몰기 위해 막는다.
-- -----------------------------------------------------------------------------
drop trigger if exists app_user_no_truncate on app_user;
create trigger app_user_no_truncate before truncate on app_user
  for each statement execute function trg_block_delete();

drop trigger if exists user_role_no_truncate on user_role;
create trigger user_role_no_truncate before truncate on user_role
  for each statement execute function trg_block_delete();
