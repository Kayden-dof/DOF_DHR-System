/* ===========================================================================
   0180 · 출고 정정 · 멸균 수량 · 출고할 수 있는 수량 하나 (정밀 점검 F · 2026-11-27)

   사용자 2026-11-27 «F 진행 (권고)» · 멸균 수량은 «막기».

   ── 1. 출고를 지우면 로트로 돌아간다 ─────────────────────────────────────────
   0124 가 출고 표의 지우기를 열었지만(«삭제 막힌 것 다 풀고 Log 는 남게») 출하 가능 수량을 빼는 트리거는
   insert 에만 있어, 출고를 지워도 로트 수량 · 상태가 돌아오지 않았다. 잘못 적은 출고를 바로잡을 길도
   없었다 (0168 은 «바로잡을 출고를 다시 적으십시오» 라고 했지만 다시 적으면 두 번 나간 것이 된다).
   이제 출고를 지우면 그 수량이 로트로 돌아가고, 그 출고로 «출고 완료» 가 된 로트는 출고 전 상태로 돌아간다.
   출고 전 상태는 출고를 적을 때 남겨 둔다(lot_status_before). 이 칸이 생기기 전의 출고는 승인 기록 ·
   멸균 보고서로 짐작한다. 지운 출고는 감사추적에 지우기 전 값 그대로 남는다 (0124).
   출고 수량은 고쳐 쓰지 않는다 - 고쳐도 로트 수량이 따라오지 않으므로, 지우고 다시 적는다.

   ── 2. 멸균 보고서가 있는 수량까지만 나간다 (사용자 «막기») ───────────────────────
   출고 전 멸균 검사(0160 · 0166)는 «회수된 멸균 위탁에 보고서 번호가 있는가» 만 보고 위탁 수량은 보지
   않았다. 1,000개 중 500개만 멸균을 보내고 보고서를 적어도 1,000개가 나갈 수 있었다. 이제 보고서가 있는
   위탁 수량 - 이미 나간 수량을 넘는 출고는 거부한다. 보고서를 사유와 함께 생략한 로트는 수량을 보지 않는다.

   ── 3. 지금 출고할 수 있는 수량은 lot_ship_left 하나 ──────────────────────────────
   현황 «출고 대기» 는 상태를 안 보고(손으로 «폐기» 한 로트도 셌다), 출고 화면은 상태 넷을 보고, 멸균 수량은
   아무도 안 봤다. 상태 · 멸균 보고서 · 멸균 수량 · 이미 나간 수량을 한 함수로 세어 현황 · 출고 화면이 같이 쓴다.
   주문 줄의 덮인 개수(so_line_covered)도 폐기 로트를 세지 않는다.

   ── 4. 개체 찾기가 순번 없는 출고를 안다 ────────────────────────────────────
   0160 부터 출고에 개체 순번을 적지 않는데 find_unit 은 순번 범위로만 출고를 찾아, 새 출고는 늘 «재고» 로
   나왔다. 순번 없는 출고가 있으면 로트가 다 나갔을 때 «출고됨», 남았으면 «일부 출고 (개체 미상)» 와 그
   출고처를 낸다.

   다시 돌려도 된다 (열 추가는 if not exists, 함수 · 트리거는 다시 정의).
=========================================================================== */

/* === 1. 출고 전 상태를 남기고, 지우면 돌린다 ================================= */
alter table shipment add column if not exists lot_status_before pl_status;
comment on column shipment.lot_status_before is
  '출고를 적을 때 제품 로트의 상태. 출고를 지우면 로트를 이 상태로 돌린다 (0180)';

create or replace function trg_shipment_lot_status_before()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
begin
  select status into new.lot_status_before from product_lot where id = new.product_lot_id;
  return new;
end $fn$;
drop trigger if exists shipment_lot_status_before on shipment;
create trigger shipment_lot_status_before before insert on shipment
  for each row execute function trg_shipment_lot_status_before();

