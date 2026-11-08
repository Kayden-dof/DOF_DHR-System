/* ---------------------------------------------------------------------------
   0124 · 규정 때문에 막아 둔 삭제를 연다 · 지운 것도 감사추적에 남긴다
          (사용자 지시 2026-11-09)

   ── 왜 여는가 ──────────────────────────────────────────────────────────────
   "지금 시스템은 그냥 내가 관리하는 용도로 사용할거야. 그래서 규정이나
   이런거에 의해서 삭제 기능이 막히는것들은 다 풀어주고, 다만 Log 는 계속
   남길수 있게."

   S03(기록 삭제 금지)은 이 시스템이 GMP 기록 시스템이라는 전제의 규칙이었다.
   0122 에서 이미 "GMP · 품질 기록은 별도 시스템" 으로 정했고, 이번에 그
   전제를 끝까지 따른다. 막아 둔 삭제를 연다. 대신 지운 것은 지운 값 그대로
   감사추적에 남는다 - 지운 사람 · 시각 · 지우기 전 행 전체.

   ── 무엇이 열리고 무엇이 그대로인가 ────────────────────────────────────────
   열림   기록 · 기준정보 표의 행 삭제. 삭제 차단 트리거(<표>_no_delete)를
          걷고 app_role 에 DELETE 를 준다.
   새로   지울 때도 감사추적이 남는다. 감사 트리거(<표>_audit)가 INSERT ·
          UPDATE 에 더해 DELETE 에도 돈다. 지운 행은 old_value 에, 사유가
          있으면(app.change_reason) reason 에 남는다.
   그대로 로그 표는 지울 수 없다 - 감사추적 · 백업 기록 · 복원 기록 · 인쇄
          대장(record_print · record_print_lot). 로그를 지우면 «로그는 계속
          남긴다» 가 깨진다. 감사추적은 지금처럼 purge_logs() 로만 비운다(0122).
   그대로 채번 계수기(numbering_counter)는 기록이 아니라 장치다. 지우면 번호가
          되돌아간다.
   그대로 TRUNCATE 는 어느 표에서도 막힌다. TRUNCATE 는 행 트리거를 건너뛰어
          감사추적에 아무것도 남지 않는다.
   그대로 외래키. 다른 기록이 가리키는 행은 그 기록을 먼저 지워야 지워진다.
          이것은 규정이 아니라 자료가 서로 맞는지의 문제다.
   그대로 고쳐 쓰기 차단(동결 · 한 번만 · 앞으로만 트리거). 이번 지시는 삭제다.
--------------------------------------------------------------------------- */

/* 지운 행에도 사유를 남길 수 있게 한다. 나머지는 0061 그대로다 */
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
  v_why   text;
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

  /* 비밀 컬럼은 값을 빼고 표시만 남긴다 (0060) */
  foreach col in array secrets loop
    if v_old ? col then v_old := jsonb_set(v_old, array[col], '"(감춤)"'::jsonb); end if;
    if v_new ? col then v_new := jsonb_set(v_new, array[col], '"(감춤)"'::jsonb); end if;
  end loop;

  /* 등록에는 사유를 묻지 않는다. 고침과 지움에는 적혀 있으면 남긴다 (0124) */
  v_why := case when tg_op in ('UPDATE','DELETE')
                then nullif(btrim(coalesce(current_setting('app.change_reason', true), '')), '')
           end;

  insert into audit_log (table_name, record_id, action, actor_id, old_value, new_value, reason)
  values (tg_table_name, rid, tg_op, current_user_id(), v_old, v_new, v_why);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $fn$;


/*
 * 시연 자료 증명(0083)은 «표시 뒤로 감사추적이 조용한가» 를 본다. 0124 전에는
 * 지우기가 감사추적을 남기지 않았으므로, 시연 비우기가 스스로 지우는 동안에도
 * 조용했다. 이제 지운 줄도 남으므로 그 줄은 세지 않는다 - 전과 같은 뜻이다.
 * 지우기는 자료를 덜어 낼 뿐 시연 아닌 기록을 들이지 않는다.
 */
create or replace function only_demo_data()
returns boolean
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp as $$
  select exists (select 1 from demo_marker where audit_before is not null)
     /* 표시 뒤로 사람이 손대지 않았는가 (지운 줄은 세지 않는다 · 0124) */
     and not exists (
       select 1 from audit_log
        where acted_at > (select seeded_at from demo_marker limit 1)
          and action <> 'DELETE')
     /* 표시 앞에 무언가 있지 않았는가 */
     and not exists (
       select 1 from audit_log
        where id <= (select audit_before from demo_marker limit 1))
