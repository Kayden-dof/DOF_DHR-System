-- ---------------------------------------------------------------------------
-- 자재 로트의 오기를 고칠 수 있게 한다 (5차 감사 A1 · 사용자 결정 2026-09-02)
--
-- `material_lot_coa_once` 가 여덟 열을 한 번 적으면 못 고치게 막고 있었다.
--
--   lot_no · coa_no · coa_date · supplier_lot_no · supplier_id · item_id ·
--   qty_received · thickness_band
--
-- 그리고 화면에는 고치는 자리가 아예 없었다 - 입고 등록이 유일한 입구이고
-- 출구가 없었다. 둘이 겹쳐서 **입고 등록에서 한 글자를 틀리면 영구히
-- 되돌릴 수 없었다.**
--
-- 무거운 이유는 두 값 때문이다. 성적서 번호는 서면 성적서와 시스템을 잇는
-- 유일한 고리이고(§11 · S02), 공급자 로트번호는 동물유래물질 추적의 고리다.
-- 한 글자가 틀리면 계보가 존재하지 않는 종이를 가리킨다. 현장의 유일한
-- 대처는 같은 자재를 다른 로트번호로 다시 등록하는 것이었고, 그러면 재고가
-- 둘로 갈라지고 틀린 로트는 지울 수 없어(S03) 영구히 남는다.
--
-- ── 무엇을 열고 무엇을 남기는가 ────────────────────────────────────────
--   연다   coa_no · coa_date · supplier_lot_no · thickness_band
--          (expiry_date · location · unit_price 는 원래 잠기지 않았다.
--           화면만 없었을 뿐이다)
--   남긴다 lot_no · item_id · supplier_id · qty_received
--
-- 남기는 넷의 이유가 각각 다르다.
--   lot_no        바코드로 자재 라벨에 이미 나갔고 계보가 이 값으로 걸린다
--   item_id       무엇이 들어갔는지가 바뀌면 그 로트를 투입한 배치의 계보가
--                 통째로 뒤집힌다
--   supplier_id   어디서 왔는지다. 성적서 · 승인 상태가 여기 매여 있다
--   qty_received  재고 원장의 출발점이다. 수량 정정은 stock_movement 로 한다
--
-- 판정하지 않는다. 무엇이 옳은 성적서 번호인지 정하지 않고, 고쳐 쓸 자리를
-- 낼 뿐이다. 왜 고쳤는지는 화면이 받아 `audit_log.reason` 에 남기고 이전
-- 값은 감사추적에 그대로 있다 (§5).
-- ---------------------------------------------------------------------------

drop trigger if exists material_lot_coa_once on material_lot;
create trigger material_lot_coa_once before update
  on material_lot for each row
  execute function trg_once_written('lot_no', 'item_id', 'supplier_id', 'qty_received');

comment on trigger material_lot_coa_once on material_lot is
  '고쳐 쓰면 계보가 뒤집히는 넷만 잠근다. 성적서 번호 · 공급자 로트번호 · '
  '두께 구간은 오기 정정이 정상 작업이다 (5차 감사 A1)';
