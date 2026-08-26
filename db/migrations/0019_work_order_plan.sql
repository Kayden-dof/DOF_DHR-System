-- =============================================================================
-- 0019_work_order_plan.sql · 배치 예정 형명
--
-- 한 배치에서 여러 규격이 나온다. 두께는 원재료가 정하므로 배치 하나가 두께
-- 구간 하나에 묶이고, 그 안에서 크기별로 갈린다 (§3 ③).
--
-- 실제 형명과 수량은 재단에서 정해진다 (product_lot). 이 표는 그 전에 작업
-- 지시서에 인쇄할 예정을 담는다. 예정과 실제가 달라도 시스템이 고치지 않는다
-- (§7). 재단에서 다른 형명이 나오면 그냥 다르게 기록되고, 두 값이 나란히 남는다.
--
-- 그래서 이 표는 product_lot 과 아무 제약으로도 묶지 않는다. 묶는 순간 예정이
-- 실제를 강제하게 되고, 그건 이 시스템이 하지 않기로 한 일이다.
-- =============================================================================

create table if not exists work_order_plan (
  work_order_id uuid not null references work_order(id),
  item_id       uuid not null references item(id),
  planned_qty   int check (planned_qty is null or planned_qty > 0),
  seq           int  not null default 0,
  primary key (work_order_id, item_id)
);

create index if not exists work_order_plan_wo_idx on work_order_plan (work_order_id);

-- 완제품만 예정 형명이 될 수 있다
create or replace function trg_wo_plan_fin()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from item i where i.id = new.item_id and i.type = 'FIN') then
    raise exception '예정 형명에는 완제품만 넣을 수 있습니다';
  end if;
  return new;
end $$;

drop trigger if exists work_order_plan_fin on work_order_plan;
create trigger work_order_plan_fin before insert or update
  on work_order_plan for each row execute function trg_wo_plan_fin();

-- 감사추적 · 삭제 차단 · 권한. 0017 과 같은 규칙을 이 표에도 건다.
drop trigger if exists work_order_plan_audit on work_order_plan;
create trigger work_order_plan_audit after insert or update
  on work_order_plan for each row execute function trg_audit('work_order_id');

drop trigger if exists work_order_plan_no_delete on work_order_plan;
create trigger work_order_plan_no_delete before delete
  on work_order_plan for each row execute function trg_block_delete();

drop trigger if exists work_order_plan_no_truncate on work_order_plan;
create trigger work_order_plan_no_truncate before truncate
  on work_order_plan for each statement execute function trg_block_delete();

revoke delete on work_order_plan from app_role;
grant select, insert, update on work_order_plan to app_role;

/* ---------------------------------------------------------------------------
   예정 수량 합계

   포장재처럼 제품 개수에 비례하는 자재는 재단 전에는 수량을 알 수 없었다.
   예정 형명을 넣어 두면 그 합으로 소요량을 미리 계산해 지시서에 인쇄할 수 있다.
   어디까지나 예정이다. 실제 투입은 기록서에 따로 적힌다.
--------------------------------------------------------------------------- */
create or replace function planned_units(p_wo uuid)
returns int language sql stable as $$
  select coalesce(sum(planned_qty), 0)::int
    from work_order_plan where work_order_id = p_wo
$$;
