/* ===========================================================================
   0143 · 마감한 날로 작업일을 맞춘다 · 품목에 함께 적을 단위 (사용자 2026-11-20)

   ── 1. 공정 마감의 날짜가 작업일보다 앞서면 작업일도 그 날로 ──────────────
   "그리고 이것도 마감일자는 11월 4일로 마감됐으면 11월 4일로 표기 해줘야지."

   B261104-01 WS-01 은 11-20 에 «공정 시작» 을 눌러 작업일이 11-20 으로 들어갔고,
   종이의 종료 11-04 11:30 으로 마감했다. 현장 일차 카드 · 제조기록서는 작업일을
   보므로 11-20 이 그대로 보였다. 종이를 뒤에 옮겨 적는 현장이라, 마감 일시가
   작업일보다 앞선 날이면 그 날이 실제로 일한 날이다.

   공정 마감(complete_process_at)이 적은 종료 일시의 날(한국)이 작업일보다 앞서면
   작업일도 그 날로 바꾸고 정정 내역(record_correction · 마감 전 고침)을 남긴다.
   작업 지시 발행일보다 앞선 날로는 옮기지 않는다 (0052 그대로) - 그때는 작업일을
   두고 마감만 한다. 시작 시각은 건드리지 않는다 - 종이의 시작을 시스템이 모른다.

   ── 2. 품목에 함께 적을 단위 ──────────────────────────────────────────────
   "이거 왜 재고가 Kg 단위로 나와?"  "그럼 L 도 병용표기 해줘"

   30% 과산화수소(RM-011)는 kg 으로 사고 kg 으로 쓴다 (소요량 2.22 kg = 2 L × 비중 1.11).
   현장은 L 로 잰다. 단위를 바꾸면 입고 · 소요량 · 기록이 모두 바뀌므로 그대로 두고,
   화면 · 종이에 L 을 함께 적는다.

     alt_uom    함께 적을 단위 (예: L)
     alt_ratio  그 단위 1 이 사용 단위로 얼마인가 (예: 1 L = 1.11 kg). 함께 적는 양 =
                사용 단위 양 ÷ alt_ratio
=========================================================================== */

/* === 1. 공정 마감 ======================================================== */
create or replace function complete_process_at(p_pr uuid, p_ended timestamptz)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  r        record;
  v_day    date;
  v_issued date;
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
end $fn$;


/* === 2. 품목에 함께 적을 단위 ============================================ */
alter table item add column if not exists alt_uom text;
alter table item add column if not exists alt_ratio numeric;

alter table item drop constraint if exists item_alt_uom_check;
alter table item add constraint item_alt_uom_check check (
  (alt_uom is null and alt_ratio is null)
  or (btrim(alt_uom) <> '' and alt_ratio > 0)
);

comment on column item.alt_uom is
  '화면 · 종이에 사용 단위와 함께 적을 단위 (예: 과산화수소 kg 옆의 L). 양은 사용 단위가 정본이다 (0143)';
comment on column item.alt_ratio is
  '함께 적을 단위 1 이 사용 단위로 얼마인가 (1 L = 1.11 kg). 함께 적는 양 = 사용 단위 양 ÷ alt_ratio (0143)';
