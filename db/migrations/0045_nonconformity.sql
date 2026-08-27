/* ---------------------------------------------------------------------------
   제품 부적합

   불량률을 세려면 무엇이 불량인지가 기록되어 있어야 한다. 지금까지는 그 기록이
   없었다. process_record.rework_qty 는 포장 공정의 재포장 수량일 뿐 그것이
   제품이 되었는지 아닌지를 구분하지 않고, 특채는 아예 자리가 없었다.

   ── 정의 (사용자) ─────────────────────────────────────────────────────────
   생산은 진행했는데 제품으로 나오지 않은 것이 불량이다. 재작업은 재작업률로
   따로 세고, 재작업을 했는데도 제품이 되지 못한 그 수량이 불량 수량이다.
   재작업이나 특채로 살아난 만큼 그 로트의 불량 수량은 줄어든다. 특채 수량은
   별도로 따라간다.

     발생 수량 = 재작업 + 특채 + 불량

   그래서 한 줄에 "몇 개가, 어떻게 끝났는지"를 적는다. 한 개체는 셋 중 하나로만
   끝나므로 세 값을 더하면 발생 수량이 되고, 재작업이나 특채로 끝난 만큼 불량은
   저절로 줄어든다. 빼기를 따로 하지 않는다 - 빼기를 손으로 하면 어긋난다.

   ── 시스템이 판정하지 않는다 ──────────────────────────────────────────────
   무엇이 부적합인지, 재작업으로 살릴지 특채로 낼지 폐기할지는 사람이 서면으로
   정한다. 여기 적히는 것은 그 결정의 결과다 (§1). 특채는 승인자 이름을 받는데,
   품질책임자가 시스템 계정을 쓰지 않으므로 release_approved_by 와 같이
   text 로 둔다 (§4.5).

   ── 불량이면 출하 가능 수량이 준다 ────────────────────────────────────────
   폐기로 끝난 수량만큼 그 로트에서 나갈 수 있는 개수가 줄어야 한다. 응용에서
   같이 고치게 두지 않고 DB 가 맡는다 - 어느 경로로든 새면 재고와 기록이
   어긋난다.
--------------------------------------------------------------------------- */

do $$
begin
  if not exists (select 1 from pg_type where typname = 'nc_outcome') then
    create type nc_outcome as enum ('REWORK', 'CONCESSION', 'SCRAP');
  end if;
end $$;

comment on type nc_outcome is
  'REWORK 재작업해서 제품이 됨 · CONCESSION 특채로 내보냄 · SCRAP 끝내 제품이 안 됨(불량)';

create table if not exists product_nonconformity (
  id              uuid primary key default gen_random_uuid(),
  product_lot_id  uuid not null references product_lot(id),
  qty             int  not null check (qty > 0),
  outcome         nc_outcome not null,
  reason_code     text not null,
  reason_detail   text,
  /* 특채는 서면 승인 사항이다. 승인자 이름을 그대로 적는다 (§4.5) */
  approved_by     text,
  approved_on     date,
  found_at        date not null default (timezone('Asia/Seoul', now()))::date,
  registered_by   uuid not null references app_user(id),
  registered_at   timestamptz not null default now(),
  /* 특채로 내보내려면 누가 승인했는지가 있어야 한다 */
  check (outcome <> 'CONCESSION' or (approved_by is not null and approved_on is not null))
);
create index if not exists product_nc_lot on product_nonconformity (product_lot_id);
create index if not exists product_nc_found on product_nonconformity (found_at);

comment on table product_nonconformity is
  '제품 부적합과 그 결말. 발생 수량 = 재작업 + 특채 + 불량';

/* --- 불량이면 출하 가능 수량이 준다 -------------------------------------- */
create or replace function trg_nc_reduce()
returns trigger language plpgsql as $fn$
declare v_left int; v_lot text;
begin
  if new.outcome <> 'SCRAP' then
    return new;                       -- 재작업 · 특채는 제품으로 나간다
  end if;

  select qty_available, lot_no into v_left, v_lot
    from product_lot where id = new.product_lot_id for update;

  if v_left < new.qty then
    raise exception '제조번호 %의 출하 가능 수량(%)보다 많이 폐기할 수 없습니다 (요청 %)',
      v_lot, v_left, new.qty;
  end if;

  update product_lot
     set qty_available = qty_available - new.qty,
         status = case when qty_available - new.qty = 0 then 'DISPOSED' else status end
   where id = new.product_lot_id;

  return new;
end $fn$;

drop trigger if exists product_nc_reduce on product_nonconformity;
create trigger product_nc_reduce after insert
  on product_nonconformity for each row execute function trg_nc_reduce();

/* --- 기록은 지워지지 않는다 (§10) ---------------------------------------- */
grant select, insert, update on product_nonconformity to app_role;
revoke delete on product_nonconformity from app_role;
grant select on product_nonconformity to app_readonly;

drop trigger if exists product_nc_audit on product_nonconformity;
create trigger product_nc_audit after insert or update
  on product_nonconformity for each row execute function trg_audit();

/* ---------------------------------------------------------------------------
   달별 품질

   생산 수량을 분모로 두고 셋을 나란히 놓는다. 비율은 화면에서 나누지 않고
   여기서 한 번만 낸다 - 두 곳에서 나누면 반올림이 갈린다.

   생산 수량은 재단에서 제조번호가 붙은 개수다. 시료를 포함한다.
--------------------------------------------------------------------------- */
create or replace view v_quality_monthly as
with made as (
  select date_trunc('month', pl.manufactured_on)::date as month,
         sum(pl.qty_produced)::int as produced
    from product_lot pl group by 1
),
nc as (
  select date_trunc('month', pl.manufactured_on)::date as month,
         sum(n.qty) filter (where n.outcome = 'REWORK')::int     as rework,
         sum(n.qty) filter (where n.outcome = 'CONCESSION')::int as concession,
         sum(n.qty) filter (where n.outcome = 'SCRAP')::int      as scrap
    from product_nonconformity n
    join product_lot pl on pl.id = n.product_lot_id
   group by 1
)
select made.month,
       made.produced,
       coalesce(nc.rework, 0)     as rework,
       coalesce(nc.concession, 0) as concession,
       coalesce(nc.scrap, 0)      as scrap,
       coalesce(nc.rework, 0) + coalesce(nc.concession, 0) + coalesce(nc.scrap, 0) as found,
       case when made.produced > 0
            then round(coalesce(nc.scrap, 0)::numeric  * 100 / made.produced, 2) end as scrap_pct,
       case when made.produced > 0
            then round(coalesce(nc.rework, 0)::numeric * 100 / made.produced, 2) end as rework_pct
  from made
  left join nc on nc.month = made.month;

grant select on v_quality_monthly to app_role, app_readonly;

/* --- 로트별 품질. 배치 화면에서 쓴다 -------------------------------------- */
create or replace view v_lot_quality as
select pl.id as product_lot_id,
       coalesce(sum(n.qty) filter (where n.outcome = 'REWORK'), 0)::int     as rework,
       coalesce(sum(n.qty) filter (where n.outcome = 'CONCESSION'), 0)::int as concession,
       coalesce(sum(n.qty) filter (where n.outcome = 'SCRAP'), 0)::int      as scrap
  from product_lot pl
  left join product_nonconformity n on n.product_lot_id = pl.id
 group by pl.id;

grant select on v_lot_quality to app_role, app_readonly;
