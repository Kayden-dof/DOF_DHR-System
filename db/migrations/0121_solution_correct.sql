/* ---------------------------------------------------------------------------
   원액 기록을 화면에서 바로잡는 길 - 원료 줄 되돌리기 · 더하기
   (마지막 전체 검토 2026-10-23 · 0119 에서 이어짐)
   근거 CLAUDE.md §1 · §2.0 · §2.1 · §4.7 · §10

   ── 무엇이 막혀 있었는가 ────────────────────────────────────────────────
   0119 가 원료 줄을 고쳐 쓰지 못하게 닫았다 (stock_movement_solution_once).
   정정은 줄을 고치지 않고 같은 원액을 가리키는 반대 줄을 더한다고 적었는데,
   그 줄을 적는 길은 SQL 뿐이었다. 원액을 가리키는 줄을 쓰는 코드는
   make_solution_lot 하나였다.

   그래서 세 가지가 막혀 있었다.

     원료 로트를 잘못 골랐다     재고 증감의 반납은 원액을 가리키지 않는 줄을
                                 적는다. 원료 재고는 돌아오는데 v_solution_input
                                 은 그 로트가 원액에 들어갔다고 계속 말한다
     원료 한 줄을 빠뜨렸다       실제로 쓴 로트를 원액에 이을 길이 없다. 회수
                                 때 그 로트의 영향 배치가 빠진다
     제조일을 잘못 적었다        made_on 은 고쳐 쓰지 못한다. 버리고 다시 만들
                                 려 해도 원료 줄을 되돌릴 길이 없어 영구다

   막기만 하고 푸는 자리를 안 내면 그것은 규칙이 아니라 덫이다 (§2.1). 그리고
   개발자를 다시 불러야 풀리는 것은 설정으로 여는 원칙에 어긋난다 (§2.0).

   ── 함수 둘 ──────────────────────────────────────────────────────────
     return_solution_input   원료 줄 되돌리기. 그 원액을 가리키는 반납 줄
                             (RETURN, +) 을 적는다
     add_solution_input      원료 줄 더하기. 그 원액을 가리키는 원료 줄
                             (SOLUTION, -) 을 적는다

   줄을 고치지 않고 더한다. 원래 줄과 정정 줄이 다 남고 v_solution_input 이
   그 부호 합을 낸다 (0119).

   한도와 연결은 새로 만들지 않는다. 이미 트리거가 지킨다 - 되돌림은 그 원액에
   들어간 원료를 꺼낸 만큼까지만 (T3), 원액을 가리키는 로트는 원액이어야 하고
   (T3), 차감은 잔여를 넘지 못한다 (trg_sm_apply). 함수는 그 위에 사람 · 사유 ·
   수량만 묻는다. 같은 검사를 함수에 또 적으면 두 곳이 갈라진다 (§10).

   ── 사유는 어디에 남는가 ─────────────────────────────────────────────
   반납 정정(return_material_issue · 0056)과 같은 길이다. 사유를 반드시 받고,
   적는 줄의 reason_detail 에 남는다. 그 줄이 감사추적에 등록으로 남으므로
   사유가 함께 실린다 - 등록에는 audit_log.reason 을 묻지 않는다 (0061, 만든
   것 자체가 사유다). 원액 번호를 앞에 붙인다. 원료 줄이 원액 번호로 시작하는
   것과 같은 꼴이라(make_solution_lot) 재고 증감 목록에서 어느 원액의 정정인지
   읽힌다.

   ── 제조일 오기는 새 길을 만들지 않는다 ─────────────────────────────
   원액을 재고 폐기(사유)로 비우고, 원료 줄을 이 함수로 모두 되돌린 뒤, 원액을
   다시 만든다. 원래 원액 로트와 그 번호는 남는다 (§4.10 번호는 재사용하지
   않는다).

   ── 하지 않는 것 ──────────────────────────────────────────────────────
   원액의 단가는 다시 셈하지 않는다. make_solution_lot 이 만들 때 정한 값
   그대로다. 원료를 더하거나 되돌려도 원액 로트 줄에는 손대지 않는다.

   판정하지 않는다 (§1). 어느 원료가 옳은지 묻지 않고, 사람이 적은 정정을
   이어 둘 뿐이다.

   권한은 원액 제조와 같다 - 화면이 생산관리자 · 시스템관리자에게만 연다.
   열람 역할에서는 이름으로 걷는다 (0104).
--------------------------------------------------------------------------- */


/* === 1. 원료 줄 되돌리기 ============================================== */
/*
 * 원료 로트를 잘못 골랐거나 수량을 많이 적었을 때. 원료 재고가 돌아오고
 * v_solution_input 의 순량이 준다. 다 되돌리면 그 원료는 원료 목록에서 빠진다.
 *
 * 한도는 T3 가 지킨다 - 그 원액에 들어간 적 없는 원료 로트는 되돌리지 못하고,
 * 꺼낸 양에서 이미 되돌린 양을 뺀 만큼까지만 되돌린다.
 */
