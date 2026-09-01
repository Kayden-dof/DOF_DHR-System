-- ---------------------------------------------------------------------------
-- 감사추적 한 줄 (사용자 요청 2026-09-01)
--
-- 현황 화면의 "최근 활동" 을 감사추적 화면과 같은 모양으로 낸다. 그러려면 같은
-- 자료가 필요한데, 감사추적 화면의 조회에는 **사람이 아는 번호를 찾아내는
-- 30줄짜리 coalesce** 가 들어 있다 - 로트번호 · 배치번호 · 지시서 번호를 차례로
-- 뒤지고, 제 번호가 없는 표(인쇄 · 잠금 · 공정 기록)는 가리키는 쪽을 따라간다.
--
-- 그것을 두 화면에 복제하면 갈라진다 (§10). 규격 문구가 한때 두 곳에서 갈려
-- 10배 틀린 치수가 종이로 나간 적이 있다 (0057). 같은 실수를 되풀이하지 않는다.
--
-- 뷰는 자료를 만들지 않는다. 있는 자료를 화면이 읽을 모양으로 낼 뿐이다.
-- 비밀은 여기서 이미 떼어 낸다 - 서버가 넘긴 값은 이미 브라우저에 도착해 있어,
-- 가리는 자리는 화면이 아니라 조회다 (§10 · 0060).
-- ---------------------------------------------------------------------------

create or replace view v_audit_entry as
select a.id,
       a.table_name,
       a.record_id,
       a.action,
       a.acted_at,
       a.reason,
       a.actor_id,
       u.full_name as actor_name,
       audit_redact(a.old_value, a.table_name) as old_value,
       audit_redact(a.new_value, a.table_name) as new_value,
       coalesce(
         a.new_value->>'lot_no',      a.old_value->>'lot_no',
         a.new_value->>'batch_no',    a.old_value->>'batch_no',
         a.new_value->>'wo_no',       a.old_value->>'wo_no',
         a.new_value->>'po_no',       a.old_value->>'po_no',
         a.new_value->>'code',        a.old_value->>'code',
         a.new_value->>'coa_no',      a.old_value->>'coa_no',
         a.new_value->>'login_code',  a.old_value->>'login_code',
         a.new_value->>'full_name',   a.old_value->>'full_name',
         a.new_value->>'name',        a.old_value->>'name',
         -- 제 번호가 없는 표(인쇄 · 잠금 · 공정 기록 · 자재 투입 · 재고 증감)는
         -- 가리키는 쪽의 번호를 따라간다. 그게 사람이 아는 값이다
         (select wo.batch_no from work_order wo
           where wo.id = coalesce(a.new_value->>'work_order_id',
                                  a.old_value->>'work_order_id')::uuid),
         (select pl.lot_no from product_lot pl
           where pl.id = coalesce(a.new_value->>'product_lot_id',
                                  a.old_value->>'product_lot_id')::uuid),
         (select ml.lot_no from material_lot ml
           where ml.id = coalesce(a.new_value->>'material_lot_id',
                                  a.old_value->>'material_lot_id')::uuid),
         (select wo.batch_no from process_record pr
            join work_order wo on wo.id = pr.work_order_id
           where pr.id = coalesce(a.new_value->>'process_record_id',
                                  a.old_value->>'process_record_id')::uuid)
       ) as label
  from audit_log a
  left join app_user u on u.id = a.actor_id;

comment on view v_audit_entry is
  '감사추적 한 줄. 비밀은 떼어 내고 사람이 아는 번호를 붙인다. 화면이 각자 찾지 않는다';

grant select on v_audit_entry to app_role, app_readonly;
