/* ===========================================================================
   0141 · 작업 지시 발행 일시를 종이 지시서에 맞춘다 (사용자 2026-11-20)

   "작업 지시서 날짜가 왜 11월 9일이지?? 1103 이면 11월 3일이 작업지시서
    발행일인데.. 작업지시서 날짜 강제 수정 요청"
   "이부분 수정 가능하도록 기능 부여할것."
   "보통은 내가 작업 지시서를 받으면 바로 입력할거거든? 근데 이번거는 강제로
    입력하면서 입력날자가 뒤틀린거 같다."

   발행 일시(issued_at)는 DHR 에 입력한 순간이다. 받는 날 바로 입력하면 그것이
   곧 발행일이다. WO-261103-01 은 종이 지시서가 11-03 에 승인되고 DHR 에는
   11-09 에 옮겨 적어서, 화면과 종이에 11-09 가 발행일로 찍혔다. 지시서 번호
   (0127) · 배치번호 (0131) 와 같은 원칙이다 - 종이가 먼저다.

   ── 누가 · 어떻게 ────────────────────────────────────────────────────────
   예외 정정이다. 시스템관리자만, 까닭을 적고 고친다 (강제 정정 0128 · 0131 과
   같은 급). 이전 값과 까닭은 감사추적에 남는다 (work_order 는 0017 부터 감사
   대상이다).

   ── 막는 것 ─────────────────────────────────────────────────────────────
   · 미래 일시.
   · 이미 적힌 작업일보다 늦은 발행일. 작업일이 발행일보다 앞서지 못하는
     규칙(0052)을 거꾸로 깨는 길이 된다. 당기는 것은 언제나 된다.

   응용 역할(app_role · app_readonly)로 고칠 때만 묻는다. 소유자(이관 · 시험의
   준비 단계)는 지금처럼 지나간다 - 0131 의 작업일 규칙과 같은 갈래.
=========================================================================== */

create or replace function trg_wo_issued_fix()
returns trigger language plpgsql as $fn$
declare
  v_first date;
  v_new   date := (new.issued_at at time zone 'Asia/Seoul')::date;
begin
  if new.issued_at is not distinct from old.issued_at then
    return new;
  end if;
  if current_user not in ('app_role', 'app_readonly') then
    return new;
  end if;

  if not has_role('SYS_ADMIN') then
    raise exception '작업 지시 발행 일시는 시스템관리자만 고칠 수 있습니다';
  end if;
  if coalesce(btrim(current_setting('app.change_reason', true)), '') = '' then
    raise exception '발행 일시를 고치려면 까닭을 적으십시오';
  end if;
  if new.issued_at > now() then
    raise exception '발행 일시가 아직 오지 않은 때입니다 (%)',
      to_char(new.issued_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
  end if;

  select min(work_date) into v_first from process_record where work_order_id = new.id;
  if v_first is not null and v_new > v_first then
    raise exception '발행일(%)이 이미 적힌 작업일(%)보다 늦을 수 없습니다', v_new, v_first;
  end if;
  return new;
end $fn$;

drop trigger if exists work_order_issued_fix on work_order;
create trigger work_order_issued_fix before update of issued_at on work_order
  for each row execute function trg_wo_issued_fix();
