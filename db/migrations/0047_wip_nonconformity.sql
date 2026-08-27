/* ---------------------------------------------------------------------------
   재단 전 부적합

   0045 는 제품 로트에 붙는 부적합만 셌다. 그런데 검사가 셋이고 그 가운데
   하나는 재단 전이다 (사용자 지적).

     PI-01  1차 반제품 검사   재단 전   ← 셀 자리가 없었다
     PI-02  2차 반제품 검사   재단 후   product_nonconformity
     FI     완제품 검사       재단 후   product_nonconformity

   ── 위치 코드를 따로 만들지 않는다 ────────────────────────────────────────
   "불량 위치 코드"를 새로 파지 않는다. dmr_operation 이 이미 모든 단계를
   가지고 있고 코드도 붙어 있다. 같은 것에 이름이 둘이면 반드시 어긋난다 -
   material_issue 에 work_order_id 를 중복해 두지 않는 것과 같은 이유다 (§10).

   축은 둘이면 된다.

     어디서 발견했나  공정 (operation_id)
     무엇이 문제인가  사유 (reason_code)

   ── 단위가 갈린다 ─────────────────────────────────────────────────────────
   재단 전은 장이고 재단 후는 개다. 한 장에서 여러 개가 나오므로 둘을 더할 수
   없다. 더하면 불량률이 뜻을 잃는다. 그래서 표를 나눈다. 사고방식은 같다 -
   한 줄에 "얼마가, 어디서, 어떻게 끝났는지".

     발생 = 재작업 + 특채 + 불량

   ── 장입 장수는 줄지 않는다 ───────────────────────────────────────────────
   재단 전에 장을 버려도 work_order.sheet_count 는 그대로다. 그건 발행 시점에
   장입하기로 한 수이고 이미 일어난 일이다. 버린 사실을 따로 적을 뿐이다.
   제품 로트의 출하 가능 수량이 주는 것과는 성격이 다르다 - 그쪽은 나갈 수
   있는 개수라 실제로 줄어야 한다.
--------------------------------------------------------------------------- */

create table if not exists wip_nonconformity (
  id                uuid primary key default gen_random_uuid(),
  work_order_id     uuid not null references work_order(id),
  /* 어디서 발견했나. 재단 이전 공정만 온다 (아래 트리거) */
  operation_id      uuid not null references dmr_operation(id),
  sheets            int  not null check (sheets > 0),
  outcome           nc_outcome not null,
  reason_code       text not null,
  reason_detail     text,
  approved_by       text,
  approved_on       date,
  concession_doc_no text,
  found_at          date not null default (timezone('Asia/Seoul', now()))::date,
  registered_by     uuid not null references app_user(id),
  registered_at     timestamptz not null default now(),
  /* 특채는 품질팀 기록지의 문서 코드가 있어야 특채다 (0046 과 같은 규칙) */
  check (outcome <> 'CONCESSION'
         or (approved_by is not null and approved_on is not null
             and btrim(coalesce(concession_doc_no, '')) <> '')),
  check (outcome = 'CONCESSION' or concession_doc_no is null)
);
create index if not exists wip_nc_wo on wip_nonconformity (work_order_id);
create index if not exists wip_nc_found on wip_nonconformity (found_at);

comment on table wip_nonconformity is
  '재단 전 부적합. 단위는 장이며 제품 개수와 더하지 않는다';

/* --- 재단 이전 공정만 · 그 배치의 공정만 -----------------------------------
   재단 이후 부적합은 product_nonconformity 로 간다. 두 표에 같은 일이 적히면
   어느 쪽을 세야 하는지 알 수 없어진다.
-------------------------------------------------------------------------- */
create or replace function trg_wip_nc_scope()
returns trigger language plpgsql as $fn$
declare v_dm uuid; v_after boolean; v_op_dm uuid; v_name text; v_code text;
begin
  select device_master_id into v_dm from work_order where id = new.work_order_id;
  select after_cutting, device_master_id, name, code
    into v_after, v_op_dm, v_name, v_code
    from dmr_operation where id = new.operation_id;

  if v_op_dm is null then
    raise exception '공정을 찾을 수 없습니다';
  end if;
  if v_op_dm <> v_dm then
    raise exception '이 배치의 공정이 아닙니다 (%)', v_code;
  end if;
  if v_after then
    raise exception '%(%)는 재단 이후 공정입니다. 재단 이후 부적합은 제품 로트에 적습니다',
      v_name, v_code;
  end if;
  return new;
end $fn$;

