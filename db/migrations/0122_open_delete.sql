/* ---------------------------------------------------------------------------
   0122 · 감사추적 비우기 · 쓰지 않은 계정 지우기 (사용자 지시 2026-11-06)

   ── 왜 여는가 ──────────────────────────────────────────────────────────────
   이 시스템은 생산팀 내부 운영용이고, GMP 와 품질 기록은 별도 시스템이
   맡는다 (사용자 결정 2026-11-06). 실운영 착수 전에 쌓인 감사추적은 지킬
   값이 없으니 비울 수 있어야 하고, 아무 일도 하지 않은 계정은 지울 수
   있어야 한다는 지시다.

   0051 은 감사추적을 "예외 없이" 막았다. 그 판단을 이 이관이 바꾼다.
   다만 길은 하나만 낸다.

   ── 무엇이 열리고 무엇이 그대로인가 ────────────────────────────────────────
   열림   purge_logs()         시스템관리자가 감사추적과 로그인 실패 기록을
                               한꺼번에 비운다. 비운 사실 한 줄은 남긴다.
   열림   delete_unused_user() 시스템관리자가 기록을 남기지 않은 계정을
                               지운다. 그 계정의 역할도 함께 지운다.
   그대로 app_role 의 audit_log · app_user DELETE 권한은 여전히 없다
          (S03-01 · S03-02). 한 줄씩 골라 지우는 길은 없다.
   그대로 TRUNCATE 는 어느 표에서도 막힌다.
   그대로 감사추적 말고 다른 기록 표의 삭제 차단 (0051 의 증명 조건).

   ── 비우기를 트리거가 알아보는 방법 ────────────────────────────────────────
   purge_logs() 가 트랜잭션 로컬 설정 dhr.purge_logs 를 켜고 지운다.
   app_role 이 이 설정을 스스로 켜도 audit_log 에 DELETE 권한이 없어 지울
   수 없다. 표 소유자는 원래 트리거를 걷어 낼 수 있으므로 새로 생기는
   우회가 아니다.
--------------------------------------------------------------------------- */

create or replace function trg_block_delete()
returns trigger language plpgsql as $fn$
begin
  /*
   * 표를 통째로 비우는 길은 어떤 조건에서도 열지 않는다.
   *
   * 문구는 손대지 않는다. S03-18 시험 출력이 그대로 OQ 각본이 되므로 (§8.1)
   * 이미 검증된 문장을 바꾸면 각본도 함께 바뀐다. 괄호 안의 tg_op 가 DELETE
   * 인지 TRUNCATE 인지 알려 주므로 구분에 부족함이 없다.
   */
  if tg_op = 'TRUNCATE' then
    raise exception 'S03: 기록은 삭제할 수 없습니다 (%, %)', tg_table_name, tg_op;
  end if;

  /* 감사추적은 purge_logs() 안에서만 지워진다 (0122) */
  if tg_table_name = 'audit_log' then
    if current_setting('dhr.purge_logs', true) = 'on' then
      return old;
    end if;
  elsif only_demo_data() then
    return old;
  end if;

  raise exception 'S03: 기록은 삭제할 수 없습니다 (%, %)', tg_table_name, tg_op;
end $fn$;


/* --- 감사추적 비우기 ------------------------------------------------------- */
create or replace function purge_logs()
returns bigint
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  me uuid := current_user_id();
  n  bigint;
begin
  if me is null or not has_role('SYS_ADMIN') then
    raise exception '감사추적 비우기는 시스템관리자만 할 수 있습니다';
  end if;

  perform set_config('dhr.purge_logs', 'on', true);
  delete from audit_log;
  get diagnostics n = row_count;
  delete from login_attempt;
  perform set_config('dhr.purge_logs', '', true);

  /* 비운 사실 한 줄. 누가 언제 몇 건을 비웠는지는 남긴다 */
  insert into audit_log (table_name, record_id, action, actor_id, new_value)
  values ('audit_log', me, 'PURGE', me, jsonb_build_object('deleted', n));

  return n;
end $fn$;

comment on function purge_logs() is
  '시스템관리자가 감사추적과 로그인 실패 기록을 비운다. 비운 사실 한 줄을 남긴다 (0122)';

revoke execute on function purge_logs() from public;
grant execute on function purge_logs() to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke execute on function purge_logs() from app_readonly';
  end if;
end $$;


/* --- 쓰지 않은 계정 -------------------------------------------------------- */
/*
 * 이 계정이 남긴 기록이 없는가.
 *
 * 두 가지를 본다. 감사추적에 이 계정이 수행자로 찍힌 줄, 그리고 이 계정을
 * 가리키는 다른 표의 행이다. 역할(user_role)은 계정과 함께 지우므로 세지
 * 않는다. 가리키는 표 목록은 외래키에서 그때그때 읽는다 - 표가 늘어도 이
 * 함수를 고칠 필요가 없다.
 *
 * 화면(삭제 단추를 낼지)과 delete_unused_user() 가 같은 판정을 쓴다.
 */
create or replace function user_unused(target uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare
  r   record;
  hit boolean;
begin
  if exists (select 1 from audit_log where actor_id = target) then
    return false;
  end if;

  for r in
    select cl.relname as tbl, a.attname as col
      from pg_constraint con
      join pg_class cl     on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute a  on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.contype = 'f'
       and con.confrelid = 'public.app_user'::regclass
       and ns.nspname = 'public'
       and cl.relname <> 'user_role'
  loop
    execute format('select exists (select 1 from public.%I where %I = $1)', r.tbl, r.col)
       into hit using target;
    if hit then
      return false;
    end if;
  end loop;

  return true;
end $fn$;

comment on function user_unused(uuid) is
  '감사추적 수행자로도, 다른 표의 참조로도 남지 않은 계정인가 (0122)';

revoke execute on function user_unused(uuid) from public;
grant execute on function user_unused(uuid) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'grant execute on function user_unused(uuid) to app_readonly';
  end if;
end $$;


create or replace function delete_unused_user(target uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  me uuid := current_user_id();
begin
  if me is null or not has_role('SYS_ADMIN') then
    raise exception '계정 삭제는 시스템관리자만 할 수 있습니다';
  end if;
  if target = me then
    raise exception '자기 계정은 삭제할 수 없습니다';
  end if;
  if not exists (select 1 from app_user where id = target) then
    raise exception '계정이 없습니다';
  end if;
  if not user_unused(target) then
    raise exception '이 계정이 남긴 기록이 있어 삭제할 수 없습니다. 비활성화하십시오';
  end if;

  /* 역할 회수와 계정 삭제가 각각 감사추적에 남는다 (user_role_audit · app_user_audit) */
  delete from user_role where user_id = target;
  delete from app_user where id = target;
end $fn$;

comment on function delete_unused_user(uuid) is
  '시스템관리자가 기록을 남기지 않은 계정을 역할과 함께 지운다 (0122)';

revoke execute on function delete_unused_user(uuid) from public;
grant execute on function delete_unused_user(uuid) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke execute on function delete_unused_user(uuid) from app_readonly';
  end if;
end $$;
