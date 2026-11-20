/* ===========================================================================
   0142 · 종료 시각이 시작 시각보다 앞서도 막지 않는다 (사용자 2026-11-20)

   "이거 어디서 시작 시간이 잡혀있길래 종료일시를 못적게 되어있는지 확인해주고.
    제한 사항 삭제해줘."

   B261104-01 WS-01 «NaCl 처리 및 세척» 은 김병휘가 11-20 10:16 에 현장 화면에서
   «공정 시작» 을 눌러 시작 시각이 그때(시작 카드의 기본값 = 지금)로 들어갔다. 종이
   기록은 11-04 라 종료 11-04 11:30 을 적자 공정 마감이 «종료 시각이 시작 시각
   (11-20 10:16)보다 앞섭니다» 로 막았다. 종이를 뒤에 옮겨 적는 이 현장에서는 시작을
   먼저 고치지 않으면 마감도 못 하는 순서가 된다.

   종료 < 시작 을 막던 세 자리를 걷는다. 나머지 규칙(미래 시각, 잠긴 묶음, 사유,
   S05, 발행일 앞 작업일)은 그대로다.
     · complete_process_at  공정 마감 (0139)
     · fix_record_day       마감 전 일차 · 작업일 · 시각 고치기 (0139)
     · force_correct_times  잠긴 기록의 강제 정정 (0131)
   함수 본문은 그 이관의 것 그대로이고 위 검사만 빠졌다. 권한 · 설명은 그대로 남는다
   (같은 서명의 create or replace).
=========================================================================== */

create or replace function complete_process_at(p_pr uuid, p_ended timestamptz)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare r record;
begin
  if p_ended is not null then
    select started_at, ended_at into r from process_record where id = p_pr for update;
    if not found then
      raise exception '공정 기록을 찾을 수 없습니다';
    end if;
    if r.ended_at is null then
      if p_ended > now() + interval '1 minute' then
        raise exception '아직 오지 않은 시각입니다';
      end if;
      /* 시작보다 앞선 종료도 받는다 (0142) - 시작 시각은 뒤에 고친다 */
      update process_record set ended_at = p_ended where id = p_pr;
    end if;
  end if;
  perform complete_process(p_pr);
end $fn$;


create or replace function fix_record_day(
  p_pr uuid, p_day_no int, p_work_date date,
  p_started timestamptz, p_ended timestamptz, p_why text)
returns int
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  r       record;
  v_day   int;
  v_wd    date;
  v_st    timestamptz;
  v_en    timestamptz;
  v_last  int;
  v_why   text := btrim(coalesce(p_why, ''));
  n       int := 0;
  fmt     constant text := 'YYYY-MM-DD HH24:MI:SS';
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if v_why = '' then
    raise exception '왜 고치는지 적으십시오';
  end if;

  select id, work_order_id, day_no, worker_id, work_date, started_at, ended_at
    into r from process_record where id = p_pr for update;
  if not found then
    raise exception '공정 기록을 찾을 수 없습니다';
  end if;

  /* 기록한 사람 본인 · 생산관리자 · 시스템관리자 (사용자 결정 2026-11-20) */
  if v_actor <> r.worker_id
     and not exists (select 1 from user_role
                      where user_id = v_actor and role in ('PROD_MGR', 'SYS_ADMIN')) then
    raise exception '다른 사람의 공정 기록은 고칠 수 없습니다. 본인 또는 생산관리자가 고칩니다';
  end if;

  if is_locked(r.work_order_id, r.day_no, r.worker_id) then
    raise exception '마감된 %일차의 기록입니다. 잠금은 풀지 않습니다', r.day_no;
  end if;

  v_day := coalesce(p_day_no, r.day_no);
  v_wd  := coalesce(p_work_date, r.work_date);
  v_st  := coalesce(p_started, r.started_at);
  v_en  := coalesce(p_ended, r.ended_at);

  if v_day < 1 then
    raise exception '일차는 1 이상입니다';
  end if;
  select max(day_no) into v_last from process_record where work_order_id = r.work_order_id;
  if v_day > coalesce(v_last, 0) + 1 then
    raise exception '%일차로는 옮길 수 없습니다. 지금 마지막 일차(%) 다음까지만 고릅니다',
      v_day, v_last;
  end if;
  if v_day <> r.day_no and is_locked(r.work_order_id, v_day, r.worker_id) then
    raise exception '옮길 %일차는 이미 마감되었습니다', v_day;
  end if;

  /* 종료 시각은 공정 마감이 적는다. 열린 기록에 종료를 넣으면 S05 를 비켜 간다 */
  if r.ended_at is null and p_ended is not null then
    raise exception '아직 마감하지 않은 공정입니다. 종료 시각은 공정 마감에서 적습니다';
  end if;
  if v_st > now() + interval '1 minute' or v_en > now() + interval '1 minute' then
    raise exception '아직 오지 않은 시각입니다';
  end if;
  /* 종료가 시작보다 앞서도 받는다 (0142) - 둘 중 하나를 먼저 고치는 차례를 막지 않는다 */

  /* 감사추적의 사유 칸. 부르는 쪽이 비워 보내도 남는다 */
  perform set_config('app.change_reason', '고침 · ' || v_why, true);

  if v_day is distinct from r.day_no
     or v_st is distinct from r.started_at
     or v_en is distinct from r.ended_at then
    update process_record
       set day_no = v_day, started_at = v_st, ended_at = v_en
     where id = p_pr;
  end if;
  /*
   * 작업일은 바뀔 때만 적는다. 적으면 0052 트리거가 돈다 - 발행일 앞 · 미래 날짜는
   * 그대로 거부된다 (사용자 결정 «그대로 막기»). 종이에 맞춰 강제 정정된 옛 작업일이
   * 발행일보다 앞서 있어도, 일차만 옮길 때는 그 날짜를 다시 묻지 않는다.
   */
  if v_wd is distinct from r.work_date then
    update process_record set work_date = v_wd where id = p_pr;
  end if;

  if v_day is distinct from r.day_no then
    insert into record_correction (process_record_id, field, old_value, new_value, why, corrected_by, before_close)
    values (p_pr, 'day_no', r.day_no::text, v_day::text, v_why, v_actor, true);
    n := n + 1;
  end if;
  if v_wd is distinct from r.work_date then
    insert into record_correction (process_record_id, field, old_value, new_value, why, corrected_by, before_close)
    values (p_pr, 'work_date', r.work_date::text, v_wd::text, v_why, v_actor, true);
    n := n + 1;
  end if;
  if v_st is distinct from r.started_at then
    insert into record_correction (process_record_id, field, old_value, new_value, why, corrected_by, before_close)
    values (p_pr, 'started_at', to_char(timezone('Asia/Seoul', r.started_at), fmt),
            to_char(timezone('Asia/Seoul', v_st), fmt), v_why, v_actor, true);
    n := n + 1;
  end if;
  if v_en is distinct from r.ended_at then
    insert into record_correction (process_record_id, field, old_value, new_value, why, corrected_by, before_close)
    values (p_pr, 'ended_at', to_char(timezone('Asia/Seoul', r.ended_at), fmt),
            to_char(timezone('Asia/Seoul', v_en), fmt), v_why, v_actor, true);
    n := n + 1;
  end if;

  if n = 0 then
    raise exception '지금 값과 같습니다';
  end if;
  return n;