create or replace function return_solution_input(
  p_solution uuid,
  p_raw      uuid,
  p_qty      numeric,
  p_reason   text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  v_no    text;
  v_id    uuid;
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '되돌리는 사유를 입력해야 합니다';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception '되돌릴 수량은 0보다 커야 합니다';
  end if;

  select lot_no into v_no from material_lot where id = p_solution;
  if not found then
    raise exception '원액 로트를 찾을 수 없습니다';
  end if;
  if not exists (select 1 from material_lot where id = p_raw) then
    raise exception '원료 로트를 찾을 수 없습니다';
  end if;

  /* 원액인지 · 들어간 원료인지 · 꺼낸 만큼 안인지는 T3 가 묻는다 */
  insert into stock_movement (material_lot_id, type, qty, solution_lot_id,
                              reason_code, reason_detail, registered_by)
  values (p_raw, 'RETURN', p_qty, p_solution, '원액정정',
          v_no || ' / ' || btrim(p_reason), v_actor)
  returning id into v_id;

  return v_id;
end $fn$;

comment on function return_solution_input(uuid, uuid, numeric, text) is
  '원액 로트에서 원료 줄을 되돌린다. 그 원액을 가리키는 반납 줄을 더하고 새 줄 id 를 돌려준다. 한도는 T3 가 지킨다 (0121)';


/* === 2. 원료 줄 더하기 ================================================= */
/*
 * 원료 한 줄을 빠뜨렸을 때. 실제로 쓴 로트를 원액에 잇는다. 원료 재고가 줄고
 * v_solution_input 에 그 로트가 들어온다 - 회수 때 그 로트에서 원액을 거쳐
 * 배치까지 닿는다.
 *
 * 원액을 자기 원료로 적는 것만 여기서 거른다. 원액이 스스로를 가리키면 그
 * 원액이 무엇으로 만들어졌는지가 제자리를 돈다. 그 밖의 연결은 T3 가 묻는다.
 */
create or replace function add_solution_input(
  p_solution uuid,
  p_raw      uuid,
  p_qty      numeric,
  p_reason   text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  v_no    text;
  v_id    uuid;
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '더하는 사유를 입력해야 합니다';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception '더할 수량은 0보다 커야 합니다';
  end if;

  select lot_no into v_no from material_lot where id = p_solution;
  if not found then
    raise exception '원액 로트를 찾을 수 없습니다';
  end if;
  if not exists (select 1 from material_lot where id = p_raw) then
    raise exception '원료 로트를 찾을 수 없습니다';
  end if;
  if p_raw = p_solution then
    raise exception '원액 로트를 자기 원료로 적을 수 없습니다 (로트 %)', v_no;
  end if;

  /* 원액인지는 T3 가, 잔여를 넘는지는 trg_sm_apply 가 묻는다 */
  insert into stock_movement (material_lot_id, type, qty, solution_lot_id,
                              reason_code, reason_detail, registered_by)
  values (p_raw, 'SOLUTION', -p_qty, p_solution, '원액정정',
          v_no || ' / ' || btrim(p_reason), v_actor)
  returning id into v_id;

  return v_id;
end $fn$;

comment on function add_solution_input(uuid, uuid, numeric, text) is
  '원액 로트에 빠진 원료 줄을 더한다. 그 원액을 가리키는 원료 줄을 적고 새 줄 id 를 돌려준다. 원액 단가는 다시 셈하지 않는다 (0121)';


/* === 3. 권한 ========================================================== */
/*
 * 응용 역할에만 연다. 쓰는 함수는 열람 역할에 열어 두지 않는다 (§10 · 0104).
 * 서명이 아니라 이름으로 훑어 그 이름의 모든 갈래에서 걷는다 - 0043 의
 * alter default privileges 가 새로 만든 함수를 열람 역할에 열어 주므로 이름을
 * 적지 않으면 열려 있다 (IQ-14 가 지킨다).
 */
revoke all on function return_solution_input(uuid, uuid, numeric, text) from public;
revoke all on function add_solution_input(uuid, uuid, numeric, text) from public;
grant execute on function return_solution_input(uuid, uuid, numeric, text) to app_role;
grant execute on function add_solution_input(uuid, uuid, numeric, text) to app_role;

do $$
declare
  r record;
  names text[] := array['return_solution_input', 'add_solution_input'];
begin
  if not exists (select 1 from pg_roles where rolname = 'app_readonly') then
    return;
  end if;

  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any(names)
  loop
    execute format('revoke execute on function %s from app_readonly', r.sig);
    execute format('revoke execute on function %s from public', r.sig);
  end loop;
end $$;
