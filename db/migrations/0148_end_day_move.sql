/* ===========================================================================
   0148 · 여러 날 공정은 마감하면 끝나는 일차로 간다 (사용자 2026-11-20)

   "재단은 11월 10일날 이루어졌고, 11월7일부터 5일차 6일차 동결건조 대기였단말임?
    동결건조 마감일이 11월 10일날 마감됐으면 그 사이 일자는 그냥 쭉 다 패싱하게끔
    일차 표기가 되는 기능이 필요할듯"

   B261104-01 동결건조는 4일차(11-07 20:50)에 시작해 11-10 10:00 에 끝났는데 4일차에 남았고,
   11-10 재단도 4일차로 들어갔다. 일차 카드는 4일차에서 끝나 5 · 6일차(동결건조가 이어진 날)와
   7일차(11-10)가 없었다.

   공정 마감(complete_process_at)의 종료 날(한국)이 작업일보다 뒤면, 그 기록을 끝나는 일차로
   옮긴다 - 사용자가 고른 규칙 «끝나는 일차로» (0146 · 0147) 를 마감이 스스로 한다.
     옮길 일차  그 날짜로 이미 선 뒤 일차가 있으면 그 일차, 없으면 일차 + (종료일 - 작업일)
     작업일     종료일
   그 사이 날은 따로 적힌 기록이 없어도 일차다 - 현장 일차 카드가 «이어진 공정» 으로 세운다 (0147).
   지금 일차나 옮길 일차가 이미 마감(잠금)되었으면 옮기지 않는다 - 잠금은 풀지 않는다.
   일차 · 작업일 정정 내역(record_correction · 마감 전 고침)을 남긴다.

   본문은 0143 의 것이고, 끝의 «끝나는 일차로» 한 덩이가 늘었다.
=========================================================================== */

create or replace function complete_process_at(p_pr uuid, p_ended timestamptz)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  r        record;
  v_day    date;
  v_issued date;
  v_to     int;
begin
  if p_ended is not null then
    select pr.started_at, pr.ended_at, pr.work_date,
           (w.issued_at at time zone 'Asia/Seoul')::date as issued
      into r
      from process_record pr join work_order w on w.id = pr.work_order_id
     where pr.id = p_pr for update of pr;
    if not found then
      raise exception '공정 기록을 찾을 수 없습니다';
    end if;
    if r.ended_at is null then
      if p_ended > now() + interval '1 minute' then
        raise exception '아직 오지 않은 시각입니다';
      end if;
      /* 시작보다 앞선 종료도 받는다 (0142) - 시작 시각은 뒤에 고친다 */
      update process_record set ended_at = p_ended where id = p_pr;

      /* 마감한 날이 작업일보다 앞서면 작업일도 그 날로 (0143). 발행일 앞으로는 옮기지 않는다 */
      v_day := (p_ended at time zone 'Asia/Seoul')::date;
      v_issued := r.issued;
      if v_day < r.work_date and (v_issued is null or v_day >= v_issued) then
        update process_record set work_date = v_day where id = p_pr;
        insert into record_correction
          (process_record_id, field, old_value, new_value, why, corrected_by, before_close)
        values
          (p_pr, 'work_date', r.work_date::text, v_day::text,
           '공정 마감 종료 일시의 날로 맞춤', current_user_id(), true);
      end if;
    end if;
  end if;
  perform complete_process(p_pr);

  /* === 끝나는 일차로 (0148) ============================================== */
  select pr.work_order_id, pr.day_no, pr.work_date, pr.worker_id,
         (timezone('Asia/Seoul', pr.ended_at))::date as end_day
    into r
    from process_record pr where pr.id = p_pr for update;
  if r.end_day is null or r.end_day <= r.work_date then
    return;
  end if;
  v_to := coalesce(
    (select min(o.day_no) from process_record o
      where o.work_order_id = r.work_order_id and o.id <> p_pr
        and o.work_date = r.end_day and o.day_no > r.day_no),
    r.day_no + (r.end_day - r.work_date));
  if is_locked(r.work_order_id, r.day_no, r.worker_id)
     or is_locked(r.work_order_id, v_to, r.worker_id) then
    return;
  end if;

  perform set_config('app.change_reason', '공정 마감 · 여러 날 공정은 끝나는 일차로', true);
  update process_record set day_no = v_to, work_date = r.end_day where id = p_pr;
  insert into record_correction
    (process_record_id, field, old_value, new_value, why, corrected_by, before_close)
  values
    (p_pr, 'day_no', r.day_no::text, v_to::text,
     '여러 날 공정은 끝나는 일차로 (공정 마감)', current_user_id(), true),
    (p_pr, 'work_date', r.work_date::text, r.end_day::text,
     '여러 날 공정은 끝나는 일차로 (공정 마감)', current_user_id(), true);
end $fn$;
