-- =============================================================================
-- 0012_m2_product_lot.sql  ·  제품 로트 (재단 분할)
-- 근거: CLAUDE.md §4.5, §3 (재단이 분기점)
-- 범위: M2
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pl_status') then
    create type pl_status as enum
      ('CUT','PACKED','STERILIZING','TESTED','RELEASE_APPROVED','SHIPPED','DISPOSED');
  end if;
end $$;

-- -----------------------------------------------------------------------------
--   샘플 수량이 별도 컬럼인 이유 (§4.5): WS-07에서 완제품검사 샘플을 추출하고
--   WS-09에서 파괴검사용 2ea를 멸균 박스에 동봉한다. 생산 수량과 출하 가능
--   수량이 다르다. 파괴검사 샘플은 회수되지만 복귀하지 않는다.
--
--   release_approved_by가 FK가 아니라 text인 이유: 서면 승인자 이름을 그대로
--   기록한다. 품질책임자는 시스템 계정이 없다.
-- -----------------------------------------------------------------------------
create table if not exists product_lot (
  id                uuid primary key default gen_random_uuid(),
  work_order_id     uuid not null references work_order(id),
  lot_no            text not null unique,      -- 제조번호. 재단 시 부여
  item_id           uuid not null references item(id),   -- 완제품 형명
  qty_produced      int not null check (qty_produced > 0),
  qty_sample        int not null default 0 check (qty_sample >= 0),
  qty_available     int not null check (qty_available >= 0),
  manufactured_on   date not null,
  expiry_date       date not null,             -- 생성 시점 고정
  shelf_life_ref    uuid references shelf_life_history(id),
  status            pl_status not null default 'CUT',
  location          text,
  release_approved_by   text,                  -- 서면 승인자 이름
  release_approved_on   date,                  -- 서면 승인 일자
  registered_by     uuid not null references app_user(id),
  check (qty_available <= qty_produced - qty_sample)
);
create index if not exists product_lot_item_status_idx on product_lot (item_id, status);
create index if not exists product_lot_expiry_idx on product_lot (expiry_date);
create index if not exists product_lot_wo_idx on product_lot (work_order_id);

-- 한 배치에서 같은 형명이 두 번 나오지 않는다. 재단은 형명별로 한 번 가른다.
create unique index if not exists product_lot_wo_item_uniq
  on product_lot (work_order_id, item_id);


-- -----------------------------------------------------------------------------
-- 재단 분할 (§3 "재단에서 형명별로 분할 · 제조번호 부여")
--
-- 제조번호는 반드시 next_number()를 경유한다 (§10). 응용에서 조합하지 않는다.
-- 유효기한은 생성 시점 값으로 고정하고 참조한 이력 행도 함께 남긴다 (§4.2).
-- 나중에 사용기간이 바뀌어도 기존 로트에 소급되지 않는다.
-- -----------------------------------------------------------------------------
create or replace function cut_product_lot(
  p_work_order uuid,
  p_item       uuid,
  p_produced   int,
  p_sample     int,
  p_on         date default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_on      date := coalesce(p_on, (timezone('Asia/Seoul', now()))::date);
  v_lot_no  text;
  v_months  int;
  v_ref     uuid;
  v_id      uuid;
  v_actor   uuid := current_user_id();
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;

  select months, ref_id into v_months, v_ref from shelf_life_at(p_item, v_on);

  v_lot_no := next_number('PRODUCT_LOT', p_item);

  insert into product_lot (
    work_order_id, lot_no, item_id, qty_produced, qty_sample, qty_available,
    manufactured_on, expiry_date, shelf_life_ref, registered_by)
  values (
    p_work_order, v_lot_no, p_item, p_produced, p_sample, p_produced - p_sample,
    v_on, (v_on + make_interval(months => v_months))::date, v_ref, v_actor)
  returning id into v_id;

  update work_order set status = 'CUT'
   where id = p_work_order and status in ('ISSUED','IN_PROCESS');

  return v_id;
end $fn$;
