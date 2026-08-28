/* ---------------------------------------------------------------------------
   적힌 사실은 고쳐 쓰지 않는다 (적대적 감사 2026-08-28 지적 2 · 3 · 4 · 5 · 8 · 10)

   §1 은 기록이 지워지지 않는다고 말한다. 그런데 지우는 길만 막혀 있고 고쳐
   쓰는 길은 여러 곳이 열려 있었다. 감사에서 실제로 실행해 확인한 것들이다.

     · work_order.material_lot_id 를 다른 원재료 로트로 교체        열림
     · work_order.batch_no · sheet_count 사후 변경                  열림
     · product_lot.expiry_date 연장 · qty_produced 부풀리기         열림
     · record_print.data_hash 위조 · printed_by 교체                열림
     · app_user.is_developer 를 끄고 개발 계정에 QP 부여            열림

   지우는 것과 고쳐 쓰는 것의 차이는 흔적이 남느냐가 아니다. 둘 다 감사추적에
   남는다. 차이는 종이와의 관계다. 종이는 이미 발행되어 서명까지 들어갔고
   되받을 수 없다. 그 종이가 가리키는 값이 시스템에서 바뀌면 둘이 갈라지고,
   갈라진 것을 아무도 눈치채지 못한다.

   ── 이것이 §1 의 "차단은 다섯 개뿐" 을 늘리는 것인가 ──────────────────────
   아니다. 여기 있는 어느 것도 GMP 판정을 하지 않는다. 적합인지 부적합인지,
   수량이 맞는지 틀리는지 묻지 않는다. 묻는 것은 하나다 - 이미 적힌 사실을
   없던 일로 만들고 있는가.

   정상 작업은 하나도 막히지 않는다. 발행 직후의 오기 정정은 열려 있고
   (기록이 붙기 전까지), 수량 조정은 사유가 남는 경로가 따로 있으며
   (stock_movement · product_nonconformity), 인쇄물 회수도 그대로 돈다.
   막히는 것은 이미 일어난 일을 되돌리는 조작뿐이다.

   ── 어디에 거는가 ─────────────────────────────────────────────────────────
   전부 DB 트리거다. 응용에서만 막은 것은 검증이 아니다 (§1). 실제로 감사에서
   응용을 건너뛰고 SQL 을 직접 던져 뚫었던 자리들이다.
--------------------------------------------------------------------------- */


/* === 1. 개발 계정 표시는 되돌릴 수 없다 (지적 5) ========================== */
/*
 * trg_no_dev_qp 는 is_developer 를 보고 QP 부여를 막는데, 그 플래그 자체를
 * 끌 수 있어서 두 단계면 통과했다. 표시를 끄는 길을 막아 한 단계짜리로
 * 되돌린다. 개발 계정이었던 사실은 그 계정이 살아 있는 동안 사라지지 않는다.
 *
 * 켜는 것은 열려 있다. 개발자에게 계정을 새로 내줄 때 필요하다.
 */
create or replace function trg_dev_flag_sticky()
returns trigger language plpgsql as $fn$
begin
  if old.is_developer and not new.is_developer then
    raise exception '개발 계정 표시는 해제할 수 없습니다. 계정을 비활성화하십시오';
  end if;
  return new;
end $fn$;

drop trigger if exists app_user_dev_sticky on app_user;
create trigger app_user_dev_sticky before update of is_developer on app_user
  for each row execute function trg_dev_flag_sticky();


/* === 2. 인쇄 기록은 회수 외에 고칠 수 없다 (지적 2) ====================== */
/*
 * data_hash 는 손에 든 종이와 시스템을 잇는 유일한 고리다. 그 값을 고쳐 쓸 수
 * 있으면 고리가 아니라 장식이다. 인쇄자 · 회차 · 인쇄 시각도 같다.
 *
 * retrieve_print() 가 쓰는 retrieved_at · retrieve_reason 만 열어 둔다.
 */
create or replace function trg_print_immutable()
returns trigger language plpgsql as $fn$
begin
  if new.data_hash   is distinct from old.data_hash
  or new.printed_by  is distinct from old.printed_by
  or new.printed_at  is distinct from old.printed_at
  or new.seq         is distinct from old.seq
  or new.kind        is distinct from old.kind
  or new.pages       is distinct from old.pages then
    raise exception '인쇄 기록은 고칠 수 없습니다. 회수 사유만 남길 수 있습니다';
  end if;
  return new;
end $fn$;

drop trigger if exists record_print_immutable on record_print;
create trigger record_print_immutable before update on record_print
  for each row execute function trg_print_immutable();


/* === 3. 배치의 뿌리는 기록이 붙은 뒤 바뀌지 않는다 (지적 3) ============== */
/*
 * 원재료 로트 · 배치번호 · 장입 장수는 작업지시서에 인쇄되어 현장에 나간다.
 * 종이가 나간 뒤에 이 값이 바뀌면 계보가 조용히 다른 곳을 가리킨다.
 *
 * "기록이 붙었는가" 를 기준으로 삼는다. 발행 직후 오기를 발견해 고치는 것은
 * 정상 작업이고, 그때는 아직 종이도 기록도 없다. 인쇄되었거나 공정 기록이
 * 한 건이라도 있으면 그 순간부터 잠근다.
 */
