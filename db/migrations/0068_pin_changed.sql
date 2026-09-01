/* ---------------------------------------------------------------------------
   비밀번호를 바꾸면 그 계정의 살아 있는 세션이 끊긴다 (적대적 검증 2026-09-01)

   ── 무엇이 열려 있었는가 ──────────────────────────────────────────────────
   실제로 세션을 쥐고 하나씩 눌러 보았다.

     비밀번호를 바꾼 뒤        아직 들어간다      ← 이것
     로그인을 막은 뒤          막힘
     계정을 비활성으로 바꾼 뒤   막힘
     역할을 전부 거둔 뒤        막힘

   어깨너머로 여섯 자리를 본 사람이 있다고 하자. 대응은 "비밀번호를 바꾸세요"
   인데, 그렇게 해도 그 사람의 세션은 **최대 여덟 시간 그대로 살아 있다.**
   정말 끊으려면 can_login 을 내려야 하는데 그러면 본인도 못 들어온다.

   ── 왜 이 시스템에서 특히 무거운가 ────────────────────────────────────────
   전자서명을 받지 않으므로 (§1) 기록의 귀속은 **오직 로그인에 달려 있다.**
   남의 이름으로 적힌 기록은 지울 수도 고칠 수도 없다 (S03 · §2.1). 사후
   복구가 없는 자리라 사전에 끊는 길이 있어야 한다.

   ── 어떻게 끊는가 ─────────────────────────────────────────────────────────
   세션 표를 만들지 않는다. 쿠키는 서명된 값이고 서버가 기억하지 않는 것이
   이 시스템의 짜임이다. 대신 **비밀번호가 바뀐 시각**을 남기고, 그보다 먼저
   발급된 세션을 거부한다. 표 하나 없이 같은 일을 한다.

   해시가 실제로 바뀔 때만 찍는다. 같은 값을 다시 써 넣는 것은 바꾼 것이
   아니므로 남의 세션을 끊지 않는다.
--------------------------------------------------------------------------- */

alter table app_user add column if not exists pin_changed_at timestamptz;

comment on column app_user.pin_changed_at is
  '비밀번호를 마지막으로 바꾼 시각. 이보다 먼저 발급된 세션은 거부한다 (lib/session.ts)';

create or replace function trg_pin_changed()
returns trigger language plpgsql as $fn$
begin
  if new.pin_hash is distinct from old.pin_hash then
    new.pin_changed_at := now();
  end if;
  return new;
end $fn$;

drop trigger if exists app_user_pin_changed on app_user;
create trigger app_user_pin_changed before update of pin_hash
  on app_user for each row execute function trg_pin_changed();

/*
 * 이미 있는 계정에는 지금 시각을 찍지 않는다. 찍으면 지금 일하고 있는 사람이
 * 전부 튕겨 나간다. null 이면 "언제 바꿨는지 모른다" 이고, 그때는 세션을
 * 거부하지 않는다 (lib/session.ts). 다음에 비밀번호를 바꾸는 순간부터 걸린다.
 */
