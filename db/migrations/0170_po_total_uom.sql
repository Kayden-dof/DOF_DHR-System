/* ===========================================================================
   0170 · 발주 총액 · 발주 단위 (사용자 2026-11-26 «발주 총액을 입력하게 해 주고, 수량 (EA) 단위로
   고정하지 말고, 수량 단위를 내가 지정할 수 있도록 열어줄 것»)

   견적서는 «메디포젠 단상자 5,000개 5,980,000 + 포장박스 및 운송 380,000 = 6,360,000 (부가세 별도)»
   처럼 총액으로 온다. 발주는 단가 칸만 있어 총액을 적을 자리가 없었고, 수량은 늘 사용 단위(EA)였다.

   ── 무엇을 더하나 ─────────────────────────────────────────────────────────
     total_amount  발주 총액 (원 · 부가세 별도 · 운송비 등 포함 그대로)
     order_qty     발주서에 적은 수량 (발주 단위)
     order_uom     발주 단위 (BOX · 롤 · 개 …). 비면 사용 단위로 낸 발주

   ── qty 는 그대로 사용 단위다 ──────────────────────────────────────────────
   입고 누계(po_received) · 미입고 · 최소 재고선 알림은 전부 사용 단위로 센다 (0102 · §4.2).
   발주 단위로 적으면 화면이 «1 발주 단위 = 몇 사용 단위» 를 받아 qty 를 셈해 넣는다 - 셈하는 길이
   둘이 되지 않게 qty 하나로 잇는다.
=========================================================================== */

alter table purchase_order add column if not exists total_amount numeric;
alter table purchase_order add column if not exists order_qty numeric;
alter table purchase_order add column if not exists order_uom text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_order_total_amount_ck') then
    alter table purchase_order add constraint purchase_order_total_amount_ck
      check (total_amount is null or total_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_order_order_qty_ck') then
    alter table purchase_order add constraint purchase_order_order_qty_ck
      check ((order_qty is null) = (order_uom is null) and (order_qty is null or order_qty > 0));
  end if;
end $$;

comment on column purchase_order.total_amount is '발주 총액 (원 · 부가세 별도 · 운송비 등 포함 그대로) (0170)';
comment on column purchase_order.order_qty    is '발주서에 적은 수량 (발주 단위). qty 는 사용 단위로 셈한 값 (0170)';
comment on column purchase_order.order_uom    is '발주 단위. 비면 사용 단위로 낸 발주 (0170)';
