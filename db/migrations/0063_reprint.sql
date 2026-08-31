/* ---------------------------------------------------------------------------
   재인쇄는 마감이 아니다 (사용자 결정 2026-08-31)

   0053 이 "남의 일차를 마감하지 못하게" 하면서 조건을 사람에게만 걸었다.
   그런데 제조기록서는 화면을 여는 것이 곧 마감이라(§7), 그 확인이 **이미
   마감된 묶음을 다시 뽑을 때도** 걸렸다.

   재인쇄는 잠그는 일이 아니다. 이미 잠겨 있으므로 잠글 것이 없고, 기록도
   바뀌지 않는다. 그런데 막혀 있으면 검토자가 남의 기록지를 다시 뽑아 볼 길이
   없다. 종이가 정본인 시스템에서 그건 검토를 막는 것이다.

   ── 무엇이 좁아지는가 ─────────────────────────────────────────────────────
   확인은 그대로 있고, 걸리는 자리만 좁아진다.

     아직 안 잠긴 묶음   본인 또는 생산관리자·시스템관리자만       (그대로)
     이미 잠긴 묶음      뽑을 수 있는 사람이면 누구나            (열린다)

   S04 는 흔들리지 않는다. S04 가 지키는 것은 "인쇄된 뒤에는 고칠 수 없다"
   이고, 그 잠금은 이 함수가 아니라 day_lock 과 trg_s04_locked 가 들고 있다.
   여기서 바뀌는 것은 누가 종이를 한 장 더 뽑을 수 있는가 하나다.

   ── 열람 계정은 여전히 못 뽑는다 ──────────────────────────────────────────
   0053 이 app_readonly 와 public 의 실행 권한을 걷어 두었다. 그건 그대로다.
   대표 계정으로는 이 함수가 아예 불리지 않는다.

   ── 회차는 오른다 ─────────────────────────────────────────────────────────
   다시 뽑으면 record_print 회차가 하나 오르고 누가 뽑았는지가 printed_by 에
   남는다. 자료가 그대로면 자료 식별자는 같다 (§7). 그래서 손에 든 종이 두
   장이 같은 자료인지 다른 자료인지 식별자로 갈린다.
--------------------------------------------------------------------------- */

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
   * 새로 마감하는 경우에만 묻는다.
   *
   * 작업자는 자기가 적은 일차만 마감한다 (§4.9). 생산관리자와 시스템관리자는
   * 남의 묶음도 마감한다 - 작업자가 자리에 없는데 종이가 필요한 일이 있다.
   * 이미 마감된 묶음을 다시 뽑는 것은 마감이 아니므로 여기 걸리지 않는다.
   *
   * 누가 뽑았는지는 어느 경우든 record_print.printed_by 에 그대로 남는다.
   */
  if not is_locked(p_work_order, p_day_no, p_worker)
     and v_actor <> p_worker
     and not exists (select 1 from user_role
                      where user_id = v_actor and role in ('PROD_MGR', 'SYS_ADMIN')) then
    raise exception '아직 마감되지 않은 기록입니다. 본인 또는 생산관리자가 마감합니다';
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

comment on function print_day_record(uuid, int, uuid, text, int) is
  '제조기록서 발행. 아직 안 잠긴 묶음은 본인 또는 생산관리자만, 이미 잠긴 묶음은 재인쇄';
