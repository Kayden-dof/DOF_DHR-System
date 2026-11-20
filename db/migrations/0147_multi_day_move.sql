/* ===========================================================================
   0147 · 여러 날 공정은 끝나는 일차로 옮길 수 있다 (사용자 2026-11-20 «4일차로 옮김»)

   B261104-01 WS-05 세척은 2일차(11-05 13:38)에 시작해 11-07 09:00 에 끝났다. 종이 번호대로
   4일차(11-07)에 두려면 마감 전 고치기(fix_record_day)가 2일차에서 4일차로 옮겨야 하는데,
   «마지막 일차 다음까지만» 이라 3일차를 건너뛰지 못했다. 3일차(11-06)는 세척이 이어진 날이라
   따로 적힌 기록이 없다.

   여러 날에 걸친 공정은 걸친 날 수(종료일 - 작업일)만큼 뒤 일차까지 옮길 수 있게 한다.
   나머지 규칙(잠긴 묶음 · 발행일 · 미래 · 사유 · 정정 내역)은 그대로다. 본문은 0142 의 것이고
   위 검사 한 자리만 바뀌었다.
=========================================================================== */

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
  /*
   * 여러 날에 걸친 공정은 걸친 날 수만큼 뒤 일차까지 옮길 수 있다 (0147). 11-05 에 시작해
   * 11-07 에 끝난 세척은 2일차에서 4일차로 간다 - 그 사이 3일차(11-06)는 그 공정이 이어진
   * 날이라 따로 적힌 기록이 없어도 일차다. 그 밖에는 지금처럼 마지막 일차 다음까지만.
   */
  if v_day > greatest(coalesce(v_last, 0) + 1,
                      r.day_no + greatest(0, coalesce(
                        (timezone('Asia/Seoul', coalesce(v_en, r.ended_at)))::date - r.work_date, 0))) then
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
