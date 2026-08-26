-- =============================================================================
-- 0022_login_throttle.sql · 로그인 시도 제한
--
-- 비밀번호가 숫자 6자리라 조합이 10^6 이다. scrypt(N=32768)로 한 번 검증에 수십
-- 밀리초가 걸리지만, 병렬로 돌리면 전수 시도가 몇 시간 범위다. 주소는 인터넷에
-- 열려 있다.
--
-- 남의 계정으로 들어가면 그 사람 이름으로 기록이 남는다. 기록은 지울 수 없어
-- 정정 기록으로만 바로잡을 수 있고, 이미 인쇄된 묶음은 고칠 방법이 없다.
--
-- S01~S05 와 무관하다. 그쪽은 GMP 공정 판정이고 이것은 계정 보안이다.
--
-- 잠금은 사번 단위로만 건다. 접속지(IP)로도 걸면 좋겠지만, 제조소가 하나의
-- 공인 IP를 공유하면 한 사람의 오타로 전원이 잠긴다. 그 위험이 더 크다.
-- =============================================================================

create table if not exists login_attempt (
  login_code   text        not null,
  failed_at    timestamptz not null default now(),
  -- 성공하면 그 시점까지의 실패를 지운다. 지운 사실은 남기지 않는다 -
  -- 이건 기록이 아니라 잠금 계산용 자료다.
  id           bigserial primary key
);

create index if not exists login_attempt_code_idx
  on login_attempt (login_code, failed_at desc);

/* ---------------------------------------------------------------------------
   잠금 판정

   최근 15분 안의 실패를 센다. 5회를 넘으면 마지막 실패로부터 10분 잠근다.
   남은 초를 돌려준다. 0이면 잠기지 않은 것이다.

   비밀번호가 맞았는지와 무관하게 먼저 부른다. 잠긴 상태에서는 검증 자체를
   하지 않아야 시간 차로 계정 존재 여부가 드러나지 않는다.
--------------------------------------------------------------------------- */
create or replace function login_lock_seconds(p_code text)
returns int
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp as $$
  select greatest(0, ceil(extract(epoch from (
           max(failed_at) + interval '10 minutes' - now()))))::int
    from login_attempt
   where login_code = p_code
     and failed_at > now() - interval '15 minutes'
  having count(*) >= 5
$$;

create or replace function login_fail(p_code text)
returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp as $$
  insert into login_attempt (login_code) values (p_code);
$$;

create or replace function login_ok(p_code text)
returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp as $$
  delete from login_attempt where login_code = p_code;
$$;

-- 오래된 실패는 쌓아 둘 이유가 없다. 기록이 아니라 계산용 자료다.
create or replace function login_attempt_sweep()
returns int
language sql
security definer
set search_path = pg_catalog, public, pg_temp as $$
  with gone as (
    delete from login_attempt where failed_at < now() - interval '1 day' returning 1)
  select count(*)::int from gone
$$;

grant execute on function login_lock_seconds(text) to app_role;
grant execute on function login_fail(text)          to app_role;
grant execute on function login_ok(text)            to app_role;
grant execute on function login_attempt_sweep()     to app_role;

-- 표 자체에는 권한을 주지 않는다. 위 함수(security definer)로만 만진다.
revoke all on login_attempt from app_role;
