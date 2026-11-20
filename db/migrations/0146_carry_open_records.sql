/* ===========================================================================
   0146 · 여러 날에 걸친 공정은 끝나는 일차로 넘긴다 (사용자 2026-11-20)

   "이렇게 일차가 4일차까지 넘어가는게 있는데 이런건 어떻게 처리 할거임?? 내가 일부만
    작성하고 2일차 마감이 될텐데. 그리고 3일차 작업하고 마감하고, 4일차 작업할때 해당
    제조기록서의 공정 마감이 되는경우가 발생하는데"  → «끝나는 일차로 (권고)»
   "이렇게 내가 4일차까지 한 제조기록서에서 쓰게 되면 이부분도 반영이 되어야 하는거"
    (일차 카드에 3일차 · 4일차와 그 날짜)

   WS-05 세척 (F706-DX2401-05) 은 2일차(11-05)에 시작해 4일차(11-07)에 끝난다. 진행 중인
   공정이 있는 일차는 잠그지 않으므로 (0085) 2 · 3일차가 4일차까지 마감 · 인쇄되지 못했다.

   일차를 마감할 때 그 묶음의 진행 중 공정을 다음 일차로 넘긴다. 넘기는 공정의 작업일은
   다음 일차의 작업일이 된다 - 그래서 일차 카드와 기록서 머리에 다음 일차의 날짜가 선다.
   공정의 시작 시각은 그대로이고, 기록서 칸마다 적은 날(서명 일자)도 그대로다. 공정이 끝나는
   일차에 그 기록서가 다 채워진 채로 한 번 인쇄된다. 한 장이 일부만 적힌 채 잠기지 않는다.

     · 넘기는 사람: 그 묶음의 작업자 · 생산관리자 · 시스템관리자 (lock_day 와 같다)
     · 다음 일차가 이미 마감됐으면 넘기지 않는다 (S04)
     · 다음 일차의 작업일은 넘기는 일차의 작업일보다 앞서지 못하고, 아직 오지 않은 날도 안 된다
     · 일차 · 작업일을 칸마다 정정 내역(마감 전 고침)으로 남긴다
=========================================================================== */

create or replace function carry_open_records(
  p_work_order uuid, p_day_no int, p_worker uuid, p_next_date date)
returns int
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_why   constant text := '여러 날 공정 · 다음 일차로 넘김';
  r record;
  n int := 0;
begin
  if v_actor is null then
    raise exception '로그인 정보가 없습니다';
  end if;
  if v_actor <> p_worker
     and not exists (select 1 from user_role
                      where user_id = v_actor and role in ('PROD_MGR', 'SYS_ADMIN')) then
    raise exception '다른 사람의 기록은 넘길 수 없습니다. 본인 또는 생산관리자가 넘깁니다';
  end if;
  if p_next_date is null then
    raise exception '다음 일차의 작업일을 적으십시오';
  end if;
  if p_next_date > v_today then
    raise exception '다음 일차의 작업일이 아직 오지 않은 날입니다 (%)', p_next_date;
  end if;
  if is_locked(p_work_order, p_day_no, p_worker) then
    raise exception '%일차는 이미 마감되었습니다', p_day_no;
  end if;
  if is_locked(p_work_order, p_day_no + 1, p_worker) then
    raise exception '%일차는 이미 마감되어 넘길 수 없습니다', p_day_no + 1;
  end if;

  for r in
    select id, work_date from process_record
     where work_order_id = p_work_order and day_no = p_day_no and worker_id = p_worker
       and ended_at is null
     for update
  loop
    if p_next_date < r.work_date then
      raise exception '다음 일차의 작업일(%)이 넘기는 공정의 작업일(%)보다 앞섭니다', p_next_date, r.work_date;
    end if;
    perform set_config('app.change_reason', '고침 · ' || v_why, true);
    update process_record set day_no = p_day_no + 1, work_date = p_next_date where id = r.id;
    insert into record_correction
      (process_record_id, field, old_value, new_value, why, corrected_by, before_close)
    values
      (r.id, 'day_no', p_day_no::text, (p_day_no + 1)::text, v_why, v_actor, true);
    if p_next_date is distinct from r.work_date then
      insert into record_correction
        (process_record_id, field, old_value, new_value, why, corrected_by, before_close)
      values
        (r.id, 'work_date', r.work_date::text, p_next_date::text, v_why, v_actor, true);
    end if;
    n := n + 1;
  end loop;
  return n;
end $fn$;

comment on function carry_open_records(uuid, int, uuid, date) is
  '일차를 마감하기 전에 그 묶음의 진행 중 공정을 다음 일차 · 그 작업일로 넘긴다. 여러 날에 걸친 공정은 끝나는 일차에 인쇄된다 (0146)';

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'carry_open_records'
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to app_role', f);
    if exists (select 1 from pg_roles where rolname = 'app_readonly') then
      execute format('revoke all on function %s from app_readonly', f);
    end if;
  end loop;
end $$;
