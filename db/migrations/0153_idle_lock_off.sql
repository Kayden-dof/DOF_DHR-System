/* ===========================================================================
   0153 · 관리자는 자기 계정의 자동 잠금을 끌 수 있다 (사용자 2026-11-20)

   "자동 잠금 기능을 관리자의 경우 개인 설정에서 끌수 있도록 기능 구현해줘"

   자리 비움 잠금(components/idle-lock.tsx · 감사 지적 12)은 현장 패드 20분 ·
   사무 화면 30분이다. 사무 화면은 한 사람이 자기 자리에서 쓰는 일이 많아,
   관리자에게는 그 층을 스스로 내려놓을 길을 연다.

   ── 무엇을 두는가 ─────────────────────────────────────────────────────────
   app_user.idle_lock_off  계정에 묶인 값. 브라우저마다 다르지 않다.
                           app_user 의 감사 트리거(0003)가 바꾼 사람 · 시각 ·
                           앞뒤 값을 그대로 남긴다.

   ── 누가 바꾸는가 ─────────────────────────────────────────────────────────
   본인만. 남의 잠금을 끄는 길은 내지 않는다 - 잠금은 그 자리에 앉은 사람을
   지키는 층이고, 끌지 말지는 그 사람이 정한다.
   끄는 것(true)은 관리 역할(시스템관리자 · 생산관리자, lib/roles.ts ADMIN_ROLES)
   이 있을 때만. 다시 켜는 것(false)은 누구나 언제든.
   행위자를 심지 않은 경로(이관 · 초기 구축)는 0098 과 같이 그대로 통과한다.

   ── 역할을 잃으면 다시 잠긴다 ──────────────────────────────────────────────
   값은 남겨 두되, 판정은 idle_lock_off(계정) 이 역할과 함께 한다. 관리 역할을
   거두면 다음 화면부터 잠금이 다시 걸린다. 값을 따로 지우지 않으므로 역할을
   거두는 쪽(사용자 화면)이 이 일을 알 필요가 없다.
   현장 화면에 작업자로 앉은 세션은 화면 쪽이 한 번 더 가린다 (lib/session.ts
   idleLockOff) - 여러 사람이 번갈아 쓰는 패드에서는 늘 잠근다.
=========================================================================== */

alter table app_user add column if not exists idle_lock_off boolean not null default false;

comment on column app_user.idle_lock_off is
  '본인이 자동 잠금을 껐다. 관리 역할이 있을 때만 효력이 있다 (0153 · idle_lock_off())';


/* === 1. 본인만 · 끄는 것은 관리자만 ======================================== */
create or replace function trg_idle_lock_off()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
declare actor uuid;
begin
  if new.idle_lock_off is not distinct from old.idle_lock_off then
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

  if new.idle_lock_off and not exists (
       select 1 from user_role r
        where r.user_id = new.id and r.role in ('SYS_ADMIN', 'PROD_MGR')) then
    raise exception '자동 잠금은 시스템관리자 · 생산관리자만 끌 수 있습니다';
  end if;

  return new;
end $fn$;

drop trigger if exists app_user_idle_lock_off on app_user;
create trigger app_user_idle_lock_off before update of idle_lock_off on app_user
  for each row execute function trg_idle_lock_off();


/* === 2. 지금 이 계정에 잠금을 걸지 않는가 ================================== */
/*
 * 값과 역할을 함께 본다. 화면(lib/session.ts)은 매 요청 이것을 읽는다 -
 * 역할을 거둔 다음 요청부터 잠금이 다시 걸린다.
 */
create or replace function idle_lock_off(p_user uuid)
returns boolean
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select coalesce((select u.idle_lock_off from app_user u where u.id = p_user), false)
     and exists (select 1 from user_role r
                  where r.user_id = p_user and r.role in ('SYS_ADMIN', 'PROD_MGR'))
$fn$;

revoke all on function idle_lock_off(uuid) from public;
grant execute on function idle_lock_off(uuid) to app_role, app_readonly;

comment on function idle_lock_off(uuid) is
  '자동 잠금을 끈 계정이고 관리 역할이 있는가. 둘 다일 때만 참 (0153)';
