-- =============================================================================
-- 0006_supabase_hardening.sql  -  Supabase 배포 시 API 노출 차단
-- 근거: CLAUDE.md §5 (S03 권한 회수), §1 (검증 부담을 늘리지 않는다)
-- 범위: M0. Supabase가 아닌 DB에서는 아무 일도 하지 않는다.
-- =============================================================================
--
-- Supabase는 public 스키마의 표·함수에 anon / authenticated / service_role
-- 권한을 기본 부여한다(ALTER DEFAULT PRIVILEGES). 그대로 두면 PostgREST가
-- app_user · audit_log · numbering_rule을 HTTP로 노출한다. 공개 키 하나로
-- 계정 목록과 감사추적이 읽히고, 그 접근은 audit_log에도 남지 않는다.
--
-- 이 시스템은 PostgREST를 쓰지 않는다. 응용은 서버에서 app_role로 직접
-- 접속한다(lib/db.ts). 그러므로 API 역할의 권한을 전부 회수한다.
--
-- RLS를 켜지 않는 이유: 정책 없이 RLS만 켜면 app_role의 정상 질의까지 막힌다.
-- 권한 자체를 주지 않는 편이 확실하고, 검증 대상도 늘지 않는다.
--
-- 되돌리려면 (권장하지 않음):
--   grant select on all tables in schema public to anon, authenticated;
--
-- Supabase 어드바이저가 "RLS disabled in public"을 경고할 수 있다. 위 회수로
-- API 경로가 닫혀 있으므로 해당 경고는 이 배포에 적용되지 않는다.

do $$
declare
  r text;
  api_roles text[] := array['anon', 'authenticated', 'service_role'];
  present text[] := '{}';
begin
  foreach r in array api_roles loop
    if exists (select 1 from pg_roles where rolname = r) then
      present := present || r;
    end if;
  end loop;

  if cardinality(present) = 0 then
    -- Supabase가 아니다. 로컬·시험 DB에서는 여기서 끝난다.
    return;
  end if;

  foreach r in array present loop
    execute format('revoke all on all tables    in schema public from %I', r);
    execute format('revoke all on all sequences in schema public from %I', r);
    execute format('revoke all on all functions in schema public from %I', r);
    execute format('revoke all on all routines  in schema public from %I', r);

    -- M1 이후에 새로 만들 표에도 자동으로 붙지 않게 기본 권한을 내린다.
    execute format(
      'alter default privileges in schema public revoke all on tables from %I', r);
    execute format(
      'alter default privileges in schema public revoke all on sequences from %I', r);
    execute format(
      'alter default privileges in schema public revoke all on functions from %I', r);

    raise notice 'API 역할 % 의 public 스키마 권한을 회수했습니다', r;
  end loop;
end $$;