$$;


do $$
declare
  /* 지우지 못하게 그대로 두는 표 - 로그와 장치 */
  keep text[] := array[
    'audit_log', 'backup_log', 'restore_log',
    'record_print', 'record_print_lot',
    'numbering_counter'
  ];
  r   record;
  def text;
begin
  /* 1) 삭제 차단 트리거를 걷는다 (남기는 표는 그대로) */
  for r in
    select c.relname as tbl, t.tgname as trg
      from pg_trigger t
      join pg_class c     on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and not t.tgisinternal
       and t.tgfoid = 'public.trg_block_delete()'::regprocedure
       and (t.tgtype & 8) <> 0            -- DELETE 에 거는 트리거
       and c.relname <> all (keep)
  loop
    execute format('drop trigger %I on public.%I', r.trg, r.tbl);
  end loop;

  /* 2) app_role 에 DELETE 를 준다. 넣을 수 있는데 지울 수 없게 막아 둔 표가 대상이다 */
  for r in
    select c.relname as tbl
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname <> all (keep)
       and has_table_privilege('app_role', c.oid, 'INSERT')
       and not has_table_privilege('app_role', c.oid, 'DELETE')
  loop
    execute format('grant delete on public.%I to app_role', r.tbl);
  end loop;

  /* 3) 감사 트리거가 DELETE 에도 돌게 한다. 인자(식별 컬럼)는 그대로 옮긴다 */
  for r in
    select c.relname as tbl, t.tgname as trg, t.oid as toid
      from pg_trigger t
      join pg_class c     on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and not t.tgisinternal
       and t.tgfoid = 'public.trg_audit()'::regprocedure
       and (t.tgtype & 8) = 0             -- 아직 DELETE 를 안 본다
  loop
    def := pg_get_triggerdef(r.toid);
    def := regexp_replace(def, '^(CREATE TRIGGER \S+ AFTER )(.+?)( ON )', '\1\2 OR DELETE\3');
    if def !~ ' OR DELETE ON ' then
      raise exception '감사 트리거를 고쳐 쓰지 못했습니다: %', pg_get_triggerdef(r.toid);
    end if;
    execute format('drop trigger %I on public.%I', r.trg, r.tbl);
    execute def;
  end loop;
end $$;


/* --- 제품표준서의 공정 하나 지우기 ---------------------------------------- */
/*
 * 공정에는 자재 구성표(과 장입 구간) · 설비 연결이 매달린다. 화면이 넷을 차례로
 * 지우게 하지 않고 한 번에 지운다. 각 행이 지워질 때마다 감사 트리거가 지운 값을
 * 남긴다. 이 공정에 이미 적힌 공정 기록 · 부적합이 있으면 외래키가 막는다 -
 * 그 기록부터 지워야 한다.
 *
 * 부르는 사람의 권한으로 돈다 (security invoker). 0124 로 app_role 이 네 표를
 * 모두 지울 수 있으므로 따로 열어 줄 것이 없다.
 */
create or replace function delete_dmr_operation(op uuid)
returns text
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_code text;
begin
  select code into v_code from dmr_operation where id = op;
  if v_code is null then
    raise exception '공정이 없습니다';
  end if;

  delete from dmr_bom_tier
   where dmr_bom_id in (select id from dmr_bom where operation_id = op);
  delete from dmr_bom where operation_id = op;
  delete from operation_equipment where operation_id = op;
  delete from dmr_operation where id = op;
  return v_code;
end $fn$;

comment on function delete_dmr_operation(uuid) is
  '제품표준서의 공정 하나를 자재 구성표 · 장입 구간 · 설비 연결과 함께 지운다. 지운 행은 감사추적에 남는다 (0124)';

revoke execute on function delete_dmr_operation(uuid) from public;
grant execute on function delete_dmr_operation(uuid) to app_role;


/* 열어 둔 표 가운데 감사 트리거가 없는 표가 있으면 여기서 멈춘다 - 지운 것이 남지 않는다 */
do $$
declare
  missing text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and has_table_privilege('app_role', c.oid, 'DELETE')
     and c.relname not in ('login_attempt', 'access_block', 'demo_marker')   -- 로그 · 표식 (원래 지울 수 있었다)
     and not exists (
       select 1 from pg_trigger t
        where t.tgrelid = c.oid and not t.tgisinternal
          and t.tgfoid = 'public.trg_audit()'::regprocedure
          and (t.tgtype & 8) <> 0);
  if missing is not null then
    raise exception '지울 수 있는데 지운 것이 감사추적에 남지 않는 표: %', missing;
  end if;
end $$;
