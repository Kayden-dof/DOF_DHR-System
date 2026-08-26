-- =============================================================================
-- 0018_pin_reset.sql · 비밀번호 초기화 권한
--
-- 남의 비밀번호를 바꾸는 것은 그 사람 이름으로 기록을 남길 수 있게 되는 일이다.
-- 기록은 지울 수 없으므로 사후 복구가 안 된다. 그래서 개발 계정만 할 수 있게 한다.
--
-- 자기 비밀번호를 바꾸는 것은 누구나 할 수 있다. 막을 이유가 없다.
--
-- 이 규칙을 DB에 두는 이유는 §4.1의 개발계정 QP 금지(trg_no_dev_qp)와 같다.
-- 계정 표에 걸리는 규칙은 응용에서만 막으면 붙는 화면이 늘 때마다 새는 곳이 생긴다.
-- S01~S05 와는 성격이 다르다. 그쪽은 GMP 공정 판정이고 이쪽은 계정 관리다.
-- =============================================================================

create or replace function trg_pin_reset_dev_only()
returns trigger language plpgsql as $$
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

  if not exists (select 1 from app_user u where u.id = actor and u.is_developer) then
    raise exception '다른 사람의 비밀번호는 개발 계정만 초기화할 수 있습니다';
  end if;

  return new;
end $$;

drop trigger if exists app_user_pin_reset on app_user;
create trigger app_user_pin_reset before update on app_user
  for each row execute function trg_pin_reset_dev_only();