create or replace function trg_shipment_restore()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
begin
  /*
   * 시연 자료 비우기 중(표시 뒤로 손댄 것이 없는 시연 DB)에는 돌리지 않는다. 로트도 곧 함께 지워지고, 돌리면
   * 그 고침이 감사추적에 남아 비우기의 증명(only_demo_data · 0083 · 0124)을 스스로 깬다. 운영에는 표시가 없다.
   */
  if only_demo_data() then
    return old;
  end if;
  update product_lot pl
     set qty_available = pl.qty_available + old.qty,
         status = case when pl.status = 'SHIPPED' then
                    coalesce(old.lot_status_before,
                             case when pl.release_approved_by is not null and pl.release_approved_on is not null
                                    then 'RELEASE_APPROVED'::pl_status
                                  when lot_steril_ok(pl.id) then 'TESTED'::pl_status
                                  else 'PACKED'::pl_status end)
                  else pl.status end
   where pl.id = old.product_lot_id;
  return old;
end $fn$;
comment on function trg_shipment_restore() is
  '출고를 지우면 그 수량을 로트로 돌리고, 출고 완료가 된 로트는 출고 전 상태로 (0180)';
drop trigger if exists shipment_restore on shipment;
create trigger shipment_restore after delete on shipment
  for each row execute function trg_shipment_restore();

create or replace function trg_shipment_qty_fixed()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
begin
  if new.qty is distinct from old.qty then
    raise exception '출고 수량은 고쳐 쓰지 않습니다. 잘못 적은 출고는 지우고 다시 적으십시오 (지우면 그 수량이 로트로 돌아갑니다)';
  end if;
  return new;
end $fn$;
drop trigger if exists shipment_qty_fixed on shipment;
create trigger shipment_qty_fixed before update of qty on shipment
  for each row execute function trg_shipment_qty_fixed();


/* === 2 · 3. 멸균 수량과 출고할 수 있는 수량 ================================== */

/* 그 제품 로트가 든 회수된 멸균 위탁 가운데 보고서 번호가 있는 것의 위탁 수량 합 (lot_steril_report 와 같은 조건) */
create or replace function lot_steril_qty(p_lot uuid)
returns int language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select coalesce(sum(sbl.qty), 0)::int
    from steril_batch_lot sbl join steril_batch sb on sb.id = sbl.steril_batch_id
   where sbl.product_lot_id = p_lot
     and sb.received_at is not null
     and btrim(coalesce(sb.cert_no, '')) <> ''
$fn$;
comment on function lot_steril_qty(uuid) is
  '제품 로트의 멸균 보고서가 있는 위탁 수량 합 (회수 · 보고서 번호 있음). 출고 상한에 쓴다 (0180)';

/*
 * 지금 출고할 수 있는 수량 - 현황 «출고 대기» · 출고 화면 · 출고 검사가 함께 쓴다.
 *   상태가 포장 · 멸균 중 · 검사 · 승인이 아니면 0 (재단 · 출고 완료 · 폐기)
 *   멸균 보고서를 생략했으면 남은 수량 그대로
 *   보고서가 없으면 0, 있으면 남은 수량과 «보고서 있는 위탁 수량 - 이미 나간 수량» 가운데 작은 쪽
 */
create or replace function lot_ship_left(p_lot uuid)
returns int language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select case
           when pl.status not in ('PACKED', 'STERILIZING', 'TESTED', 'RELEASE_APPROVED') or pl.qty_available <= 0 then 0
           when exists (select 1 from steril_report_skip k where k.product_lot_id = pl.id) then pl.qty_available
           when lot_steril_report(pl.id) is null then 0
           else greatest(0, least(pl.qty_available,
                                  lot_steril_qty(pl.id)
                                  - coalesce((select sum(sh.qty) from shipment sh where sh.product_lot_id = pl.id), 0)))::int
         end
    from product_lot pl where pl.id = p_lot
$fn$;
comment on function lot_ship_left(uuid) is
  '지금 출고할 수 있는 수량. 상태 · 멸균 보고서(또는 생략) · 보고서 있는 멸균 수량 - 이미 나간 수량 (0180)';