drop trigger if exists wip_nc_scope on wip_nonconformity;
create trigger wip_nc_scope before insert or update
  on wip_nonconformity for each row execute function trg_wip_nc_scope();

/* --- 기록은 지워지지 않는다 (§10) ---------------------------------------- */
grant select, insert, update on wip_nonconformity to app_role;
revoke delete on wip_nonconformity from app_role;
grant select on wip_nonconformity to app_readonly;

drop trigger if exists wip_nc_audit on wip_nonconformity;
create trigger wip_nc_audit after insert or update
  on wip_nonconformity for each row execute function trg_audit();

/* ---------------------------------------------------------------------------
   재단 후 부적합에도 "어디서 발견했나" 를 남긴다

   0045 는 사유만 받고 공정을 받지 않았다. 그래서 2차 반제품 검사에서 나온
   것인지 완제품 검사에서 나온 것인지 구분되지 않았다.

   이미 들어간 행은 그때 규칙으로 적힌 기록이므로 되돌려 고치지 않는다. 새로
   들어오는 행부터 공정을 요구한다 (NOT VALID · §10).
--------------------------------------------------------------------------- */
alter table product_nonconformity
  add column if not exists operation_id uuid references dmr_operation(id);

comment on column product_nonconformity.operation_id is
  '어디서 발견했나. 재단 이후 공정만 온다';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'nc_needs_operation') then
    alter table product_nonconformity add constraint nc_needs_operation
      check (operation_id is not null) not valid;
  end if;
end $$;

create or replace function trg_nc_scope()
returns trigger language plpgsql as $fn$
declare v_dm uuid; v_after boolean; v_op_dm uuid; v_name text; v_code text;
begin
  if new.operation_id is null then
    return new;                       -- 지난 규칙으로 들어온 행
  end if;

  select wo.device_master_id into v_dm
    from product_lot pl join work_order wo on wo.id = pl.work_order_id
   where pl.id = new.product_lot_id;

  select after_cutting, device_master_id, name, code
    into v_after, v_op_dm, v_name, v_code
    from dmr_operation where id = new.operation_id;

  if v_op_dm <> v_dm then
    raise exception '이 배치의 공정이 아닙니다 (%)', v_code;
  end if;
  if not v_after then
    raise exception '%(%)는 재단 이전 공정입니다. 재단 이전 부적합은 배치에 적습니다',
      v_name, v_code;
  end if;
  return new;
end $fn$;

drop trigger if exists product_nc_scope on product_nonconformity;
create trigger product_nc_scope before insert or update
  on product_nonconformity for each row execute function trg_nc_scope();

/* ---------------------------------------------------------------------------
   달별 재단 전 품질

   분모는 장입 장수다. 그 달에 발행된 배치가 장입하기로 한 장수를 더한다.
   제품 개수와 섞지 않으므로 화면에서도 따로 세운다.
--------------------------------------------------------------------------- */
create or replace view v_wip_quality_monthly as
with charged as (
  select date_trunc('month', wo.issued_at)::date as month,
         sum(wo.sheet_count)::int as sheets
    from work_order wo
   where wo.status <> 'CANCELLED'
   group by 1
),
nc as (
  select date_trunc('month', wo.issued_at)::date as month,
         sum(n.sheets) filter (where n.outcome = 'REWORK')::int     as rework,
         sum(n.sheets) filter (where n.outcome = 'CONCESSION')::int as concession,
         sum(n.sheets) filter (where n.outcome = 'SCRAP')::int      as scrap
    from wip_nonconformity n
    join work_order wo on wo.id = n.work_order_id
   group by 1
)
select charged.month,
       charged.sheets,
       coalesce(nc.rework, 0)     as rework,
       coalesce(nc.concession, 0) as concession,
       coalesce(nc.scrap, 0)      as scrap,
       case when charged.sheets > 0
            then round(coalesce(nc.scrap, 0)::numeric * 100 / charged.sheets, 2) end as scrap_pct
  from charged
  left join nc on nc.month = charged.month;

grant select on v_wip_quality_monthly to app_role, app_readonly;

/* --- 배치별 재단 전 부적합. 배치 화면에서 쓴다 ---------------------------- */
create or replace view v_wo_wip_nc as
select n.work_order_id,
       o.code as op_code, o.name as op_name, o.seq,
       n.outcome::text as outcome, n.reason_code, n.sheets,
       n.concession_doc_no, n.found_at
  from wip_nonconformity n
  join dmr_operation o on o.id = n.operation_id;

grant select on v_wo_wip_nc to app_role, app_readonly;
