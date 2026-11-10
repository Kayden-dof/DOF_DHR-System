/* ===========================================================================
   0131 · 배치번호 · 작업일 · 시작 종료 시각을 종이 제조기록서에 맞춘다 (사용자 2026-11-10)

   "배치 번호도 제조기록서 스캔해준거 보면 나왔을텐데... B261104-01 임."
   "시작 종료일도 기록지에 다 있었을거 같은데.."

   종이 제조기록서가 먼저 쓰이고 DHR 에는 뒤에 옮겨 적었다. 채번 규칙은
   옮겨 적은 날(11-09)로 배치번호를 매겼고, 공정의 시작 · 종료 시각도 옮겨
   적은 순간의 시각이 들어갔다. 종이에는 B261104-01 과 11-04 ~ 11-07 의 실제
   시각이 있다. 종이가 먼저다 (0127 지시서 번호와 같은 원칙).

   ── 1. 배치번호 ─────────────────────────────────────────────────────────
   0052 · 0127 이 기록이 붙은 작업 지시의 배치번호를 잠갔다. 번호만 연다 -
   계보는 id 로 이어지므로 번호를 바꿔도 기록이 다른 곳을 가리키지 않는다.
   기록이나 인쇄물이 있으면 바꾼 까닭(app.change_reason)이 있어야 한다.
   이전 값과 까닭은 감사추적에 남는다. 원재료 로트 · 장입 장수 · 표준서는
   그대로 잠근다.

   ── 2. 잠긴 기록의 작업일 · 시각 ───────────────────────────────────────
   강제 정정(0128)에 칸 셋을 더한다: work_date · started_at · ended_at.
   시스템관리자만, 까닭을 적고, 잠금은 풀지 않는다. 무엇을 무엇으로 왜
   고쳤는지 record_correction 에 칸마다 한 줄씩 남는다.

   작업일이 작업 지시 발행일보다 앞서지 못하게 한 규칙(0052)은 강제 정정
   안에서만 비킨다. DHR 의 발행일은 옮겨 적은 날이고, 종이 지시서는 그보다
   먼저 나갔다 (WO-261103-01 승인 26.11.03). 미래 날짜는 여전히 막는다.
=========================================================================== */

/* === 1. 배치번호를 연다 ================================================== */
create or replace function trg_wo_root_immutable()
returns trigger language plpgsql as $fn$
declare v_locked boolean;
begin
  select exists (select 1 from process_record where work_order_id = old.id)
      or exists (select 1 from record_print   where work_order_id = old.id)
      or exists (select 1 from product_lot    where work_order_id = old.id)
    into v_locked;

  if new.material_lot_id is distinct from old.material_lot_id
  or new.sheet_count     is distinct from old.sheet_count
  or new.device_master_id is distinct from old.device_master_id
  or new.dmr_revision    is distinct from old.dmr_revision then
    if v_locked then
      raise exception
        '기록이나 인쇄물이 있는 작업 지시는 원재료 로트 · 장입 장수 · 제품표준서를 '
        '바꿀 수 없습니다. 취소하고 다시 발행하십시오';
    end if;
  end if;

  /* 배치번호는 종이 번호에 맞출 수 있다 (0131). 기록이 있으면 까닭이 있어야 한다 */
  if new.batch_no is distinct from old.batch_no and v_locked
     and coalesce(btrim(current_setting('app.change_reason', true)), '') = '' then
    raise exception '기록이 있는 작업 지시의 배치번호를 바꾸려면 까닭을 적으십시오';
  end if;
  return new;
end $fn$;


/* === 2. 작업일 규칙: 강제 정정 안에서만 발행일 앞을 허락한다 ================ */
create or replace function trg_pr_workdate()
returns trigger language plpgsql as $fn$
declare v_issued date; v_today date;
begin
  v_today := (now() at time zone 'Asia/Seoul')::date;
  select (issued_at at time zone 'Asia/Seoul')::date into v_issued
    from work_order where id = new.work_order_id;

  if new.work_date > v_today then
    raise exception '작업일이 아직 오지 않은 날입니다 (%)', new.work_date;
  end if;
  /* 강제 정정(0131): 종이 기록의 날짜로 바로잡는다. 표시는 정의자 함수 안일 때만 믿는다 */
  if tg_op = 'UPDATE'
     and current_setting('app.force_correct', true) = new.id::text
     and current_user not in ('app_role', 'app_readonly') then
    return new;
  end if;
  if v_issued is not null and new.work_date < v_issued then
    raise exception '작업일이 작업 지시 발행일(%)보다 앞섭니다 (%)', v_issued, new.work_date;
  end if;
  return new;
end $fn$;


/* === 3. 정정 내역이 받는 칸 ============================================== */
alter table record_correction drop constraint if exists record_correction_field_check;
alter table record_correction add constraint record_correction_field_check
  check (field in ('no_material_reason', 'work_date', 'started_at', 'ended_at'));


/* === 4. 작업일 · 시각 강제 정정 ========================================== */
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
  if v_st is not null and v_en is not null and v_en < v_st then
    raise exception '종료 시각이 시작 시각보다 앞섭니다';
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

comment on function force_correct_times(uuid, date, timestamptz, timestamptz, text) is
  '잠긴 공정 기록의 작업일 · 시작 · 종료 시각을 시스템관리자가 사유와 함께 종이 기록에 맞춘다. 잠금은 풀지 않는다 (0131)';

revoke all on function force_correct_times(uuid, date, timestamptz, timestamptz, text) from public;
grant execute on function force_correct_times(uuid, date, timestamptz, timestamptz, text) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke all on function force_correct_times(uuid, date, timestamptz, timestamptz, text) from app_readonly';
  end if;
end $$;