/* 출고 전 멸균 검사 - 보고서(또는 생략)에 더해 수량까지 (사용자 2026-11-27 «막기») */
create or replace function trg_shipment_needs_steril_report()
returns trigger language plpgsql as $fn$
declare v_lot text; v_steril int; v_shipped int;
begin
  /* 보고서를 사유와 함께 생략한 로트는 수량을 보지 않는다 (0166) */
  if exists (select 1 from steril_report_skip where product_lot_id = new.product_lot_id) then
    return new;
  end if;
  select lot_no into v_lot from product_lot where id = new.product_lot_id;
  if lot_steril_report(new.product_lot_id) is null then
    raise exception '제조번호 %은(는) 멸균 보고서가 없어 출고할 수 없습니다. '
      '멸균 위탁에서 회수일과 멸균 보고서 번호를 먼저 적거나, 보고서 없이 내보내는 로트면 '
      '출고 화면의 멸균 보고서 대기에서 사유와 함께 생략하십시오', v_lot;
  end if;
  /* 남은 수량보다 많으면 출고 적용(shipment_apply)이 «출하 가능 수량» 으로 거부한다 - 그 말이 먼저다 */
  if new.qty > (select qty_available from product_lot where id = new.product_lot_id) then
    return new;
  end if;
  v_steril := lot_steril_qty(new.product_lot_id);
  select coalesce(sum(qty), 0)::int into v_shipped from shipment where product_lot_id = new.product_lot_id;
  if v_shipped + new.qty > v_steril then
    raise exception '제조번호 %은(는) 멸균 보고서가 있는 수량이 %개이고 이미 %개가 나갔습니다. '
      '이번 출고 %개 가운데 %개는 멸균 보고서가 없습니다. 남은 수량을 멸균 위탁에 보내 보고서를 받거나, '
      '보고서 없이 내보내는 로트면 출고 화면의 멸균 보고서 대기에서 사유와 함께 생략하십시오',
      v_lot, v_steril, v_shipped, new.qty, v_shipped + new.qty - v_steril;
  end if;
  return new;
end $fn$;
comment on function trg_shipment_needs_steril_report() is
  '멸균 보고서가 없고 생략하지도 않은 제품 로트는 출고하지 않는다. 보고서가 있어도 보고서 있는 위탁 수량까지만 (0160 · 0166 · 0180)';


/* === 3. 덮인 개수 - 폐기 로트는 세지 않는다 (나머지는 0177 그대로) ============ */
create or replace function so_line_covered(p_line uuid)
returns int language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  with l as (select id, item_id from sales_order_line where id = p_line),
  w as (
    select wo.id, wo.sheet_count, wo.device_master_id
      from work_order wo
     where wo.status <> 'CANCELLED'
       and exists (select 1 from work_order_so_line x
                    where x.work_order_id = wo.id and x.sales_order_line_id = p_line and x.unlinked_at is null)
  ),
  share as (
    select case
      when exists (select 1 from product_lot pl where pl.work_order_id = w.id) then
        case
          when not exists (select 1 from product_lot pl, l where pl.work_order_id = w.id and pl.item_id = l.item_id) then 0::numeric
          else coalesce((select sum(pl.qty_available) from product_lot pl, l
                          where pl.work_order_id = w.id and pl.item_id = l.item_id
                            and pl.status <> 'DISPOSED'), 0)
               * greatest(0, so_line_left(p_line))
               / nullif((select sum(greatest(0, so_line_left(x.sales_order_line_id)))
                           from work_order_so_line x join sales_order_line sl on sl.id = x.sales_order_line_id, l
                          where x.work_order_id = w.id and x.unlinked_at is null and sl.item_id = l.item_id), 0)
        end
      else
        floor(w.sheet_count::numeric * greatest(0, so_line_left(p_line))
              * coalesce((select model_per_sheet(w.device_master_id, l.item_id) from l), 0)
              / nullif((select sum(greatest(0, so_line_left(x.sales_order_line_id)))
                          from work_order_so_line x
                         where x.work_order_id = w.id and x.unlinked_at is null), 0))
      end as n
    from w
  )
  select (coalesce((select sum(floor(coalesce(n, 0))) from share), 0)
        + coalesce((select sum(bp.sheets * coalesce(model_per_sheet(bp.device_master_id, l.item_id), 0))
                      from batch_plan bp, l
                     where bp.sales_order_line_id = p_line and bp.sheets is not null
                       and (bp.work_order_id is null
                            or exists (select 1 from work_order cw
                                        where cw.id = bp.work_order_id and cw.status = 'CANCELLED'))), 0))::int
