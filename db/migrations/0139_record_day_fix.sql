/* ===========================================================================
   0139 · 마감 전 기록의 일차 · 작업일 · 시각을 고친다 (사용자 2026-11-20)

   "제조기록서의 작성 일차(작업일)를 고칠 수 있는 권한이 있어야 할 것 같습니다.
    지금은 이 시스템을 품질 시스템이라기보다 관리 차원의 기록지로 쓰고 있어서,
    일자가 자동으로 들어가면 안 됩니다. 그래서 일차별 기록지도 지금 마감을 못
    하고 있습니다."

   ── 무엇이 막혀 있었나 ────────────────────────────────────────────────────
   작업일은 공정을 시작한 날(오늘), 시작 · 종료 시각은 단추를 누른 순간으로
   찍혔다. 일차는 현장 화면이 «내가 마지막으로 손댄 일차» 로 미리 골랐다.
   B261104-01 의 WS-06 동결건조가 11-11 에 시작되면서 2일차(11-05)에 들어갔고
   종료 시각이 비어 2일차가 마감되지 않았다 (0085). 그 기록을 3일차로 옮기거나
   날짜를 고칠 길이 없었다 - 일차는 어디서도 못 고치고, 작업일 · 시각 강제
   정정(0131)은 이미 잠긴 기록만 받았다.

   ── 사용자 결정 (2026-11-20) ─────────────────────────────────────────────
   · 고치기 + 직접 넣기. 마감 전 기록의 일차 · 작업일 · 시작 · 종료를 사유와
     함께 고치고, 시작 · 마감할 때도 날짜와 시각을 사람이 넣는다(지금으로
     채워 두고 바꿀 수 있다).
   · 고치는 사람: 기록한 작업자 본인 + 생산관리자 + 시스템관리자.
   · 작업 지시 발행일보다 앞선 작업일은 그대로 막는다 (0052). 미래도 막는다.

   ── 닿지 않는 규칙 ──────────────────────────────────────────────────────
   잠긴 묶음은 열지 않는다 (S04 · §10). 옮겨 나오는 묶음도, 옮겨 들어갈 묶음도
   마감 전이어야 한다. 잠긴 기록은 지금처럼 시스템관리자의 강제 정정(0131)만
   받는다. 이 함수는 표시(app.force_correct)를 걸지 않으므로 S04 트리거를
   비켜 가지 않는다.

   ── 고친 사실은 남는다 (§1-5) ────────────────────────────────────────────
   칸마다 record_correction 에 이전 값 · 새 값 · 사유 · 고친 사람이 한 줄씩,
   process_record 의 UPDATE 가 감사추적에 사유와 함께 남는다. 마감 전에 고친
   줄은 before_close 가 참이다 - 강제 정정 줄(옛 줄 포함)은 비어 있다.
=========================================================================== */

/* === 1. 정정 내역이 받는 칸 · 마감 전에 고쳤는가 ========================= */
alter table record_correction drop constraint if exists record_correction_field_check;
alter table record_correction add constraint record_correction_field_check
  check (field in ('no_material_reason', 'day_no', 'work_date', 'started_at', 'ended_at'));

/*
 * 기본값을 두지 않는다. 옛 백업에는 이 칸이 없고, 옛 줄은 전부 강제 정정이었다
 * - 비어 있는 것이 사실이다 (§10 "열이 하나 늘어도 같다").
 */
alter table record_correction add column if not exists before_close boolean;

comment on column record_correction.before_close is
  '참이면 일차를 마감하기 전에 고친 줄 (0139). 비어 있으면 잠긴 기록의 강제 정정 (0128 · 0131)';

comment on table record_correction is
  '공정 기록을 사유와 함께 고친 내역. 한 줄이 한 칸이다. 마감 전 고침(0139) · 잠긴 기록의 강제 정정(0128 · 0131)';


/* === 2. 마감 전 기록의 일차 · 작업일 · 시각 고치기 ========================= */
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
  if v_st is not null and v_en is not null and v_en < v_st then
    raise exception '종료 시각이 시작 시각보다 앞섭니다';
  end if;

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

comment on function fix_record_day(uuid, int, date, timestamptz, timestamptz, text) is
  '마감 전 공정 기록의 일차 · 작업일 · 시작 · 종료를 사유와 함께 고친다. 본인 · 생산관리자 · 시스템관리자. 잠긴 묶음은 열지 않는다 (0139)';


/* === 3. 적은 종료 시각으로 공정을 마감한다 ================================ */
/*
 * 공정 마감은 종료 칸을 «지금» 으로 찍었다. 종이를 옮겨 적는 날에는 그 시각이
 * 틀린 값이다. 사람이 적은 시각을 넣고 S05 를 그대로 지난다 - complete_process
 * 가 막으면 이 트랜잭션째 되돌아가므로 종료 칸만 남는 일은 없다.
 */
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
      if r.started_at is not null and p_ended < r.started_at then
        raise exception '종료 시각이 시작 시각(%)보다 앞섭니다',
          to_char(timezone('Asia/Seoul', r.started_at), 'MM-DD HH24:MI');
      end if;
      update process_record set ended_at = p_ended where id = p_pr;
    end if;
  end if;
  perform complete_process(p_pr);
end $fn$;

comment on function complete_process_at(uuid, timestamptz) is
  '공정 마감 (S05) 을 사람이 적은 종료 시각으로 한다. 비우면 지금 (0139)';


/* === 4. 권한: 응용 역할만. 열람 역할 · public 은 이름으로 훑어 걷는다 (§10) == */
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('fix_record_day', 'complete_process_at')
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to app_role', f);
    if exists (select 1 from pg_roles where rolname = 'app_readonly') then
      execute format('revoke all on function %s from app_readonly', f);
    end if;
  end loop;
end $$;
