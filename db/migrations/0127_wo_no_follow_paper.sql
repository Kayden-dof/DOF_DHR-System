/* ===========================================================================
   0127 · 지시서 번호는 종이 번호에 맞춰 고칠 수 있다 (사용자 2026-11-09)

   "작업 지시번호는 WO-261103-01 임."

   종이 작업요청 및 지시서가 먼저 나가고(11-03 승인) DHR 에는 뒤에 옮겨 적었다.
   채번 규칙이 오늘 날짜로 WO-261109-01 을 매겼는데 종이에는 WO-261103-01 이
   적혀 있다. 종이 라벨 번호를 따르는 자재 로트(c35eeb8)와 같은 원칙이다 -
   종이가 먼저다.

   0052 는 기록이 붙은 작업 지시의 뿌리(원재료 로트 · 배치번호 · 장입 장수 ·
   지시서 번호 · 표준서)를 잠갔다. 여기서는 **지시서 번호만** 푼다. 계보는
   id 로 이어지므로 번호를 바꿔도 기록이 다른 곳을 가리키지 않고, 바꾼 사실과
   사유는 감사추적에 이전 값과 함께 남는다 (0124 «규정 때문에 막힌 것은 풀고
   Log 는 남긴다»). 나머지 뿌리는 그대로 잠근다.
=========================================================================== */

create or replace function trg_wo_root_immutable()
returns trigger language plpgsql as $fn$
declare v_locked boolean;
begin
  if new.material_lot_id is not distinct from old.material_lot_id
 and new.batch_no        is not distinct from old.batch_no
 and new.sheet_count     is not distinct from old.sheet_count
 and new.device_master_id is not distinct from old.device_master_id
 and new.dmr_revision    is not distinct from old.dmr_revision then
    return new;                                   -- 뿌리는 그대로다 (지시서 번호는 0127 부터 열림)
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
