-- =============================================================================
-- 0011_m1_work_order.sql  ·  작업 지시 (배치)
-- 근거: CLAUDE.md §4.5, §3
-- 범위: M1
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'wo_status') then
    create type wo_status as enum ('ISSUED','IN_PROCESS','CUT','DONE','CANCELLED');
  end if;
end $$;

-- -----------------------------------------------------------------------------
--   material_lot_id가 단일 컬럼이라 원재료 로트 혼입이 구조적으로 불가능하다 (§4.5).
--   규칙을 따로 만들 필요가 없다.
--
--   sheet_count 상한 30은 WS-02의 배치 상한이다. 이 값으로 dmr_bom_tier 구간을
--   판정하고 필요 용기 수를 계산해 지시서에 인쇄한다.
--
--   issued_by_prod <> issued_by_qa. 생산과 품질이 같은 사람일 수 없다.
-- -----------------------------------------------------------------------------
create table if not exists work_order (
  id               uuid primary key default gen_random_uuid(),
  wo_no            text not null unique,
  batch_no         text not null unique,      -- 배치번호. 재사용 금지
  device_master_id uuid not null references device_master(id),
  dmr_revision     text not null,             -- 발행 시점 고정
  material_lot_id  uuid not null references material_lot(id),   -- 배치당 1개
  sheet_count      int  not null check (sheet_count between 1 and 30),
  status           wo_status not null default 'ISSUED',
  issued_by_prod   uuid not null references app_user(id),
  issued_by_qa     uuid not null references app_user(id),
  issued_at        timestamptz not null default now(),
  cancelled_reason text,
  check (issued_by_prod <> issued_by_qa)
);
create index if not exists work_order_status_idx on work_order (status, issued_at desc);
create index if not exists work_order_material_idx on work_order (material_lot_id);

-- 취소 사유 없는 취소는 설명이 없는 기록이다. 번호는 소멸하고 그 취소 기록이
-- 번호가 비는 이유를 설명해야 한다 (§4.10 운영 규칙).
create or replace function trg_wo_cancel_reason()
returns trigger language plpgsql as $fn$
begin
  if new.status = 'CANCELLED' and btrim(coalesce(new.cancelled_reason, '')) = '' then
    raise exception '취소 사유를 입력해야 합니다. 번호는 소멸하며 그 사유가 설명이 됩니다';
  end if;
  return new;
end $fn$;

drop trigger if exists work_order_cancel_reason on work_order;
create trigger work_order_cancel_reason before insert or update
  on work_order for each row execute function trg_wo_cancel_reason();


-- -----------------------------------------------------------------------------
-- 발행 전 경고 (§2 "경고만")
--
-- 차단하지 않는다. 화면에 띄울 항목을 모아 줄 뿐이다.
-- 미승인 공급자, 재고 부족, 유효기한 임박, 장입 상한 초과가 여기 해당한다.
-- -----------------------------------------------------------------------------
create or replace function work_order_warnings(p_material_lot uuid, p_sheets int)
returns table (kind text, detail text)
language plpgsql stable as $fn$
declare ml record; sup record;
begin
  select * into ml from material_lot where id = p_material_lot;
  if not found then return; end if;

  select * into sup from supplier where id = ml.supplier_id;

  if not supplier_is_approved(ml.supplier_id) then
    kind := '미승인 공급자';
    detail := format('%s (상태 %s%s)', sup.name, sup.status,
                case when sup.approved_until is not null
                     then ', 승인 만료 ' || sup.approved_until::text else '' end);
    return next;
  end if;

  if ml.status <> 'AVAILABLE' then
    kind := '자재 상태';
    detail := format('로트 %s 의 상태가 %s 입니다', ml.lot_no, ml.status);
    return next;
  end if;

  if ml.expiry_date is not null
     and ml.expiry_date < (timezone('Asia/Seoul', now()))::date + 30 then
    kind := '유효기한 임박';
    detail := format('로트 %s 유효기한 %s', ml.lot_no, ml.expiry_date);
    return next;
  end if;

  if p_sheets > 30 then
    kind := '장입 상한 초과';
    detail := format('장입 %s장. WS-02 배치 상한은 30장입니다', p_sheets);
    return next;
  end if;

  if ml.qty_available <= 0 then
    kind := '재고 없음';
    detail := format('로트 %s 잔여 0', ml.lot_no);
    return next;
  end if;
end $fn$;