end $fn$;


create or replace function force_correct_times(
  p_pr uuid, p_work_date date, p_started timestamptz, p_ended timestamptz, p_why text)
returns int
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  r       record;
  v_wd    date;
  v_st    timestamptz;
  v_en    timestamptz;
  n       int := 0;
  fmt     constant text := 'YYYY-MM-DD HH24:MI:SS';
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if not has_role('SYS_ADMIN') then
    raise exception '강제 정정은 시스템관리자만 할 수 있습니다';
  end if;
  if p_why is null or btrim(p_why) = '' then
    raise exception '강제 정정 사유를 적으십시오';
  end if;

  select id, work_order_id, day_no, worker_id, work_date, started_at, ended_at
    into r from process_record where id = p_pr for update;
  if not found then
    raise exception '공정 기록을 찾을 수 없습니다';
  end if;
  if not is_locked(r.work_order_id, r.day_no, r.worker_id) then
    raise exception '잠기지 않은 기록입니다. 현장 화면에서 고치십시오';
  end if;

  v_wd := coalesce(p_work_date, r.work_date);
  v_st := coalesce(p_started, r.started_at);
  v_en := coalesce(p_ended, r.ended_at);
  /* 종료가 시작보다 앞서도 받는다 (0142) */
  /*
   * 미래 시각은 막는다. 전에는 «종료가 시작 앞» 검사가 미래 시작을 우연히 함께 막고
   * 있었다 (시작을 미래로 옮기면 종료가 그 앞이 되므로). 그 검사를 걷으며 따로 세운다.
   */
  if v_st > now() + interval '1 minute' or v_en > now() + interval '1 minute' then
    raise exception '아직 오지 않은 시각입니다';
  end if;

  perform set_config('app.force_correct', p_pr::text, true);
  update process_record
     set work_date = v_wd, started_at = v_st, ended_at = v_en
   where id = p_pr;
  perform set_config('app.force_correct', '', true);

  if v_wd is distinct from r.work_date then
    insert into record_correction (process_record_id, field, old_value, new_value, why, corrected_by)
    values (p_pr, 'work_date', r.work_date::text, v_wd::text, btrim(p_why), v_actor);
    n := n + 1;
  end if;
  if v_st is distinct from r.started_at then
    insert into record_correction (process_record_id, field, old_value, new_value, why, corrected_by)
    values (p_pr, 'started_at', to_char(timezone('Asia/Seoul', r.started_at), fmt),
            to_char(timezone('Asia/Seoul', v_st), fmt), btrim(p_why), v_actor);
    n := n + 1;
  end if;
  if v_en is distinct from r.ended_at then
    insert into record_correction (process_record_id, field, old_value, new_value, why, corrected_by)
    values (p_pr, 'ended_at', to_char(timezone('Asia/Seoul', r.ended_at), fmt),
            to_char(timezone('Asia/Seoul', v_en), fmt), btrim(p_why), v_actor);
    n := n + 1;
  end if;
  if n = 0 then
    raise exception '지금 값과 같습니다';
  end if;
  return n;
end $fn$;
