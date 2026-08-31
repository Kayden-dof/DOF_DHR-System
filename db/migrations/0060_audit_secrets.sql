/* ---------------------------------------------------------------------------
   감사추적에 비밀을 담지 않는다 (3차 검수 결함 2)

   감사추적 화면이 전 계정의 비밀번호 해시를 브라우저까지 실어 보내고 있었다.
   ●●●●●● 로 가리는 코드가 'use client' 파일 안에만 있어서, 서버가 값을 통째로
   직렬화해 넘긴 뒤 화면에서만 덮는 구조였다. 열람 계정으로 받아 확인했다 -
   본문 67,186 바이트에 scrypt 해시 7건.

   화면은 따로 고친다 (조회에서 떼어 낸다). 여기서는 뿌리를 막는다.

   ── 감사추적이 답해야 하는 것 ─────────────────────────────────────────────
   "비밀번호가 언제 누구에 의해 바뀌었는가" 다. "그 값이 무엇이었는가" 가
   아니다. 뒤의 것은 감사에 필요하지 않고, 남겨 두면 감사추적이 비밀 보관소가
   된다.

   ── 이미 저장된 7건은 건드리지 않는다 ─────────────────────────────────────
   지우려면 audit_log 를 수정해야 하는데, §1 이 "고쳐 쓸 수 있는 감사기록은
   감사기록이 아니다" 라며 트리거로 막아 둔 자리다. 비밀을 남겨 두는 것과
   불변이어야 할 것을 손대는 것 중 뒤쪽이 더 나쁜 선례다.

   그리고 그 7건은 1차 감사에서 교체한 비밀번호의 해시이고, 그 계정들은 전부
   must_change_pin 이 서 있어 첫 로그인에서 본인이 다시 정한다. 각자 바꾸는
   순간 값어치가 사라진다. 실 운영에 들어갈 때 시연 계정 자체가 정리된다
   (사용자 확인 2026-08-31).

   ── 목록으로 둔다 ─────────────────────────────────────────────────────────
   app_user.pin_hash 하나뿐이지만 이름을 목록으로 둔다. 나중에 비밀을 담는
   컬럼이 생겼을 때 여기 한 줄을 더하면 되고, 트리거를 다시 짤 일이 없다.
--------------------------------------------------------------------------- */

create or replace function audit_secret_columns(p_table text)
returns text[] language sql immutable as $fn$
  select case p_table
    when 'app_user' then array['pin_hash']
    else array[]::text[]
  end
$fn$;

comment on function audit_secret_columns(text) is
  '감사추적에 값을 남기지 않을 컬럼. 바뀐 사실만 남기고 값은 빼낸다';

/*
 * 값을 덮되 키는 남긴다.
 *
 * 키까지 지우면 "그 컬럼이 없었다" 와 "값을 감췄다" 를 가릴 수 없다. 비밀번호를
 * 바꾼 기록이 아무것도 바뀌지 않은 빈 변경처럼 보이면, 감사추적이 답해야 할
 * 바로 그것("언제 누가 바꿨는가")을 잃는다.
 *
 * 0060 이전에 쌓인 행에는 실제 값이 들어 있다. 그 행들은 audit_log 를 고칠 수
 * 없어 그대로 두지만, 화면이 이 함수를 지나가므로 밖으로는 나가지 않는다.
 */
create or replace function audit_redact(p_value jsonb, p_table text)
returns jsonb language sql immutable as $fn$
  select case when p_value is null then null else
    (select coalesce(
       jsonb_object_agg(k, case when k = any (audit_secret_columns(p_table))
                                then '"(감춤)"'::jsonb else v end),
       '{}'::jsonb)
       from jsonb_each(p_value) as e(k, v))
  end
$fn$;

comment on function audit_redact(jsonb, text) is
  '감사추적 값에서 비밀 컬럼만 (감춤) 으로 덮는다. 키는 남겨 무엇이 바뀌었는지는 보이게 한다';

create or replace function trg_audit()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  key_col text := coalesce(tg_argv[0], 'id');
  j       jsonb;
  rid     uuid;
  secrets text[] := audit_secret_columns(tg_table_name);
  v_old   jsonb;
  v_new   jsonb;
  col     text;
begin
  j := coalesce(to_jsonb(new), to_jsonb(old));

  if not (j ? key_col) then
    raise exception '감사추적: %.% 컬럼이 없습니다 (트리거 인자를 확인하십시오)',
      tg_table_name, key_col;
  end if;

  rid := (j ->> key_col)::uuid;
  if rid is null then
    raise exception '감사추적: %.%가 null입니다', tg_table_name, key_col;
  end if;

  v_old := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;

  /*
   * 비밀 컬럼은 값을 빼고 표시만 남긴다.
   *
   * 키 자체를 지우지 않는다. 지우면 "그 컬럼이 없었다" 와 "값을 감췄다" 를
   * 가릴 수 없다. 감사추적을 읽는 사람이 그 차이를 알아야 한다.
   */
  foreach col in array secrets loop
    if v_old ? col then v_old := jsonb_set(v_old, array[col], '"(감춤)"'::jsonb); end if;
    if v_new ? col then v_new := jsonb_set(v_new, array[col], '"(감춤)"'::jsonb); end if;
  end loop;

  insert into audit_log (table_name, record_id, action, actor_id, old_value, new_value)
  values (tg_table_name, rid, tg_op, current_user_id(), v_old, v_new);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $fn$;
