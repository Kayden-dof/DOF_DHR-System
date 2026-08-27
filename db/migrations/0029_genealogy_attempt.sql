-- =============================================================================
-- 0029_genealogy_attempt.sql  ·  계보 뷰에 일차와 회차
-- 근거: 사용자 지적 2026-08-27, CLAUDE.md §3 (after_cutting) · §8.3
-- =============================================================================
--
-- 편철 표지의 투입 자재 표에서 같은 자재 · 같은 로트 · 같은 수량 행이 여러 번
-- 나와 중복처럼 읽혔다. 실제로는 둘 다 이유가 있는 분리다.
--
--   · 재단 이후 공정은 기록이 제품 로트별로 붙는다 (§3). 합치면 어느 제품
--     로트에 들어갔는지가 사라진다 - §8.3 의 포장재 정추적이 끊긴다
--   · 같은 공정을 두 번 한 것(재세척 등)은 회차가 다른 두 번의 불출이다
--
-- 분리는 맞고, 종이가 이유를 말하지 않는 것이 문제였다. 뷰에 일차와 회차를
-- 얹어 인쇄물이 그 이유를 함께 적게 한다.
--
-- create or replace view 는 열을 끝에 덧붙이는 것만 허용한다.

create or replace view v_lot_genealogy as
select pr.work_order_id, pr.product_lot_id, wo.batch_no,
       ml.id as material_lot_id, ml.lot_no as material_lot_no,
       i.code as item_code, i.name as item_name, i.type as item_type,
       mi.qty, mi.issued_at,
       op.code as operation_code, op.name as operation_name, op.after_cutting,
       pr.day_no, pr.attempt
  from material_issue mi
  join process_record pr on pr.id = mi.process_record_id
  join work_order wo on wo.id = pr.work_order_id
  join material_lot ml on ml.id = mi.material_lot_id
  join item i on i.id = ml.item_id
  join dmr_operation op on op.id = pr.operation_id;

grant select on v_lot_genealogy to app_role;
