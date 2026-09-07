-- ---------------------------------------------------------------------------
-- 비밀번호 초기화를 시스템관리자도 한다 (사용자 결정 2026-09-07)
--
-- 0018 은 남의 비밀번호 초기화를 **개발 계정만** 할 수 있게 두었다. 까닭은
-- 지금도 맞다 - "남의 비밀번호를 바꾸는 것은 그 사람 이름으로 기록을 남길 수
-- 있게 되는 일이고, 기록은 지울 수 없으므로 사후 복구가 안 된다."
--
-- 그런데 **그 권한을 누가 갖느냐**가 문제이지 개발자여야 할 이유는 아니었다.
-- 운영은 시스템관리자 계정이 맡는다. 지금 상태로는 현장에서 비밀번호를 잊을
-- 때마다 개발자를 불러야 하고, 그것이 §2.0 이 막으려는 바로 그 상태다 -
-- "프로그램을 한 번 올려 두면 그 뒤로는 개발 없이 화면에서 운영에 들어갈 수
-- 있어야 한다."
--
-- ── 무엇이 그대로인가 ────────────────────────────────────────────────────
-- 넓히는 것은 **한 자리뿐**이다. 나머지 문턱은 그대로 선다.
--
--   · 자기 비밀번호는 여전히 누구나 바꾼다
--   · 그 밖의 아무나는 여전히 남의 것을 못 바꾼다 (작업자 · 경영열람)
--   · 남의 것을 초기화하면 must_change_pin 이 서서, 그 사람이 처음 들어올 때
--     스스로 다시 바꾼다. 초기화한 사람이 값을 아는 동안이 짧다
--   · 바꾼 사실은 감사추적에 남고 값은 (감춤) 으로 덮인다 (0060)
--   · 개발 계정은 여전히 품질책임자 역할을 받지 못한다 (§1 · trg_no_dev_qp)
--
-- 개발 계정 길은 남겨 둔다. 시스템관리자가 하나도 없거나 그 계정이 잠긴
-- 자리에서 시작할 길이 있어야 한다.
--
-- S01~S05 와 §2.1 불변식이 아니다. 그쪽은 GMP 공정 판정이고 이쪽은 계정
-- 관리다 (0018 이 적어 둔 그대로).
--
-- ── 이름을 바꾼다 ────────────────────────────────────────────────────────
-- `trg_pin_reset_dev_only` 는 이제 참이 아닌 이름이다. 새 이름으로 세우고 옛
-- 것을 내린다. 이름이 하는 일과 어긋나면 다음 사람이 코드를 안 읽고 이름만
-- 보고 판단한다.
-- ---------------------------------------------------------------------------

create or replace function trg_pin_reset_admin()
returns trigger language plpgsql as $fn$
declare actor uuid;
begin
  -- 비밀번호가 바뀌지 않았으면 볼 일이 없다
  if new.pin_hash is not distinct from old.pin_hash then
    return new;
  end if;

  actor := current_user_id();

  -- 행위자를 심지 않은 경로(마이그레이션·초기 구축)는 그대로 통과시킨다.
  -- 그 경로는 애초에 소유자 권한이라 트리거로 막는 것이 의미가 없다.
  if actor is null then
    return new;
  end if;

  -- 자기 비밀번호는 누구나 바꾼다
  if actor = new.id then
    return new;
  end if;

  /*
   * 남의 것은 시스템관리자나 개발 계정만 (0098). 둘 다 아니면 막는다.
   *
   * 역할을 user_role 에서 바로 읽는다. has_role() 을 쓰지 않는 것은 그것이
   * current_user_id() 를 다시 부르기 때문이다 - 여기서는 위에서 잡아 둔
   * actor 로 묻는 편이 읽기 쉽고 한 곳만 본다.
   */
  if not exists (select 1 from app_user u where u.id = actor and u.is_developer)
     and not exists (select 1 from user_role r
                      where r.user_id = actor and r.role = 'SYS_ADMIN') then
    raise exception '다른 사람의 비밀번호는 시스템관리자나 개발 계정만 초기화할 수 있습니다';
  end if;

  return new;
end $fn$;

drop trigger if exists app_user_pin_reset on app_user;
create trigger app_user_pin_reset before update on app_user
  for each row execute function trg_pin_reset_admin();

/* 옛 이름은 트리거에서 떼어 낸 뒤에 내린다 */
drop function if exists trg_pin_reset_dev_only();

comment on function trg_pin_reset_admin() is
  '남의 비밀번호 초기화는 시스템관리자나 개발 계정만. 자기 것은 누구나';
