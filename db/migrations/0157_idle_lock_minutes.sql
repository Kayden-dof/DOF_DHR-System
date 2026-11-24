/* ===========================================================================
   0157 · 자동 잠금 시간을 본인이 고른다 (사용자 2026-11-25)

   "내 계정 설정은 어디있어..? 로그인한 사람만 볼수있는 본인 계정 설정.. 그런곳에 잠금
    설정 시간 이런거 설정할수있는 기능 배치를 좀 하고 싶은데??"

   잠금 시간이 코드에 박혀 있었다 - 관리 화면 30분 · 현장 화면 20분. 계정마다 고르게 한다.

   ── 무엇을 두는가 ─────────────────────────────────────────────────────────
   app_user.idle_lock_desk_min   관리 화면 잠금 시간(분). 비어 있으면 30
   app_user.idle_lock_pad_min    현장 화면 잠금 시간(분). 비어 있으면 20
   고를 수 있는 값은 정해 둔 것뿐이다 (lib/idle-lock.ts LOCK_CHOICES 와 같은 값).

   ── 현장은 30분까지 ────────────────────────────────────────────────────────
   현장 패드는 여러 사람이 번갈아 쓴다. 앞사람이 로그아웃을 잊으면 다음 사람의 기록이
   앞사람 이름으로 남고, 그것은 지울 수 없다 (components/idle-lock.tsx). 그래서 현장은
   기본 20분에서 조금만 늘릴 수 있게 한다. 관리 화면은 한 사람이 제 자리에서 쓰므로
   두 시간까지. 아예 끄는 것은 관리자만이다 (0153).

   ── 누가 바꾸는가 ─────────────────────────────────────────────────────────
   본인만. 0153 의 트리거가 세 칸을 함께 본다. 바꾼 사람 · 앞뒤 값은 app_user 감사
   트리거(0003)가 남긴다.
=========================================================================== */

alter table app_user add column if not exists idle_lock_desk_min int;
alter table app_user add column if not exists idle_lock_pad_min int;

alter table app_user drop constraint if exists app_user_idle_lock_desk_min_check;
alter table app_user add constraint app_user_idle_lock_desk_min_check
  check (idle_lock_desk_min is null or idle_lock_desk_min in (5, 10, 15, 20, 30, 45, 60, 90, 120));

alter table app_user drop constraint if exists app_user_idle_lock_pad_min_check;
alter table app_user add constraint app_user_idle_lock_pad_min_check
  check (idle_lock_pad_min is null or idle_lock_pad_min in (5, 10, 15, 20, 30));

comment on column app_user.idle_lock_desk_min is
  '관리 화면 자동 잠금 시간(분). 비어 있으면 30 (0157)';
comment on column app_user.idle_lock_pad_min is
  '현장 화면 자동 잠금 시간(분). 비어 있으면 20. 여러 사람이 쓰는 패드라 30 까지 (0157)';


/* === 본인만 · 끄는 것은 관리자만 (0153 을 세 칸으로 넓힌다) =================== */
create or replace function trg_idle_lock_off()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
declare actor uuid;
begin
  if new.idle_lock_off      is not distinct from old.idle_lock_off
 and new.idle_lock_desk_min is not distinct from old.idle_lock_desk_min
 and new.idle_lock_pad_min  is not distinct from old.idle_lock_pad_min then
    return new;
  end if;

  actor := current_user_id();

  /* 이관 · 초기 구축. 소유자 권한이라 트리거로 막는 것이 의미가 없다 (0098) */
  if actor is null then
    return new;
  end if;

  if actor <> new.id then
    raise exception '자동 잠금은 본인만 바꿀 수 있습니다';
  end if;

  /*
   * 끄는 그 순간에만 역할을 본다. 역할을 잃은 뒤 남아 있는 값 때문에 잠금 시간을
   * 못 고치는 일이 없게 한다 - 그 값은 판정(idle_lock_off())에서 이미 힘이 없다.
   */
  if new.idle_lock_off and old.idle_lock_off is distinct from true and not exists (
       select 1 from user_role r
        where r.user_id = new.id and r.role in ('SYS_ADMIN', 'PROD_MGR')) then
    raise exception '자동 잠금은 시스템관리자 · 생산관리자만 끌 수 있습니다';
  end if;

  return new;
end $fn$;

drop trigger if exists app_user_idle_lock_off on app_user;
create trigger app_user_idle_lock_off
  before update of idle_lock_off, idle_lock_desk_min, idle_lock_pad_min on app_user
  for each row execute function trg_idle_lock_off();
