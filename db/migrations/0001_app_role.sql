-- =============================================================================
-- 0001_app_role.sql  -  응용 접속 역할
-- 근거: CLAUDE.md §5 (S03 revoke delete ... from app_role)
-- 범위: M0
-- =============================================================================
--
-- 응용 서버는 반드시 app_role 권한으로 접속한다. 소유자(마이그레이션 실행 계정)로
-- 접속하면 S03의 REVOKE DELETE가 무력화된다. 소유자 우회는 0002의 삭제 차단
-- 트리거가 별도로 막지만, 접속 계정 분리가 1차 방어선이다.
--
-- app_role은 NOLOGIN 그룹 역할이다. 실제 접속 계정에 GRANT app_role 한다.
--   create role dhr_app login password '...';
--   grant app_role to dhr_app;
--
-- 응용이 접속하는 계정이 마이그레이션 계정과 다르면 그 계정에도 위 GRANT가
-- 필요하다. set local role app_role 이 lib/db.ts 의 모든 질의 앞에 붙으므로,
-- 없으면 첫 질의부터 42501로 막힌다.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_role') then
    create role app_role nologin;
  end if;

  -- 마이그레이션을 돌리는 계정이 app_role로 set role 할 수 있어야 한다.
  --
  -- PostgreSQL 16부터 CREATEROLE 계정이 역할을 만들면 ADMIN 옵션만 자동으로
  -- 붙고 SET 옵션은 붙지 않는다. 슈퍼유저는 검사를 통과하므로 로컬 시험에서는
  -- 드러나지 않고, Supabase처럼 postgres가 슈퍼유저가 아닌 환경에서만
  -- "permission denied to set role" 로 터진다. 명시적으로 멤버십을 준다.
  execute format('grant app_role to %I', current_user);
end $$;

grant usage on schema public to app_role;