$fn$;
comment on function so_line_covered(uuid) is
  '그 주문 줄이 이미 덮인 개수. 걸린 지시의 몫(폐기 로트 빼고) + 지시 없는(또는 이은 지시가 취소된) 이은 계획. '
  '막지 않고 보이기만 한다 (0164 · 0177 · 0180)';


/* === 4. 개체 찾기 - 순번 없는 출고 ========================================= */
create or replace function find_unit(p_text text)
returns table (
  product_lot_id uuid, lot_no text, seq int,
  item_code text, item_name text,
  product_code text, product_name text,
  batch_no text, work_order_id uuid,
  raw_lot_no text, manufactured_on date, expiry_date date,
  qty_produced int, qty_sample int,
  standing text, customer_name text, shipped_at date
) language sql stable as $fn$
  /* 적힌 그대로를 먼저 제조번호로, 없을 때만 뒤의 -숫자를 순번으로 (0044 그대로) */
  with t as (select btrim(p_text) as raw),
  parsed as (
    select
      case when exists (select 1 from product_lot p where p.lot_no = t.raw)
           then t.raw
           else regexp_replace(t.raw, '-(\d{1,4})$', '') end as lot,
      case when exists (select 1 from product_lot p where p.lot_no = t.raw)
           then null::int
           when t.raw ~ '-\d{1,4}$'
           then (regexp_replace(t.raw, '^.*-(\d{1,4})$', '\1'))::int
           else null::int end as seq
      from t
  )
  select pl.id, pl.lot_no, parsed.seq,
         i.code, i.name, dm.product_code, dm.product_name,
         wo.batch_no, wo.id,
         ml.lot_no, pl.manufactured_on, pl.expiry_date,
         pl.qty_produced, pl.qty_sample,
         case
           when parsed.seq is null                then '제조번호 전체'
           when parsed.seq > pl.qty_produced      then '이 제조번호에 없는 번호'
           when parsed.seq <= pl.qty_sample       then '완제품검사 시료'
           when sh.id is not null                 then '출고됨'
           /* 순번 없이 나간 출고 (0160 부터) - 다 나갔으면 출고됨, 남았으면 어느 개체인지 모른다 (0180) */
           when lo.n > 0 and pl.qty_available = 0 then '출고됨'
           when lo.n > 0                          then '일부 출고 (개체 미상)'
           else '재고'
         end,
         coalesce(sh.customer_name, case when lo.n > 0 then lo.customers end),
         coalesce(sh.shipped_at, case when lo.n > 0 then lo.last_on end)
    from parsed
    join product_lot pl on pl.lot_no = parsed.lot
    join item i         on i.id = pl.item_id
    join work_order wo  on wo.id = pl.work_order_id
    join device_master dm on dm.id = wo.device_master_id
    join material_lot ml  on ml.id = wo.material_lot_id
    left join shipment sh on sh.product_lot_id = pl.id
                        and parsed.seq is not null
                        and sh.unit_from is not null
                        and parsed.seq between sh.unit_from and sh.unit_to
    left join lateral (
      select count(*)::int as n, string_agg(distinct s2.customer_name, ' · ') as customers, max(s2.shipped_at) as last_on
        from shipment s2
       where s2.product_lot_id = pl.id and s2.unit_from is null
    ) lo on true
$fn$;


grant execute on function lot_steril_qty(uuid) to app_role;
grant execute on function lot_ship_left(uuid) to app_role;
grant execute on function so_line_covered(uuid) to app_role;
grant execute on function find_unit(text) to app_role, app_readonly;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'grant execute on function lot_steril_qty(uuid) to app_readonly';
    execute 'grant execute on function lot_ship_left(uuid) to app_readonly';
    execute 'grant execute on function so_line_covered(uuid) to app_readonly';
  end if;
end $$;