create or replace function trg_wo_root_immutable()
returns trigger language plpgsql as $fn$
declare v_locked boolean;
begin
  if new.material_lot_id is not distinct from old.material_lot_id
 and new.batch_no        is not distinct from old.batch_no
 and new.wo_no           is not distinct from old.wo_no
 and new.sheet_count     is not distinct from old.sheet_count
 and new.device_master_id is not distinct from old.device_master_id
 and new.dmr_revision    is not distinct from old.dmr_revision then
    return new;                                   -- 뿌리는 그대로다
  end if;

  select exists (select 1 from process_record where work_order_id = old.id)
      or exists (select 1 from record_print   where work_order_id = old.id)
      or exists (select 1 from product_lot    where work_order_id = old.id)
    into v_locked;

  if v_locked then
    raise exception
      '기록이나 인쇄물이 있는 작업 지시는 원재료 로트 · 배치번호 · 장입 장수를 '
      '바꿀 수 없습니다. 취소하고 다시 발행하십시오';
  end if;
  return new;
end $fn$;

drop trigger if exists work_order_root_immutable on work_order;
create trigger work_order_root_immutable before update on work_order
  for each row execute function trg_wo_root_immutable();


/* === 4. 제품 로트의 확정값은 고정이다 (지적 4) =========================== */
/*
 * §10 은 expiry_date 를 사용기간 변경 시 소급 갱신하지 말라고 명시한다.
 * 설계는 그렇게 되어 있었으나 지키는 장치가 없었다.
 *
 * 수량도 함께 잠근다. qty_available 만 열어 둔다 - 출고 · 폐기 · 시료가
 * 그 값을 정상적으로 움직이고, 그 경로에는 전부 사유가 남는다.
 */
create or replace function trg_pl_immutable()
returns trigger language plpgsql as $fn$
begin
  if new.lot_no          is distinct from old.lot_no
  or new.item_id         is distinct from old.item_id
  or new.work_order_id   is distinct from old.work_order_id
  or new.qty_produced    is distinct from old.qty_produced
  or new.qty_sample      is distinct from old.qty_sample
  or new.manufactured_on is distinct from old.manufactured_on
  or new.expiry_date     is distinct from old.expiry_date
  or new.shelf_life_ref  is distinct from old.shelf_life_ref then
    raise exception
      '제조번호 · 형명 · 생산 수량 · 제조일 · 유효기한은 재단 시점 값으로 '
      '고정됩니다. 수량 변동은 부적합이나 재고 증감으로 기록하십시오';
  end if;
  return new;
end $fn$;

drop trigger if exists product_lot_immutable on product_lot;
create trigger product_lot_immutable before update on product_lot
  for each row execute function trg_pl_immutable();


/* === 5. 작업일은 있을 수 없는 날짜를 받지 않는다 (지적 10) =============== */
/*
 * 2020년 날짜에 종료가 시작보다 빠른 기록이 그대로 들어갔다. 검토 지원이
 * 시각 모순은 표시하지만 작업일 자체가 엉뚱한 경우는 표시 대상이 아니다.
 *
 * 판정하지 않는다. 물리적으로 있을 수 없는 두 경우만 거부한다.
 *   · 작업 지시가 발행되기 전에 작업한 날
 *   · 아직 오지 않은 날
 * 어제 것을 오늘 적는 것은 정상 작업이므로 그대로 열려 있다.
 */
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
  if v_issued is not null and new.work_date < v_issued then
    raise exception '작업일이 작업 지시 발행일(%)보다 앞섭니다 (%)', v_issued, new.work_date;
  end if;
  return new;
end $fn$;

drop trigger if exists process_record_workdate on process_record;
create trigger process_record_workdate before insert or update of work_date, work_order_id
  on process_record for each row execute function trg_pr_workdate();


/* === 6. 시료 채취 기준표에도 삭제 차단을 건다 (지적 8) =================== */
/*
 * §5 는 REVOKE 와 TRIGGER 를 함께 걸라고 한다. 표 소유자는 권한 검사를
 * 우회하기 때문이다. sample_plan 은 REVOKE 만 있었다.
 */
drop trigger if exists sample_plan_no_delete on sample_plan;
create trigger sample_plan_no_delete before delete on sample_plan
  for each row execute function trg_block_delete();

drop trigger if exists sample_plan_no_truncate on sample_plan;
create trigger sample_plan_no_truncate before truncate on sample_plan
  for each statement execute function trg_block_delete();

revoke delete, truncate on sample_plan from app_role;


/* === 7. 비밀번호를 스스로 바꾸기 전에는 다른 일을 하지 않는다 ============ */
/*
 * 시드로 만든 계정과 초기화된 계정은 만든 사람이 비밀번호를 안다. 그 상태로
 * 기록을 적으면 그 기록의 귀속이 성립하지 않는다 - 누구든 그 이름으로 적을
 * 수 있었기 때문이다. 전자서명이 없는 시스템에서 귀속은 오직 로그인에 달려
 * 있으므로, 그 로그인이 남과 공유되지 않았음이 먼저다.
 *
 * 응용이 로그인 직후 비밀번호 변경 화면으로 보낸다. 여기서는 표시만 든다.
 */
alter table app_user
  add column if not exists must_change_pin boolean not null default false;

comment on column app_user.must_change_pin is
  '만든 사람이 비밀번호를 아는 상태. 본인이 바꾸기 전에는 다른 화면으로 가지 못한다';
