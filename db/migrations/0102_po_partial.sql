-- ---------------------------------------------------------------------------
-- 발주가 나눠 들어온다 (사용자 결정 2026-09-08)
--
-- "현재 발주에서 바로 입고로 넣는 흐름은 없었나?"
--
-- 잇는 길은 있었다 - 입고 등록 폼에 "연결할 발주" 고르개가 있고, 고르면
-- `material_lot.purchase_order_id` 가 붙었다. 다만 그 자리가 수량을 보지
-- 않았다.
--
--     if (po) update purchase_order set status = 'RECEIVED' where id = po;
--
-- **300개 발주에 100개만 들어와도 발주가 통째로 입고 완료가 됐다.** 그러면
-- 둘이 따라온다.
--
--   ① 두 번째 입고를 그 발주에 못 붙인다. 고르개가 `status='ORDERED'` 만
--      담으므로 첫 입고 뒤에 그 발주가 목록에서 사라진다.
--   ② 최소 재고선 알림이 남은 미입고분을 못 센다. `v_reorder_alert` 의
--      `on_order` 가 발주 수량을 통째로 세다가 0 이 되어, 200개가 아직 안
--      왔는데 발주중 수량이 없는 것으로 잡힌다. 같은 자재를 또 발주하게 된다.
--
-- ── 입고 누계를 따로 적지 않는다 ────────────────────────────────────────
-- `purchase_order` 에 `qty_received` 칸을 더하는 길도 있었다. 두지 않는다 -
-- 그 값은 이미 `material_lot.qty_received` 에 있고, 같은 것을 두 곳에 적으면
-- 갈라진다 (§10). 물어보는 함수 하나를 둔다.
--
-- ── 단위 ────────────────────────────────────────────────────────────────
-- `purchase_order.qty` 와 `material_lot.qty_received` 는 둘 다 사용 단위
-- (`usage_uom`) 다. 구매 단위는 입고 등록 화면에서만 받아 환산한다 (§4.2).
-- 그러므로 그냥 더해 견주면 된다.
--
-- ── 판정하지 않는다 ─────────────────────────────────────────────────────
-- 발주 상태는 GMP 판정이 아니다 (§4.11 의 표에도 없다). 무엇이 합격인지 묻지
-- 않고, 적힌 수량을 더해 발주 수량에 닿았는지만 본다. 차단도 하지 않는다 -
-- 발주보다 많이 들어와도 막지 않고, 화면이 경고로 짚는다 (§2).
-- ---------------------------------------------------------------------------

-- ── 그 발주로 들어온 양 ─────────────────────────────────────────────────
create or replace function po_received(p_po uuid)
returns numeric language sql stable
set search_path = public, pg_temp as $$
  select coalesce(sum(ml.qty_received), 0)
    from material_lot ml
   where ml.purchase_order_id = p_po
$$;

comment on function po_received(uuid) is
  '그 발주로 등록된 자재 로트의 입고 수량 합 (사용 단위). 따로 적지 않고 물어본다';

grant execute on function po_received(uuid) to app_role, app_readonly;


-- ── 누계가 발주 수량에 닿으면 입고 완료 ─────────────────────────────────
create or replace function sync_po_status(p_po uuid)
returns void language plpgsql
set search_path = public, pg_temp as $$
declare want text;
begin
  if p_po is null then return; end if;

  /*
   * 취소된 발주는 건드리지 않는다. 취소는 사람이 내린 결정이고, 뒤늦게 물건이
   * 들어왔다고 시스템이 그것을 되돌리지 않는다.
   */
  select case when po_received(po.id) >= po.qty then 'RECEIVED' else 'ORDERED' end
    into want
    from purchase_order po
   where po.id = p_po and po.status <> 'CANCELLED';

  if want is null then return; end if;

  /*
   * 값이 같으면 쓰지 않는다. 같은 값을 다시 써도 트리거는 UPDATE 를 잡으므로,
   * 로트를 등록할 때마다 "발주를 바꿨다" 가 감사추적에 쌓인다. 진짜 변경이
   * 그 속에 묻힌다 (§10).
   */
  update purchase_order set status = want
   where id = p_po and status is distinct from want;
end $$;

comment on function sync_po_status(uuid) is
  '입고 누계가 발주 수량에 닿았는지로 발주 상태를 맞춘다. 취소는 되돌리지 않는다';

/*
 * 쓰는 함수는 열람 역할에 열어 두지 않는다.
 *
 * security definer 가 아니라 표 권한에서 어차피 막히지만, 새로 만든 함수는
 * PUBLIC 이 부를 수 있는 것이 기본값이라 그대로 두면 IQ-14 의 누출 목록에
 * 오른다. 열어 둘 자리를 명시한다.
 */
revoke all on function sync_po_status(uuid) from public;
grant execute on function sync_po_status(uuid) to app_role;


create or replace function trg_ml_po_status()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
begin
  /* 로트가 다른 발주로 옮겨 붙었으면 양쪽을 다시 센다 */
  if tg_op = 'UPDATE' and old.purchase_order_id is distinct from new.purchase_order_id then
    perform sync_po_status(old.purchase_order_id);
  end if;
  perform sync_po_status(new.purchase_order_id);
  return null;
end $$;

drop trigger if exists material_lot_po_status on material_lot;
create trigger material_lot_po_status after insert or update
  on material_lot for each row execute function trg_ml_po_status();


-- ── 최소 재고선은 아직 안 온 만큼만 센다 ────────────────────────────────
--
-- 전에는 `sum(po.qty)` 였다. 절반 들어온 발주가 발주중에서 통째로 빠지거나
-- (RECEIVED 로 넘어가서) 통째로 남아 있거나 (ORDERED 인 채로) 둘 중 하나라,
-- 어느 쪽이든 실제로 오고 있는 양과 달랐다.
create or replace view v_reorder_alert as
with pending as (
  select po.item_id, sum(greatest(po.qty - po_received(po.id), 0)) as on_order
    from purchase_order po
   where po.status = 'ORDERED'
   group by po.item_id
)
select i.id, i.code, i.name, i.usage_uom, i.lead_days,
       coalesce(sum(ml.qty_available), 0) as on_hand,
       coalesce(max(p.on_order), 0) as on_order,
       i.min_stock, i.min_stock_auto, i.min_stock_basis
  from item i
  left join material_lot ml on ml.item_id = i.id and ml.status = 'AVAILABLE'
  left join pending p on p.item_id = i.id
 where i.is_active and i.min_stock is not null
 group by i.id
having coalesce(sum(ml.qty_available), 0) + coalesce(max(p.on_order), 0) < i.min_stock;

grant select on v_reorder_alert to app_role, app_readonly;


-- ── 이미 있는 발주를 한 번 맞춘다 ───────────────────────────────────────
--
-- 옛 코드가 수량과 상관없이 RECEIVED 로 넘겨 둔 것들이 있다. 여기서 한 번
-- 다시 센다. 값이 같은 행은 `sync_po_status` 가 건너뛰므로 감사추적에 빈
-- 변경이 쌓이지 않는다.
do $$
declare r record;
begin
  for r in select id from purchase_order where status <> 'CANCELLED' loop
    perform sync_po_status(r.id);
  end loop;
end $$;
