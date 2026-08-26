-- =============================================================================
-- 0013_m2_process.sql  ·  공정 기록 · 계보
-- 근거: CLAUDE.md §4.6, §2 (S01)
-- 범위: M2
-- =============================================================================

create table if not exists process_record (
  id                 uuid primary key default gen_random_uuid(),
  work_order_id      uuid not null references work_order(id),
  product_lot_id     uuid references product_lot(id),   -- after_cutting일 때만
  operation_id       uuid not null references dmr_operation(id),
  attempt            int  not null default 1,           -- 재작업·재세척 회차
  day_no             int  not null,                     -- 지시서별 실작업일 순번
  work_date          date not null,
  worker_id          uuid not null references app_user(id),
  rotation_worker_id uuid references app_user(id),
  equipment_id       text,
  started_at         timestamptz,
  ended_at           timestamptz,
  rework_qty         int,                               -- WS-08 재포장 수량
  no_material_reason text,                              -- S05 예외 사유
  unique (work_order_id, product_lot_id, operation_id, attempt),
  check (rotation_worker_id is null or rotation_worker_id <> worker_id)
);
create index if not exists process_record_day_idx
  on process_record (work_order_id, day_no, worker_id);
create index if not exists process_record_lot_idx on process_record (product_lot_id);

-- -----------------------------------------------------------------------------
-- after_cutting 공정은 product_lot_id 필수, 그 외는 null (§4.6)
-- -----------------------------------------------------------------------------
create or replace function trg_pr_scope()
returns trigger language plpgsql as $fn$
declare ac boolean;
begin
  select after_cutting into ac from dmr_operation where id = new.operation_id;
  if ac and new.product_lot_id is null then
    raise exception '재단 이후 공정은 제품 로트를 지정해야 합니다';
  end if;
  if not ac and new.product_lot_id is not null then
    raise exception '재단 이전 공정에는 제품 로트를 지정할 수 없습니다';
  end if;
  return new;
end $fn$;

drop trigger if exists process_record_scope on process_record;
create trigger process_record_scope before insert or update
  on process_record for each row execute function trg_pr_scope();

-- 제품 로트를 지정했다면 그 로트가 이 배치의 것이어야 한다.
-- 남의 배치 로트에 공정 기록이 붙으면 계보가 통째로 어긋난다.
create or replace function trg_pr_lot_belongs()
returns trigger language plpgsql as $fn$
declare v_wo uuid;
begin
  if new.product_lot_id is null then return new; end if;
  select work_order_id into v_wo from product_lot where id = new.product_lot_id;
  if v_wo is distinct from new.work_order_id then
    raise exception '지정한 제품 로트는 이 작업 지시의 로트가 아닙니다';
  end if;
  return new;
end $fn$;

drop trigger if exists process_record_lot_belongs on process_record;
create trigger process_record_lot_belongs before insert or update
  on process_record for each row execute function trg_pr_lot_belongs();


-- -----------------------------------------------------------------------------
-- 계보의 실체 (§4.6)
--
--   work_order_id를 중복해서 두지 않는다. process_record를 경유하면 배치와
--   제품 로트 양쪽이 나온다. 중복 경로를 두면 반드시 불일치가 생긴다.
--
--   S01  material_lot_id not null + FK. 로트번호 공란으로는 저장되지 않는다.
-- -----------------------------------------------------------------------------
create table if not exists material_issue (
  id                uuid primary key default gen_random_uuid(),
  process_record_id uuid not null references process_record(id),
  material_lot_id   uuid not null references material_lot(id),   -- S01
  qty               numeric not null check (qty > 0),            -- 실제 투입분
  issued_by         uuid not null references app_user(id),
  issued_at         timestamptz not null default now()
);
create index if not exists material_issue_pr_idx on material_issue (process_record_id);
create index if not exists material_issue_ml_idx on material_issue (material_lot_id);

-- 불출하면 잔여가 줄어든다. 재고는 usage_uom 기준으로만 다룬다 (§4.2).
-- 잔여를 음수로 만들지는 않는다. check (qty_available >= 0)이 이미 막지만
-- 어디서 막혔는지 알 수 있게 문장을 준다.
create or replace function trg_mi_consume()
returns trigger language plpgsql as $fn$
declare v_left numeric; v_lot text;
begin
  select qty_available, lot_no into v_left, v_lot
    from material_lot where id = new.material_lot_id for update;

  if v_left < new.qty then
    raise exception '로트 %의 잔여 수량(%)보다 많이 불출할 수 없습니다 (요청 %)',
      v_lot, v_left, new.qty;
  end if;

  update material_lot
     set qty_available = qty_available - new.qty,
         status = case when qty_available - new.qty = 0 and status = 'AVAILABLE'
                       then 'CONSUMED' else status end
   where id = new.material_lot_id;
  return new;
end $fn$;

drop trigger if exists material_issue_consume on material_issue;
create trigger material_issue_consume after insert
  on material_issue for each row execute function trg_mi_consume();


-- -----------------------------------------------------------------------------
-- 계보 조회 (§4.6)
-- -----------------------------------------------------------------------------
create or replace view v_lot_genealogy as
select pr.work_order_id, pr.product_lot_id, wo.batch_no,
       ml.id as material_lot_id, ml.lot_no as material_lot_no,
       i.code as item_code, i.name as item_name, i.type as item_type,
       mi.qty, mi.issued_at,
       op.code as operation_code, op.name as operation_name, op.after_cutting
  from material_issue mi
  join process_record pr on pr.id = mi.process_record_id
  join work_order wo on wo.id = pr.work_order_id
  join material_lot ml on ml.id = mi.material_lot_id
  join item i on i.id = ml.item_id
  join dmr_operation op on op.id = pr.operation_id;

-- 배치의 원재료는 work_order.material_lot_id로 직접 붙는다. 자재 구성표에는
-- 넣지 않으므로(§5 S05 주석) 계보 조회에서는 따로 이어 준다.
create or replace view v_batch_material as
select wo.id as work_order_id, wo.batch_no, wo.sheet_count,
       ml.id as material_lot_id, ml.lot_no as material_lot_no,
       ml.thickness_band, ml.supplier_lot_no, ml.coa_no, ml.coa_date,
       i.code as item_code, i.name as item_name,
       s.name as supplier_name
  from work_order wo
  join material_lot ml on ml.id = wo.material_lot_id
  join item i on i.id = ml.item_id
  join supplier s on s.id = ml.supplier_id;
