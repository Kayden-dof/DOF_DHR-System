/* ===========================================================================
   0140 · 제조기록서 서명 칸(작업(검사)자 · 일자)을 고친다 (사용자 2026-11-20)

   "이부분도 수정 가능하도록 열어주세요. 대신 다른 계정이 수정하거나, 날짜가
    다른 경우에는 사유를 적도록 해주시고."

   서명 칸은 시스템이 채운다 (lib/br-form.ts). 사람이 적은 줄은 적은 계정 ·
   적은 날, 자재 줄은 그 기록의 작업자 · 작업일이다. 종이를 나중에 옮겨 적는
   현장에서는 적은 날이 실제 작업한 날과 다르다 - B261104-01 의 2일차(작업일
   11-05) 칸이 11-20 에 적혀 서명 일자가 11-20 으로 찍혔다.

   ── 무엇을 담는가 ────────────────────────────────────────────────────────
   서명 칸도 다른 칸처럼 칸 자리(field)로 br_entry 에 한 줄이다. sign 이 그 줄이
   서명 칸인지 말한다 (worker = 작업(검사)자 · date = 일자). 값을 비우면 시스템이
   채우는 값으로 돌아간다. 사유는 why 에, 감사추적에는 화면이 넘긴 사유가 남는다.

   ── 사유를 받는 때 (사용자 결정 2026-11-20 · 권고안) ────────────────────
     · 그 공정 기록의 작업자가 아닌 계정이 고칠 때
     · 일자를 그 기록의 작업일과 다른 날로 할 때
   작업자 본인이 작업일로 맞추는 것은 사유 없이 된다 - 종이를 옮겨 적는 일이다.
   시스템 값으로 되돌리는 것(빈 값)은 사유를 묻지 않는다.

   ── 일자 규칙 ───────────────────────────────────────────────────────────
   아직 오지 않은 날은 막는다. 작업 지시 발행일보다 앞선 날은 막지 않는다 -
   시스템 발행보다 종이 작업이 먼저인 배치가 있고(B261104-01: 발행 11-09 ·
   작업일 11-04), 그 작업일로 맞추는 서명을 막으면 고칠 길이 없다. 작업일과
   다르면 사유가 붙으므로 근거는 남는다.

   ── 작업(검사)자 ────────────────────────────────────────────────────────
   사용 중인 계정의 이름으로만 고른다 (사용자 결정 2026-11-20 · 권고안).

   ── 닿지 않는 규칙 ──────────────────────────────────────────────────────
   잠긴 일차는 그대로 막힌다 (S04 · br_entry_s04). 누가 적을 수 있는지는 0132 의
   br_entry_who 가 그대로 정한다 (그 기록의 작업자 · 순환자 · 생산관리자 ·
   시스템관리자). 지우지 않는다.
=========================================================================== */

alter table br_entry add column if not exists sign text;
alter table br_entry drop constraint if exists br_entry_sign_check;
alter table br_entry add constraint br_entry_sign_check
  check (sign is null or sign in ('worker', 'date'));
alter table br_entry add column if not exists why text;

comment on column br_entry.sign is
  '서명 칸이면 그 종류 (worker = 작업(검사)자 · date = 일자). 보통 칸은 비어 있다 (0140)';
comment on column br_entry.why is
  '서명 칸을 고친 사유. 기록한 작업자가 아닌 계정이 고치거나 일자가 작업일과 다르면 반드시 있다 (0140)';


create or replace function trg_br_entry_sign()
returns trigger language plpgsql as $fn$
declare
  v_actor uuid := current_user_id();
  v_why   text := btrim(coalesce(new.why, ''));
  v_day   date;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  r       record;
begin
  if tg_op = 'UPDATE' and old.sign is not null and new.sign is distinct from old.sign then
    raise exception '서명 칸의 종류는 바꿀 수 없습니다';
  end if;
  if new.sign is null then
    return new;
  end if;

  new.why := nullif(v_why, '');
  /* 비우면 시스템이 채우는 값으로 돌아간다. 묻지 않는다 */
  if new.value = '' then
    return new;
  end if;

  select pr.worker_id, pr.work_date into r
    from process_record pr where pr.id = new.process_record_id;

  if new.sign = 'date' then
    if new.value !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception '일자는 YYYY-MM-DD 로 적습니다';
    end if;
    begin
      v_day := new.value::date;
    exception when others then
      raise exception '없는 날짜입니다 (%)', new.value;
    end;
    if v_day > v_today then
      raise exception '아직 오지 않은 날입니다 (%)', new.value;
    end if;
  else
    if not exists (select 1 from app_user where full_name = new.value and is_active) then
      raise exception '작업(검사)자는 사용 중인 계정의 이름으로 고릅니다';
    end if;
  end if;

  if v_why = '' then
    if v_actor is distinct from r.worker_id then
      raise exception '기록한 작업자가 아닌 계정이 고칩니다. 사유를 적으십시오';
    end if;
    if new.sign = 'date' and v_day <> r.work_date then
      raise exception '작업일(%)과 다른 날입니다. 사유를 적으십시오', r.work_date;
    end if;
  end if;
  return new;
end $fn$;

/*
 * 이름이 br_entry_who 뒤에 오게 한다. 같은 때의 트리거는 이름 차례로 돈다 - 적을
 * 권한이 없는 계정에게 "사유를 적으십시오" 가 먼저 나가면 안 된다.
 */
drop trigger if exists br_entry_who_sign on br_entry;
create trigger br_entry_who_sign before insert or update
  on br_entry for each row execute function trg_br_entry_sign();
