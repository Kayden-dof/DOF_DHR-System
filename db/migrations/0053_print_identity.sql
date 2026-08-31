/* ---------------------------------------------------------------------------
   인쇄는 신원을 확인하고 남긴다 (2차 검수 결함 4)

   0043 은 "열람자 세션은 DB 에서도 읽기 전용이라 여기를 지나쳐도 인쇄 기록
   자체가 남지 않는다" 고 단정했다. 그 단정이 세 군데에서 사실이 아니었다.

     ① print_day_record 가 회수 목록에서 빠졌다. 그런데 그 함수는
        security definer 라 주인 권한으로 돌고, 부르는 순간 인쇄 기록이 생기고
        묶음이 잠긴다. 잠금 해제 함수는 설계상 없다.

     ② 회수 목록에 든 함수들도 PUBLIC 이 실행 권한을 쥐고 있었다. 역할에서만
        걷어 낸 revoke 는 PUBLIC 을 타고 그대로 돌아온다. 함수는 만들 때
        PUBLIC 에 실행 권한이 기본으로 붙는다.

     ③ 0043 이 alter default privileges 로 "앞으로 만들 함수" 까지 열람자에게
        열어 두었다. 그래서 그 뒤로 만든 함수는 하나도 빠짐없이 열람자에게
        열려 있다. 목록을 관리하는 것이 아니라 목록을 무의미하게 만든 설정이다.

   ── 그리고 누가 누구 것을 잠그는가 ────────────────────────────────────────
   §4.9 는 잠금 키를 (지시서, 일차, 작업자) 로 잡았고 그 이유를 "같은 날 두
   사람이 작업하면 각자 자기 것만 마감한다" 로 적었다. 그런데 어느 계층에도
   "자기 것" 을 확인하는 곳이 없었다. 제조기록서 인쇄 화면은 잠글 작업자를
   주소에서 받고, 그 값이 지금 로그인한 사람인지 아무도 보지 않는다.

   작업자 A 가 주소만 바꾸면 B 가 적는 중인 일차를 영구히 잠글 수 있었다.

   여기서는 그 확인을 DB 에 둔다. 응용에만 두면 응용을 건너뛴 경로가 남는다.
   생산관리자와 시스템관리자는 남의 묶음도 뽑을 수 있다 - 작업자가 자리에 없을
   때 종이를 뽑아야 하는 일이 실제로 있고, 그때 인쇄자가 누구인지는 인쇄 기록에
   그대로 남는다.

   ── 시연 자료 비우기는 손대지 않는다 ──────────────────────────────────────
   purge_demo_data 의 search_path 와 demo_marker 표시는 아직 개발 중이고
   시연 자료를 지우는 용도이므로 그대로 둔다 (사용자 결정 2026-08-28).
   다만 열람 전용 역할이 그것을 부를 이유는 없으므로 실행 권한만 걷는다 -
   기능은 그대로이고 부를 수 있는 사람만 좁아진다.
--------------------------------------------------------------------------- */


/* === 1. 앞으로 만들 함수를 자동으로 열어 주지 않는다 ===================== */
/*
 * 표는 그대로 둔다. 열람자는 무엇이든 읽어야 하고, 새 표를 만들 때마다
 * grant 를 잊으면 그 표만 못 읽는 이상한 상태가 되기 때문이다 (0043 의 판단).
 *
 * 함수는 다르다. 읽기 함수는 열려 있어야 편하지만 쓰기 함수가 섞여 들어오면
 * 그 순간 읽기 전용이 아니게 된다. 어느 쪽인지는 만든 사람만 안다.
 * 기본을 닫아 두고 읽기 함수만 골라 여는 편이 맞다.
 */
alter default privileges in schema public
  revoke execute on functions from app_readonly;


