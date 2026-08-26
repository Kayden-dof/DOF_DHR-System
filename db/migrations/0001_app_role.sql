-- =============================================================================
-- 0001_app_role.sql  —  응용 접속 역할
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

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_role') then
    create role app_role nologin;
  end if;
end $$;

grant usage on schema public to app_role;
