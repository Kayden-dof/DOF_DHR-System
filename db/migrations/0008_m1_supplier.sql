-- =============================================================================
-- 0008_m1_supplier.sql  ·  공급자 · 단가 · 사용기간
-- 근거: CLAUDE.md §4.2
-- 범위: M1
-- =============================================================================

create table if not exists supplier (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  status         text not null default 'PENDING',   -- PENDING/APPROVED/SUSPENDED
  approved_until date,
  contact_name   text, contact_phone text, contact_email text,
  biz_no text, address text, payment_terms text, note text
);

-- 미승인 공급자는 경고만 한다. 차단은 S01~S05뿐이다 (§2).
create or replace function supplier_is_approved(p_supplier uuid, p_on date default null)
returns boolean language sql stable as $fn$
  select s.status = 'APPROVED'
     and (s.approved_until is null
          or s.approved_until >= coalesce(p_on, (timezone('Asia/Seoul', now()))::date))
    from supplier s where s.id = p_supplier
$fn$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'item_default_supplier_id_fkey'
  ) then
    alter table item
      add constraint item_default_supplier_id_fkey
      foreign key (default_supplier_id) references supplier(id);
  end if;
end $$;

create table if not exists item_supplier (
  item_id       uuid not null references item(id),
  supplier_id   uuid not null references supplier(id),
  current_price numeric check (current_price >= 0),   -- 공급가액. usage_uom 기준
  primary key (item_id, supplier_id)
);

create table if not exists price_history (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references item(id),
  supplier_id    uuid not null references supplier(id),
  price          numeric not null check (price >= 0),
  effective_from date not null,
  registered_by  uuid not null references app_user(id),
  registered_at  timestamptz not null default now()
);
create index if not exists price_history_item_idx
  on price_history (item_id, supplier_id, effective_from desc);

-- 사용기간 연장 이력. 안정성 시험 보고서 번호를 필수로 받는다
create table if not exists shelf_life_history (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references item(id),
  months          int  not null check (months > 0),
  effective_from  date not null,
  study_report_no text not null,
  study_date      date,
  approved_by     uuid not null references app_user(id),
  registered_at   timestamptz not null default now()
);
create index if not exists shelf_life_history_item_idx
  on shelf_life_history (item_id, effective_from desc);

-- -----------------------------------------------------------------------------
-- 유효기한 산출 근거 (§4.2)
--
--   "유효기한은 product_lot 생성 시점 값으로 고정한다. 나중에 사용기간이 2년으로
--    바뀌어도 기존 로트에 소급되면 안 된다. 참조한 shelf_life_history 행도 함께
--    저장해 근거를 남긴다."
--
-- 시점 기준으로 유효한 사용기간 행을 돌려준다. 없으면 item.shelf_life_months로
-- 떨어지고, 그것도 없으면 12개월이다. 제품 로트 생성 시 이 값을 박아 넣는다.
-- -----------------------------------------------------------------------------
create or replace function shelf_life_at(p_item uuid, p_on date)
returns table (months int, ref_id uuid)
language sql stable as $fn$
  select coalesce(h.months, i.shelf_life_months, 12), h.id
    from item i
    left join lateral (
      select hh.months, hh.id
        from shelf_life_history hh
       where hh.item_id = i.id and hh.effective_from <= p_on
       order by hh.effective_from desc, hh.registered_at desc
       limit 1
    ) h on true
   where i.id = p_item
$fn$;
