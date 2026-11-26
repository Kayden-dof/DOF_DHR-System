/* ===========================================================================
   0168 · 출고 검토 보강 (수주 검토 뒤 남은 것 · 사용자 2026-11-26 «이어서 고치기»)

   ── 1. 쓰지 않음으로 바꾼 형명의 재고도 출고한다 ──────────────────────────────
   ship_spec_check 의 DMR(작업지시서 제품)은 dm_models 로 봤는데, dm_models 는 쓰는 품목(is_active)만
   낸다. 형명을 쓰지 않음으로 바꾸면 그 형명의 남은 재고가 «작업지시서 제품이 다름» 으로 영영 막혔다.
   그 배치가 실제로 만든 형명(로트 형명 = 주문 형명)이면 쓰지 않는 형명이라도 그 지시 제품의 형명으로 본다 -
   재단 화면은 그때 쓰던 형명만 내놓으므로 만들 때는 그 제품의 형명이었다.

   ── 2. 출고의 제조번호는 바꾸지 않는다 ─────────────────────────────────────────
   출고 기록의 product_lot_id 를 고치면 형명 검토(shipment_order_line)도, 출하 가능 수량 셈
   (shipment_apply, insert 때만)도 건너뛴다. 잘못 고른 로트는 출고를 고치지 말고 바로잡을 출고를 다시 적는다.
   화면에는 이 길이 없다 - DB 가 막아 둔다.
=========================================================================== */

/* === 1. ship_spec_check: DMR 에 «이 배치가 만든 쓰지 않는 형명» 을 더한다 ======= */
create or replace function ship_spec_check(p_lot uuid, p_line uuid)
returns table (kind text, label text, expected text, actual text, ok boolean)
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  with x as (
    select li.id as line_item, li.code as line_code, li.is_active as line_active,
           pi.id as lot_item, pi.code as lot_code,
           wo.device_master_id as dm, coalesce(dm.product_code, di.code) as dm_code,
           nullif(btrim(coalesce(ml.thickness_band, '')), '') as band,
           model_band(li.code) as want_band
      from sales_order_line l
      join item li on li.id = l.item_id
      cross join product_lot pl
      join item pi on pi.id = pl.item_id
      join work_order wo on wo.id = pl.work_order_id
      join device_master dm on dm.id = wo.device_master_id
      join item di on di.id = dm.item_id
      join material_lot ml on ml.id = wo.material_lot_id
     where l.id = p_line and pl.id = p_lot
  )
  select 'LOT', '제품 로트 형명', line_code, lot_code, line_item = lot_item from x
  union all
  select 'DMR', '작업지시서 제품', line_code, dm_code,
         exists (select 1 from dm_models(x.dm) d where d.id = x.line_item)
         /* 쓰지 않음으로 바꾼 형명이라도 이 배치가 만든 것이면 (0168) */
         or (not x.line_active and x.line_item = x.lot_item) from x
  union all
  select 'BAND', '작업지시서 원료 두께', want_band, band,
         /* 영문 · 숫자만 견준다 - 원료 로트에 '05-10' 으로 적어도 '0510' 과 같다 */
         case when band is null or want_band is null then null
              else upper(regexp_replace(band, '[^0-9A-Za-z]', '', 'g'))
                 = upper(regexp_replace(want_band, '[^0-9A-Za-z]', '', 'g')) end from x
$fn$;
comment on function ship_spec_check(uuid, uuid) is
  '출고 전 형명 검토 (0159 · 0168). 제품 로트 형명 · 작업지시서 제품 · 원료 두께. ok 가 false 면 출고하지 않고, null 은 볼 수 없음';


/* === 2. 출고의 제조번호는 바꾸지 않는다 ===================================== */
create or replace function trg_shipment_lot_fixed()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
begin
  if new.product_lot_id is distinct from old.product_lot_id then
    raise exception '출고의 제조번호는 바꾸지 않습니다. 잘못 고른 로트면 바로잡을 출고를 다시 적으십시오';
  end if;
  return new;
end $fn$;
comment on function trg_shipment_lot_fixed() is
  '출고의 제조번호(product_lot_id)를 고쳐 쓰지 않는다 - 형명 검토 · 출하 가능 수량 셈을 건너뛰는 길 (0168)';

drop trigger if exists shipment_lot_fixed on shipment;
create trigger shipment_lot_fixed before update of product_lot_id on shipment
  for each row execute function trg_shipment_lot_fixed();
