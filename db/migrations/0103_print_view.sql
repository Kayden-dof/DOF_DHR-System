-- ---------------------------------------------------------------------------
-- 나간 종이를 다시 열 수 있게 한다 (사용자 요청 2026-09-08)
--
-- "작성했던 문서를 다시 볼 수 있게끔은 기능 구현이 안 되나?"
--
-- 안 되고 있었다. 이 시스템에서 **인쇄 화면을 여는 것이 곧 발행**이라
-- (lib/print.ts), 지난 배치의 편철 표지를 확인만 하려 해도 열면 회차가 오르고
-- 앞 종이가 회수 대상이 되었다. 제조기록서는 여는 순간 그 묶음이 잠겼고,
-- 읽기 전용 세션(품질책임자 · 경영열람)은 인쇄 화면에 아예 못 들어왔다 -
-- **종이에 이름이 오르는 사람이 그 종이를 시스템에서 볼 수 없었다.**
--
-- 열람은 대장에 아무것도 쓰지 않는다. 그러므로 여기서 여는 것은 조회 하나다.
--
-- ── 뷰가 작업자 식별자를 안 내고 있었다 ─────────────────────────────────
-- 제조기록서를 다시 열려면 주소가 `(배치, 일차, 작업자)` 셋을 다 알아야 한다.
-- 잠금 키가 그 셋이기 때문이다 (§4.9). 그런데 조회 뷰는 작업자를 **이름으로만**
-- 냈다. 이름은 주소가 되지 못하고, 동명이인이면 가리키지도 못한다.
--
-- 화면이 record_print 를 따로 다시 읽어 채우는 길도 있었다. 두지 않는다 -
-- 인쇄 이력을 읽는 자리가 둘이 되면 갈라진다 (§10). 뷰가 내게 한다.
--
-- create or replace view 는 열을 **끝에 덧붙이는 것만** 허용하므로 (0028 이
-- 같은 이유로 설비 세 열을 끝에 달았다) 기존 순서를 그대로 두고 끝에 단다.
--
-- ── 열람도 읽기 전용 역할이 볼 수 있어야 한다 ───────────────────────────
-- 0028 은 app_role 에만 열어 두었다. 품질책임자와 경영열람은 app_readonly 로
-- 도는데 (0043), 그들이 열람의 주된 사용자다.
-- ---------------------------------------------------------------------------

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
       eq.name                             as equipment_name,
       /* 여기부터 0103. 제조기록서를 다시 열 주소를 세우는 데 쓴다 */
       rp.worker_id
  from record_print rp
  join app_user u on u.id = rp.printed_by
  left join work_order wo   on wo.id = rp.work_order_id
  left join product_lot pl  on pl.id = rp.product_lot_id
  left join material_lot ml on ml.id = rp.material_lot_id
  left join app_user w      on w.id  = rp.worker_id
  left join equipment eq    on eq.id = rp.equipment_id;

grant select on v_print_lookup to app_role, app_readonly;

comment on view v_print_lookup is
  '인쇄 대장 조회. 열람 주소를 세우는 데 필요한 대상 식별자를 함께 낸다 (0103)';
