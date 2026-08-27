-- =============================================================================
-- 0028_print_lookup_equipment.sql  ·  인쇄물 조회가 설비 기록지를 알게 한다
-- 근거: 0027 (EQUIPMENT_LOG), §7 인쇄물 통제
-- =============================================================================
--
-- 설비 사용 기록에도 자료 식별자와 회차가 찍히는데, 조회 뷰가 설비 열을 몰라서
-- 두 가지가 어긋나 있었다.
--
--   1) 식별자를 넣어도 "어느 설비의 기록지"인지 말하지 못했다
--   2) 재발행 판정(newer_count · latest_seq)의 묶음 식별에 설비가 빠져,
--      서로 다른 설비의 기록지끼리 같은 묶음으로 묶였다. CT-01 1회차가
--      FD-01 2회차를 "이 뒤에 다시 뽑은 회차"로 세는 셈이다. 발행 회차
--      (record_print_log)는 0027 부터 설비별로 세므로 조회만 어긋난 상태였다.
--
-- create or replace view 는 열을 끝에 덧붙이는 것만 허용하므로 기존 열 순서를
-- 그대로 두고 설비 세 열을 끝에 단다.

create or replace view v_print_lookup as
select rp.id,
       rp.kind::text                       as kind,
       lower(left(rp.data_hash, 12))       as short_hash,
       rp.data_hash,
       rp.seq,
       rp.pages,
       rp.printed_at,
       rp.retrieved_at,
       rp.retrieve_reason,
       u.full_name                         as printed_by_name,
       rp.work_order_id,
       wo.batch_no,
       wo.wo_no,
       rp.day_no,
       w.full_name                         as worker_name,
       rp.product_lot_id,
       pl.lot_no                           as product_lot_no,
       rp.material_lot_id,
       ml.lot_no                           as material_lot_no,
       (select count(*)::int from record_print n
         where n.kind = rp.kind
           and n.work_order_id   is not distinct from rp.work_order_id
           and n.product_lot_id  is not distinct from rp.product_lot_id
           and n.day_no          is not distinct from rp.day_no
           and n.worker_id       is not distinct from rp.worker_id
           and n.material_lot_id is not distinct from rp.material_lot_id
           and n.equipment_id    is not distinct from rp.equipment_id
           and n.seq > rp.seq)              as newer_count,
       (select max(n.seq) from record_print n
         where n.kind = rp.kind
           and n.work_order_id   is not distinct from rp.work_order_id
           and n.product_lot_id  is not distinct from rp.product_lot_id
           and n.day_no          is not distinct from rp.day_no
           and n.worker_id       is not distinct from rp.worker_id
           and n.material_lot_id is not distinct from rp.material_lot_id
           and n.equipment_id    is not distinct from rp.equipment_id) as latest_seq,
       rp.equipment_id,
       eq.code                             as equipment_code,
       eq.name                             as equipment_name
  from record_print rp
  join app_user u on u.id = rp.printed_by
  left join work_order wo   on wo.id = rp.work_order_id
  left join product_lot pl  on pl.id = rp.product_lot_id
  left join material_lot ml on ml.id = rp.material_lot_id
  left join app_user w      on w.id  = rp.worker_id
  left join equipment eq    on eq.id = rp.equipment_id;

grant select on v_print_lookup to app_role;
