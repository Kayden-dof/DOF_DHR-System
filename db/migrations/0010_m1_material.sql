-- =============================================================================
-- 0010_m1_material.sql  ·  발주 · 자재 로트
-- 근거: CLAUDE.md §4.4, §2 (S01, S02)
-- 범위: M1
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'material_status') then
    create type material_status as enum ('AVAILABLE','CONSUMED','EXPIRED','DISPOSED');
  end if;
end $$;

create table if not exists purchase_order (
  id          uuid primary key default gen_random_uuid(),
  po_no       text not null unique,
  item_id     uuid not null references item(id),
  supplier_id uuid not null references supplier(id),
  qty         numeric not null check (qty > 0),      -- usage_uom 기준 (§4.2)
  unit_price  numeric,
  ordered_at  date not null,
  expected_at date,
  status      text not null default 'ORDERED',   -- ORDERED/RECEIVED/CANCELLED
  ordered_by  uuid not null references app_user(id)
);
create index if not exists purchase_order_item_status_idx
  on purchase_order (item_id, status);

-- -----------------------------------------------------------------------------
-- 자재 로트
--
--   S01  자재 로트번호 공란 저장 불가   lot_no not null unique
--   S02  자재 등록 시 성적서 번호 필수  coa_no not null
--
-- 재고·불출·단가는 전부 usage_uom 기준이다 (§4.2). 입고 등록 화면에서만 구매
-- 단위를 받아 item.conversion으로 환산해 넣는다.
--
-- thickness_band는 원재료(RM-006)일 때만 채운다. 두께가 입고 시 결정되므로
-- 여기서 받아 배치를 거쳐 product_lot으로 상속된다 (§4.4).
-- -----------------------------------------------------------------------------
create table if not exists material_lot (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references item(id),
  lot_no            text not null unique,      -- 사내 로트번호. 바코드 값
  supplier_id       uuid not null references supplier(id),
  supplier_lot_no   text not null,
  purchase_order_id uuid references purchase_order(id),   -- 널 허용. 느슨한 연결
  coa_no            text not null,             -- S02
  coa_date          date not null,
  received_at       timestamptz not null,
  registered_by     uuid not null references app_user(id),
  qty_received      numeric not null check (qty_received > 0),
  qty_available     numeric not null check (qty_available >= 0),
  unit_price        numeric,                   -- 로트별 매입 단가. 공급가액
  status            material_status not null default 'AVAILABLE',
  expiry_date       date,
  location          text,
  thickness_band    text                       -- 원재료일 때. 예 '0510'
);
create index if not exists material_lot_item_status_idx on material_lot (item_id, status);
create index if not exists material_lot_expiry_idx on material_lot (expiry_date)
  where status = 'AVAILABLE';

-- S02를 빈 문자열로 우회하지 못하게 한다. not null만으로는 ''가 통과한다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'material_lot_coa_no_not_blank') then
    alter table material_lot
      add constraint material_lot_coa_no_not_blank check (btrim(coa_no) <> '');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'material_lot_lot_no_not_blank') then
    alter table material_lot
      add constraint material_lot_lot_no_not_blank check (btrim(lot_no) <> '');
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 유효기한 경과 처리 (§6)
--   "유효기한은 일 1회 배치로 자재는 EXPIRED"
-- 판정이 아니라 날짜 비교다. 남은 수량은 건드리지 않는다.
-- -----------------------------------------------------------------------------
create or replace function expire_material_lots()
returns int language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare n int;
begin
  update material_lot
     set status = 'EXPIRED'
   where status = 'AVAILABLE'
     and expiry_date is not null
     and expiry_date < (timezone('Asia/Seoul', now()))::date;
  get diagnostics n = row_count;
  return n;
end $fn$;