/* === 2. PUBLIC 의 실행 권한을 걷는다 ==================================== */
/*
 * 쓰기가 일어나는 security definer 함수 전부다. PUBLIC 에서 걷지 않으면
 * 역할별 revoke 가 아무 의미가 없다.
 *
 * 걷고 나서 app_role 에만 다시 준다. 열람 전용 역할에는 주지 않는다.
 *
 * suggest_min_stock 은 값을 돌려주기만 하지만 volatile 로 선언되어 있어
 * 안쪽에서 무엇을 하는지 서명만으로는 알 수 없다. 읽기 전용 역할이 부를 이유가
 * 없으므로 같이 닫는다. 화면은 app_role 로 돈다.
 *
 * trg_audit 은 넣지 않는다. 트리거 함수는 트리거가 부를 때 실행 권한을 보지
 * 않고, 여기서 걷으면 얻는 것 없이 잃을 위험만 생긴다.
 */
do $$
declare f text;
begin
  foreach f in array array[
    'print_day_record(uuid, int, uuid, text, int)',
    'record_print_log(print_kind, text, uuid, uuid, int, uuid, uuid, int, uuid)',
    'retrieve_print(uuid, text)',
    'amend_material_issue(uuid, numeric, text)',
    'return_material_issue(uuid, numeric, text)',
    'cut_product_lot(uuid, uuid, int, int, date)',
    'cut_product_lot_field(uuid, uuid, int, int, date)',
    'copy_dmr_structure(uuid, uuid)',
    'complete_process(uuid)',
    'next_number(numbering_target, uuid)',
    'make_solution(uuid[], numeric[], text, text)',
    'expire_material_lots()',
    'suggest_min_stock(integer)',
    'login_fail(text)',
    'login_ok(text)',
    'login_attempt_sweep()',
    'purge_demo_data()'
  ] loop
    if to_regprocedure('public.' || f) is not null then
      execute format('revoke execute on function public.%s from public', f);
      execute format('revoke execute on function public.%s from app_readonly', f);
      execute format('grant  execute on function public.%s to app_role', f);
    end if;
  end loop;
end $$;


/* === 3. 다른 사람 이름으로 잠그지 않는다 ================================ */
/*
 * print_day_record 안에서 확인한다. 인쇄 화면에서 한 번 더 보겠지만, 화면은
 * 주소만 바꾸면 지나칠 수 있는 자리다.
 *
 * 함수 본문 전체를 다시 적는다. 0020 의 것에 신원 확인만 앞에 붙였다 -
 * security definer 함수는 부분 수정이 안 되므로 통째로 바꾼다.
 */
create or replace function print_day_record(
  p_work_order uuid, p_day_no int, p_worker uuid, p_data_hash text,
  p_pages int default 1
) returns record_print
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_row record_print; v_actor uuid := current_user_id();
begin
  if v_actor is null then
    raise exception '로그인 정보가 없습니다';
  end if;

  /*
   * 자기 묶음이거나, 관리하는 사람이거나.
   *
   * 작업자는 자기가 적은 일차만 마감한다 (§4.9). 생산관리자와 시스템관리자는
   * 남의 묶음도 뽑는다 - 작업자가 자리에 없는데 종이가 필요한 일이 있다.
   * 누가 뽑았는지는 record_print.printed_by 에 그대로 남는다.
   *
   * 아래 본문은 0020 의 것을 그대로 옮겼다. 이 확인 하나만 앞에 붙었다 -
   * security definer 함수는 부분 수정이 안 되므로 통째로 다시 적을 뿐,
   * 하던 일을 바꾸지 않는다.
   */
  if v_actor <> p_worker
     and not exists (select 1 from user_role
                      where user_id = v_actor and role in ('PROD_MGR', 'SYS_ADMIN')) then
    raise exception '다른 사람의 기록은 마감할 수 없습니다. 본인 또는 생산관리자가 뽑습니다';
  end if;

  v_row := record_print_log('DAY_RECORD', p_data_hash, p_work_order, null,
                            p_day_no, p_worker, null, p_pages);

  insert into day_lock (work_order_id, day_no, worker_id, locked_by)
  values (p_work_order, p_day_no, p_worker, v_actor)
  on conflict (work_order_id, day_no, worker_id) do nothing;

  return v_row;
end $fn$;

revoke execute on function print_day_record(uuid, int, uuid, text, int) from public;
revoke execute on function print_day_record(uuid, int, uuid, text, int) from app_readonly;
grant  execute on function print_day_record(uuid, int, uuid, text, int) to app_role;
