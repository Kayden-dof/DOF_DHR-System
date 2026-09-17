-- ---------------------------------------------------------------------------
-- 메뉴 권한을 관리자가 배정한다 (사용자 요청 2026-09-17)
-- 근거 CLAUDE.md §2.0
--
-- ── 무엇이 바뀌는가 ────────────────────────────────────────────────────
-- 지금은 어느 화면이 열리는지를 코드가 정한다 (lib/access.ts 의 150칸).
-- 제조소마다 조직이 다른데 그것을 코드가 정하면 "다른 제조소가 코드를 고치지
-- 않고 받아 쓸 수 있는가" 가 성립하지 않는다.
--
-- 계정마다 화면 권한을 갖는다. 아무것도 적지 않으면 **그 사람의 역할이 정한
-- 기본값**이 그대로 쓰인다 - 사람을 하나 만들 때마다 서른 칸을 채우게 하지
-- 않는다. 관리자가 손을 댄 칸만 여기 남는다.
--
-- ── 화면이 열리는 것과 일이 되는 것은 다르다 ───────────────────────────
-- 이 표는 **보이는 것**만 정한다. 저장하는 동작은 저마다 제 문을 갖고 있고
-- (각 actions.ts 의 역할 확인), 읽기 전용 세션은 app_readonly 로 돌아 DB 가
-- 쓰기를 거부하며, S01~S05 와 §2.1 불변식은 권한과 무관하게 선다.
--
-- 그래서 화면을 열어 준다고 할 수 있는 일이 늘지 않는다. 늘려도 되는 까닭이
-- 여기 있다 - 늘어나는 것은 눈에 보이는 범위뿐이다.
--
-- ── 되돌리기는 지우는 것이 아니다 ──────────────────────────────────────
-- is_open 을 null 로 두면 역할 기본값으로 돌아간다. 행은 남는다 - 기록은
-- 지우지 않으므로(§10), 누가 언제 열고 닫았는지가 감사추적에 이어진다.
-- ---------------------------------------------------------------------------

create table if not exists user_screen (
  user_id    uuid not null references app_user(id),
  -- 화면 주소. lib/access.ts 의 path 와 같은 값이다
  path       text not null,
  -- true 열림 · false 닫힘 · null 이면 역할 기본값을 따른다
  is_open    boolean,
  note       text,
  set_by     uuid not null references app_user(id),
  set_at     timestamptz not null default now(),
  primary key (user_id, path)
);

create index if not exists user_screen_user on user_screen (user_id);

do $$
begin
  execute 'drop trigger if exists user_screen_audit on user_screen';
  /*
   * 키 열을 인자로 준다. 이 표는 복합 기본키라 id 열이 없고, trg_audit 은
   * 기본으로 id 를 찾는다 (0002 · operation_equipment 가 같은 모양이다).
   */
  execute 'create trigger user_screen_audit after insert or update
             on user_screen for each row execute function trg_audit(''user_id'')';

  execute 'drop trigger if exists user_screen_no_delete on user_screen';
  execute 'create trigger user_screen_no_delete before delete
             on user_screen for each row execute function trg_block_delete()';

  execute 'drop trigger if exists user_screen_no_truncate on user_screen';
  execute 'create trigger user_screen_no_truncate before truncate
             on user_screen for each statement execute function trg_block_delete()';
end $$;

grant select, insert, update on user_screen to app_role;
grant select on user_screen to app_readonly;

comment on table user_screen is
  '계정별 메뉴 권한. 관리자가 손댄 칸만 남고, 없으면 역할 기본값 (0116)';
comment on column user_screen.is_open is
  'true 열림 · false 닫힘 · null 이면 역할 기본값으로 되돌림';

-- ---------------------------------------------------------------------------
-- 한 사람의 화면 권한을 정한다
--
-- 같은 칸을 다시 정하면 덮어쓴다. 지우는 길은 내지 않는다 - 역할 기본값으로
-- 되돌리려면 is_open 에 null 을 준다.
--
-- ── 자기 것은 바꾸지 못한다 ────────────────────────────────────────────
-- 스스로 권한 화면을 닫으면 돌아올 길이 없다. 앱 안에 푸는 단추를 두면 그
-- 단추가 곧 문이 되므로(§2.3 과 같은 까닭), 아예 잠글 수 없게 한다.
--
-- 이것은 판정이 아니라 **덫을 막는 것**이다 - §2.1 이 "막기만 하고 푸는 자리를
-- 안 내면 규칙이 아니라 덫이다" 라고 적은 자리다. 다른 관리자가 바꿔 주고,
-- 관리자가 하나뿐이면 그 하나는 자기를 잠글 수 없다.
-- ---------------------------------------------------------------------------
create or replace function set_user_screen(
  p_user uuid, p_path text, p_open boolean, p_note text default null
) returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_actor uuid := current_user_id();
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;

  if p_user = v_actor then
    raise exception '자기 화면 배정은 바꿀 수 없습니다. 다른 관리자에게 요청하십시오';
  end if;

  insert into user_screen (user_id, path, is_open, note, set_by, set_at)
  values (p_user, p_path, p_open, p_note, v_actor, now())
  on conflict (user_id, path) do update
    set is_open = excluded.is_open,
        note    = excluded.note,
        set_by  = excluded.set_by,
        set_at  = excluded.set_at;
end $fn$;

revoke all on function set_user_screen(uuid, text, boolean, text) from public;
grant execute on function set_user_screen(uuid, text, boolean, text) to app_role;
