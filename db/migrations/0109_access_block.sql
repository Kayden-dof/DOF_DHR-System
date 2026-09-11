-- =============================================================================
-- 0109_access_block.sql · 문을 두드린 자리
--
-- 사용자 지시 2026-09-11 - "지정 위치 외에서 로그인 시도가 들어오면 개발계정
-- 에게는 알림이 가야함. 누가 어디서 시도했는지."
--
-- ── 먼저 사실 하나 ───────────────────────────────────────────────────────────
-- 접속지 제한이 켜져 있으면 **로그인 시도 자체가 일어나지 않는다.** 벽에서
-- 막히므로 사번도 비밀번호도 오지 않는다. 그래서 여기 남는 것은 "로그인 실패"
-- 가 아니라 **막힌 접속** 이다.
--
-- "누가" 는 두 가지로만 알 수 있다.
--   · 세션 쿠키를 들고 왔다 - 우리가 서명한 쿠키이므로 그 사람이다. 제조소
--     패드를 들고 밖으로 나간 경우가 여기 잡힌다. 이것이 실제로 위험한 쪽이다.
--   · 쿠키가 없다 - 자격 없이 문만 두드린 것이다. 누구인지 알 수 없고, 그것이
--     사실이다. 지어내지 않는다 (§1).
--
-- ── 기록이 아니다 ───────────────────────────────────────────────────────────
-- login_attempt 와 같은 성격이다 (0022). GMP 기록이 아니라 **감시 자료** 이므로
-- S03(삭제 금지)을 걸지 않고 오래된 것은 쓸어 낸다. 감사추적 트리거도 걸지
-- 않는다 - 이 표가 바뀐 이력까지 남길 이유가 없다.
--
-- ── 한 자리는 하루에 한 줄 ──────────────────────────────────────────────────
-- 인터넷에 열린 주소는 훑고 다니는 기계가 늘 두드린다. 요청마다 한 줄씩 쌓으면
-- 화면이 그 소음에 묻히고, DB 쓰기가 바깥 요청 수만큼 일어난다.
-- (날짜 · 접속지 · 계정 · 막힌 까닭) 을 키로 묶어 세기만 한다.
--
-- 날짜는 한국 날짜다. UTC 로 끊으면 오전 9시 이전 것이 전날로 간다 (§10).
-- =============================================================================

create table if not exists access_block (
  id        bigserial primary key,
  day       date        not null,          -- 한국 날짜. 묶는 키
  ip        text,                          -- 읽지 못했으면 null
  country   text,
  region    text,
  city      text,
  user_id   uuid references app_user(id),  -- 세션 쿠키를 들고 왔을 때만
  reason    text        not null,          -- COUNTRY · REGION · CITY · ADDRESS
  path      text,                          -- 마지막으로 두드린 자리
  -- 몇 번 두드렸는지는 **세지 못한다.** 문 앞이 같은 자리를 1분에 한 번만
  -- 적기 때문이다 (proxy.ts). 그 걸름이 없으면 바깥에서 두드리는 만큼 DB 쓰기가
  -- 일어난다. 그래서 이 값은 "적힌 횟수" 이고 화면은 이것을 횟수라 부르지
  -- 않는다 - 3번을 1이라 적어 두고 횟수라 하면 그것이 거짓말이다 (§8.5).
  -- 얼마나 끈질겼는지는 first_at ~ last_at 의 폭이 말한다.
  hits      int         not null default 1,
  first_at  timestamptz not null default now(),
  last_at   timestamptz not null default now()
);

create unique index if not exists access_block_key
  on access_block (day, coalesce(ip, ''), reason,
                   coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists access_block_recent_idx
  on access_block (last_at desc);

/* ---------------------------------------------------------------------------
   한 번 두드린 것을 센다

   판정하지 않는다 (§1). 무엇이 침입인지 묻지 않고, 문이 닫혀 있어 안 열렸다는
   사실과 그때 값을 적을 뿐이다.
--------------------------------------------------------------------------- */
create or replace function access_block_note(
  p_ip text, p_country text, p_region text, p_city text,
  p_user uuid, p_reason text, p_path text)
returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp as $$
  insert into access_block (day, ip, country, region, city, user_id, reason, path)
  values ((timezone('Asia/Seoul', now()))::date,
          nullif(p_ip, ''), nullif(p_country, ''), nullif(p_region, ''),
          nullif(p_city, ''), p_user, p_reason, nullif(p_path, ''))
  on conflict (day, coalesce(ip, ''), reason,
               coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set hits    = access_block.hits + 1,
                last_at = now(),
                path    = coalesce(excluded.path, access_block.path),
                /* 자리 이름은 나중에 읽힌 값이 더 정확할 수 있다 */
                country = coalesce(excluded.country, access_block.country),
                region  = coalesce(excluded.region,  access_block.region),
                city    = coalesce(excluded.city,    access_block.city);
$$;

/* 최근 며칠 치를 화면에 낸다. 계정을 들고 두드린 것이 먼저 온다.

   먼저 떨어뜨린다 - `create or replace` 는 돌려주는 칸이 바뀌면 거부한다.
   읽기만 하는 함수라 떨어뜨려도 잃을 것이 없고, 권한은 아래에서 다시 준다.
   이관은 몇 번을 돌려도 같은 자리에 서야 한다. */
drop function if exists access_block_recent(int);

create or replace function access_block_recent(p_days int default 14)
returns table (
  day date, ip text, country text, region text, city text,
  who text, reason text, path text, hits int,
  first_at timestamptz, last_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp as $$
  select b.day, b.ip, b.country, b.region, b.city,
         u.full_name as who, b.reason, b.path, b.hits, b.first_at, b.last_at
    from access_block b
    left join app_user u on u.id = b.user_id
   where b.day >= (timezone('Asia/Seoul', now()))::date - p_days
   order by (b.user_id is not null) desc, b.last_at desc
   limit 100
$$;

/* 오래된 것은 쌓아 둘 이유가 없다. 기록이 아니라 감시 자료다 */
create or replace function access_block_sweep(p_days int default 90)
returns int
language sql
security definer
set search_path = pg_catalog, public, pg_temp as $$
  with gone as (
    delete from access_block
     where day < (timezone('Asia/Seoul', now()))::date - p_days
     returning 1)
  select count(*)::int from gone
$$;

grant execute on function access_block_note(text, text, text, text, uuid, text, text)
  to app_role;
grant execute on function access_block_recent(int)  to app_role;
grant execute on function access_block_sweep(int)   to app_role;

-- 표 자체에는 권한을 주지 않는다. 위 함수로만 만진다 (0022 와 같다).
revoke all on access_block from app_role;
