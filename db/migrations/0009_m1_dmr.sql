-- =============================================================================
-- 0009_m1_dmr.sql  ·  제품표준서 · 자재 구성표
-- 근거: CLAUDE.md §4.3, §5 소요량 계산
-- 범위: M1
-- =============================================================================

create table if not exists device_master (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references item(id),
  revision       text not null,               -- 서면 제품표준서 개정 표기
  status         text not null default 'DRAFT',
  effective_from date,
  verified_by    uuid references app_user(id),   -- 구조화 입력분 대조 확인자
  verified_at    timestamptz,
  unique (item_id, revision)
);

-- -----------------------------------------------------------------------------
-- after_cutting이 구조의 중심이다 (§4.3).
--   false면 공정 기록이 work_order에 붙고, true면 product_lot에 붙는다.
--   WS-07(재단) 자체는 false이고 WS-08부터 true다.
-- -----------------------------------------------------------------------------
create table if not exists dmr_operation (
  id               uuid primary key default gen_random_uuid(),
  device_master_id uuid not null references device_master(id),
  seq              int  not null,
  code             text not null,             -- WS-DX2401-01 등
  name             text not null,
  after_cutting    boolean not null default false,
  unique (device_master_id, seq)
);
create index if not exists dmr_operation_dm_idx on dmr_operation (device_master_id, seq);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'qty_basis') then
    create type qty_basis as enum ('SHEET_TIER','PER_UNIT');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 두 기준이 섞이지 않게 basis로 가른다 (§4.3).
--   SHEET_TIER  시약·타이백. 장입 장수 구간별 고정량. 통 단위로 소모되어 비례하지 않음
--   PER_UNIT    포장재·라벨. 제품 1개당 비례
-- -----------------------------------------------------------------------------
create table if not exists dmr_bom (
  id                uuid primary key default gen_random_uuid(),
  operation_id      uuid not null references dmr_operation(id),
  component_item_id uuid not null references item(id),
  basis             qty_basis not null,
  qty_per_unit      numeric,                  -- PER_UNIT일 때. 제품 1개당
  unique (operation_id, component_item_id),
  check ((basis = 'PER_UNIT') = (qty_per_unit is not null))
);

-- SHEET_TIER 전용. 장입 장수 구간별 고정 소요량
create table if not exists dmr_bom_tier (
  id         uuid primary key default gen_random_uuid(),
  dmr_bom_id uuid not null references dmr_bom(id),
  min_sheets int not null check (min_sheets > 0),
  max_sheets int,                             -- null이면 상한 없음
  qty        numeric not null check (qty > 0),
  check (max_sheets is null or max_sheets >= min_sheets)
);
create index if not exists dmr_bom_tier_bom_idx on dmr_bom_tier (dmr_bom_id, min_sheets);

-- 구간이 겹치면 소요량 계산이 어느 쪽을 집을지 정해지지 않는다.
-- 구간 정의는 사람이 넣는 값이라 겹침을 여기서 막는다. 판정이 아니라 정의의 무결성이다.
create or replace function trg_tier_no_overlap()
returns trigger language plpgsql as $fn$
begin
  if exists (
    select 1 from dmr_bom_tier t
     where t.dmr_bom_id = new.dmr_bom_id
       and t.id <> new.id
       and new.min_sheets <= coalesce(t.max_sheets, 2147483647)
       and coalesce(new.max_sheets, 2147483647) >= t.min_sheets
  ) then
    raise exception '장입 구간이 기존 구간과 겹칩니다 (%~%)',
      new.min_sheets, coalesce(new.max_sheets::text, '무제한');
  end if;
  return new;
end $fn$;

drop trigger if exists dmr_bom_tier_no_overlap on dmr_bom_tier;
create trigger dmr_bom_tier_no_overlap before insert or update
  on dmr_bom_tier for each row execute function trg_tier_no_overlap();


-- -----------------------------------------------------------------------------
-- 소요량 계산 (§5)
-- -----------------------------------------------------------------------------
create or replace function required_qty(p_op uuid, p_item uuid, p_sheets int, p_units int)
returns numeric language plpgsql stable as $fn$
declare b record; r numeric;
begin
  select * into b from dmr_bom
   where operation_id = p_op and component_item_id = p_item;
  if not found then return null; end if;

  if b.basis = 'PER_UNIT' then
    return b.qty_per_unit * p_units;
  end if;

  select qty into r from dmr_bom_tier
   where dmr_bom_id = b.id
     and p_sheets >= min_sheets
     and (max_sheets is null or p_sheets <= max_sheets);
  return r;
end $fn$;

-- 작업지시서 인쇄용. 한 공정의 자재별 소요량을 한 번에 뽑는다 (§7).
create or replace function operation_requirements(p_op uuid, p_sheets int, p_units int)
returns table (
  component_item_id uuid, item_code text, item_name text, usage_uom text,
  basis qty_basis, required numeric
) language sql stable as $fn$
  select b.component_item_id, i.code, i.name, i.usage_uom, b.basis,
         required_qty(p_op, b.component_item_id, p_sheets, p_units)
    from dmr_bom b join item i on i.id = b.component_item_id
   where b.operation_id = p_op
   order by i.type, i.code
$fn$;
