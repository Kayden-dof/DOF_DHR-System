/* ===========================================================================
   0159 · 수주 장부 · 출고는 주문 줄로 · 형명 일괄 검토 (사용자 2026-11-25)

   "DHR 은 주문 장부와 출고 연결에만 집중하면 됨."        - 거래명세서 · 세금계산서 · 단가 · 결제는 ERP
   "B 주문서+줄 (권고)"                                    - 주문서(머리) + 형명 줄
   "전적으로 생산팀의 지원 프로그램"                        - 출하 승인은 걷었다 (0160)
   "출고할때 발주 업체리스트에서 선택하고, 발주 형명이 맞는지 작업지시서 및 제조기록서 일괄
    검토해서 출고시 오규격이 나가지 않도록 흐름을 그렇게 짜줘."
   출고는 꼭 주문 줄에 잇는다 (사용자가 고르지 않아 권고안 «필수», 2026-11-25).

     customer          고객 거래처. 지우지 않는다 - 쓰지 않으면 is_active = false
     sales_order       주문서 머리. 고객 발주번호는 거래처마다 살아 있는 주문 안에서 하나
     sales_order_line  형명 줄. 한 주문서에 같은 형명은 한 줄
     shipment.sales_order_line_id   출고가 어느 주문 줄로 나갔는가

   출고 누계는 저장하지 않는다. 출고 표에 이미 있다 - 두 곳에 적으면 갈라진다 (§10). 구매 발주의
   po_received() 처럼 묻는 함수로 센다 (so_line_shipped · so_line_left · so_status).

   막는 것 (§2 의 S01~S05 밖 · 사용자가 정한 것과 사실이 어긋나는 것)
     형명 줄  완제품만 · 이미 나간 양보다 적게 못 고침 · 출고가 붙으면 형명 · 취소를 못 바꿈
     주문서   취소에는 사유 · 취소는 되돌리지 않는다 (잘못 취소했으면 같은 번호로 다시 등록)
   막지 않는 것: 주문 수량보다 많이 출고하는 것 (화면이 경고한다).
=========================================================================== */


/* === 1. 고객 거래처 ======================================================= */
create table if not exists customer (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (btrim(name) <> ''),
  biz_no        text check (biz_no is null or btrim(biz_no) <> ''),
  contact_name  text,
  contact_phone text,
  contact_email text,
  address       text,
  note          text not null default '',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid not null references app_user(id)
);
comment on table customer is
  '고객 거래처 (수주 · 0159). 지우지 않는다 - 쓰지 않으면 is_active = false';
comment on column customer.biz_no is '사업자등록번호. 적으면 거래처마다 하나';
create unique index if not exists customer_biz_no_uk on customer (biz_no) where biz_no is not null;


/* === 2. 주문서 머리 ======================================================= */
create table if not exists sales_order (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references customer(id),
  customer_po_no text not null check (btrim(customer_po_no) <> ''),
  ordered_on     date not null,
  ship_to        text,
  due_on         date,
  note           text not null default '',
  created_by     uuid not null references app_user(id),
  created_at     timestamptz not null default now(),
  cancelled_at   timestamptz,
  cancelled_by   uuid references app_user(id),
  cancel_reason  text,
  check (cancelled_at is null or btrim(coalesce(cancel_reason, '')) <> '')
);
comment on table sales_order is
  '고객이 낸 주문서 머리 (수주 · 0159). 지우지 않는다 - 잘못 받았으면 사유와 함께 취소';
comment on column sales_order.customer_po_no is '고객 발주번호. 고객 발주서에 적힌 그대로';
comment on column sales_order.ship_to is '납품처. 비우면 거래처와 같다';
comment on column sales_order.note is '결제조건 · 특기사항 (계산하지 않는 글)';
create unique index if not exists sales_order_live_uk
  on sales_order (customer_id, customer_po_no) where cancelled_at is null;
create index if not exists sales_order_customer_idx on sales_order (customer_id);


/* === 3. 형명 줄 =========================================================== */
create table if not exists sales_order_line (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references sales_order(id),
  item_id        uuid not null references item(id),
  qty            int  not null check (qty > 0),
  seq            int  not null default 0,
  cancelled_at   timestamptz,
  cancel_reason  text,
  check (cancelled_at is null or btrim(coalesce(cancel_reason, '')) <> ''),
  unique (sales_order_id, item_id)
);
comment on table sales_order_line is
  '주문서의 형명 줄 (수주 · 0159). 한 주문서에 같은 형명은 한 줄';


/* === 4. 감사 · 지우기 차단 · 권한 ======================================== */
do $$
declare t text;
begin
  foreach t in array array['customer', 'sales_order', 'sales_order_line'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I
                      for each row execute function trg_audit(''id'')', t || '_audit', t);
    execute format('drop trigger if exists %I on %I', t || '_no_delete', t);
    execute format('create trigger %I before delete on %I
                      for each row execute function trg_block_delete()', t || '_no_delete', t);
    execute format('drop trigger if exists %I on %I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on %I
                      for each statement execute function trg_block_delete()', t || '_no_truncate', t);
    execute format('grant select, insert, update on %I to app_role', t);
    execute format('revoke delete, truncate on %I from app_role', t);
    if exists (select 1 from pg_roles where rolname = 'app_readonly') then
      execute format('revoke all on %I from app_readonly', t);
      execute format('grant select on %I to app_readonly', t);
    end if;
  end loop;
end $$;


/* === 5. 묻는 함수 (저장하지 않고 센다) ==================================== */
/* 출고 칸이 아직 없을 때(이 이관이 처음 돌 때)도 함수가 서도록 먼저 칸을 둔다 */
alter table shipment add column if not exists sales_order_line_id uuid references sales_order_line(id);
create index if not exists shipment_so_line_idx on shipment (sales_order_line_id);
comment on column shipment.sales_order_line_id is
  '이 출고가 나간 주문 줄 (0159). 새 출고는 꼭 적는다 - 비어 있는 것은 그 전 기록';

create or replace function so_line_shipped(p_line uuid) returns int
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select coalesce(sum(qty), 0)::int from shipment where sales_order_line_id = p_line
$fn$;
comment on function so_line_shipped(uuid) is '그 주문 줄로 나간 출고 수량 합 (0159)';

create or replace function so_line_left(p_line uuid) returns int
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select case when l.cancelled_at is not null or o.cancelled_at is not null then 0
              else l.qty - so_line_shipped(l.id) end
    from sales_order_line l join sales_order o on o.id = l.sales_order_id
   where l.id = p_line
$fn$;
comment on function so_line_left(uuid) is
  '그 주문 줄의 남은 수량. 줄이나 주문서가 취소면 0, 더 나갔으면 음수 (0159)';

create or replace function so_status(p_order uuid) returns text
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select case
           when o.cancelled_at is not null then 'CANCELLED'
           when not exists (select 1 from sales_order_line l
                             where l.sales_order_id = o.id and l.cancelled_at is null) then 'OPEN'
           when not exists (select 1 from sales_order_line l
                             where l.sales_order_id = o.id and so_line_left(l.id) > 0) then 'DONE'
           when exists (select 1 from sales_order_line l join shipment sh on sh.sales_order_line_id = l.id
                         where l.sales_order_id = o.id) then 'PARTIAL'
           else 'OPEN' end
    from sales_order o where o.id = p_order
$fn$;
comment on function so_status(uuid) is
  '주문서 상태. CANCELLED 취소 · OPEN 접수(출고 0) · PARTIAL 일부 출고 · DONE 출고 완료 (0159)';

grant execute on function so_line_shipped(uuid) to app_role;
grant execute on function so_line_left(uuid) to app_role;
grant execute on function so_status(uuid) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'grant execute on function so_line_shipped(uuid) to app_readonly';
    execute 'grant execute on function so_line_left(uuid) to app_readonly';
    execute 'grant execute on function so_status(uuid) to app_readonly';
  end if;
end $$;


/* === 6. 장부 규칙 ========================================================= */
create or replace function trg_so_line_rules()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_type text; v_code text; v_shipped int;
begin
  select type::text, code into v_type, v_code from item where id = new.item_id;
  if v_type is distinct from 'FIN' then
    raise exception '주문 줄의 품목 %은(는) 완제품 형명이 아닙니다. 완제품 형명만 주문받습니다', v_code;
  end if;
  if tg_op = 'UPDATE' then
    v_shipped := so_line_shipped(old.id);
    if v_shipped > 0 and new.item_id is distinct from old.item_id then
      raise exception '이미 % 개가 출고된 줄이라 형명을 바꿀 수 없습니다', v_shipped;
    end if;
    if v_shipped > 0 and new.cancelled_at is not null and old.cancelled_at is null then
      raise exception '이미 % 개가 출고된 줄이라 취소할 수 없습니다. 남은 양만 줄이려면 수량을 고치십시오',
        v_shipped;
    end if;
    if new.qty < v_shipped then
      raise exception '이미 % 개가 출고되어 수량을 %(으)로 줄일 수 없습니다', v_shipped, new.qty;
    end if;
    if old.cancelled_at is not null and new.cancelled_at is null then
      raise exception '취소한 주문 줄은 되돌리지 않습니다. 줄을 새로 더하십시오';
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists sales_order_line_rules on sales_order_line;
create trigger sales_order_line_rules before insert or update on sales_order_line
  for each row execute function trg_so_line_rules();

create or replace function trg_so_rules()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
begin
  if old.cancelled_at is not null and new.cancelled_at is null then
    raise exception '취소한 주문은 되돌리지 않습니다. 같은 고객 발주번호로 다시 등록하십시오';
  end if;
  if new.cancelled_at is not null and old.cancelled_at is null and new.cancelled_by is null then
    new.cancelled_by := current_user_id();
  end if;
  return new;
end $fn$;

drop trigger if exists sales_order_rules on sales_order;
create trigger sales_order_rules before update on sales_order
  for each row execute function trg_so_rules();


/* === 7. 출고는 주문 줄로 · 형명 일괄 검토 ================================= */
/*
 * 출고 전에 주문 형명을 맞대 본다 (사용자 «발주 형명이 맞는지 작업지시서 및 제조기록서 일괄 검토해서
 * 출고시 오규격이 나가지 않도록»). DB 가 표에서 볼 수 있는 셋을 여기서 본다:
 *   LOT   제품 로트 형명      로트 품목 = 주문 줄 품목
 *   DMR   작업지시서 제품     주문 형명이 그 지시의 제품표준서 형명 (dm_models)
 *   BAND  작업지시서 원료 두께 원료 로트 thickness_band = model_band(주문 형명). 한쪽이 비면 null(볼 수 없음)
 * 제조기록서 재단 줄의 모델명은 칸 자리를 양식 코드가 알아서 처리 함수(ship)가 본다 (lib/ship-check.ts).
 */
create or replace function ship_spec_check(p_lot uuid, p_line uuid)
returns table (kind text, label text, expected text, actual text, ok boolean)
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  with x as (
    select li.id as line_item, li.code as line_code, pi.id as lot_item, pi.code as lot_code,
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
         exists (select 1 from dm_models(x.dm) d where d.id = x.line_item) from x
  union all
  select 'BAND', '작업지시서 원료 두께', want_band, band,
         case when band is null or want_band is null then null else band = want_band end from x
$fn$;
comment on function ship_spec_check(uuid, uuid) is
  '출고 전 형명 검토 (0159). 제품 로트 형명 · 작업지시서 제품 · 원료 두께. ok 가 false 면 출고하지 않고, null 은 볼 수 없음';
grant execute on function ship_spec_check(uuid, uuid) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'grant execute on function ship_spec_check(uuid, uuid) to app_readonly';
  end if;
end $$;

create or replace function trg_shipment_order_line()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_line_cancel timestamptz; v_order_cancel timestamptz; v_po text; v_lot text; r record;
begin
  if tg_op = 'UPDATE' then
    if new.sales_order_line_id is not distinct from old.sales_order_line_id then return new; end if;
    if new.sales_order_line_id is null then
      raise exception '출고에서 주문 줄을 뗄 수 없습니다. 맞는 주문 줄로 바꾸십시오';
    end if;
    if nullif(btrim(coalesce(current_setting('app.change_reason', true), '')), '') is null then
      raise exception '출고의 주문을 바꾸려면 사유를 적으십시오';
    end if;
  elsif new.sales_order_line_id is null then
    raise exception '출고는 주문 줄을 골라야 합니다. 수주에서 주문을 먼저 적으십시오';
  end if;

  select l.cancelled_at, o.cancelled_at, o.customer_po_no
    into v_line_cancel, v_order_cancel, v_po
    from sales_order_line l join sales_order o on o.id = l.sales_order_id
   where l.id = new.sales_order_line_id;
  if v_order_cancel is not null then
    raise exception '주문 %은(는) 취소되어 출고를 붙일 수 없습니다', v_po;
  end if;
  if v_line_cancel is not null then
    raise exception '주문 %의 그 형명 줄은 취소되어 출고를 붙일 수 없습니다', v_po;
  end if;

  for r in select * from ship_spec_check(new.product_lot_id, new.sales_order_line_id) c where c.ok is false loop
    select lot_no into v_lot from product_lot where id = new.product_lot_id;
    raise exception '제조번호 %의 %이(가) 주문과 다릅니다 (주문 % · 실제 %). 오규격은 출고하지 않습니다',
      v_lot, r.label, r.expected, coalesce(r.actual, '없음');
  end loop;
  return new;
end $fn$;
comment on function trg_shipment_order_line() is
  '출고는 살아 있는 주문 줄로만, 형명 검토(ship_spec_check)가 다르면 거부. 주문 바꾸기는 사유 필수 (0159)';

drop trigger if exists shipment_order_line on shipment;
create trigger shipment_order_line before insert or update of sales_order_line_id on shipment
  for each row execute function trg_shipment_order_line();


/* === 8. 작업지시서를 주문 줄에 건다 (사용자 2026-11-25) =================== */
/*
 * «작업지시서를 주문줄에 걸고, 작업지시서가 내부에서 발행되는 경우에는 꼭 주문줄이 걸리지 않아도 되게끔 …
 *  작업지시서는 주문 줄을 고르는걸 권고 하는쪽으로»
 * 한 배치에서 형명이 여럿 나오므로 지시 하나에 주문 줄을 여럿 건다 (사용자 «여럿»). 출고는 걸린 줄이
 * 아니어도 재고가 있으면 나간다 («꼭 작업지시서에 엮인 주문줄이 아니어도 나갈수있도록 열어줘») - 그래서
 * 이 이음은 출고를 막지 않는다. 이 배치가 어느 주문을 위해 낸 것인지 남기고 출고 화면이 먼저 보여 준다.
 */
create table if not exists work_order_so_line (
  id                  uuid primary key default gen_random_uuid(),
  work_order_id       uuid not null references work_order(id),
  sales_order_line_id uuid not null references sales_order_line(id),
  linked_by           uuid not null references app_user(id),
  linked_at           timestamptz not null default now(),
  unlinked_at         timestamptz,
  unlinked_by         uuid references app_user(id),
  unlink_reason       text,
  check (unlinked_at is null or btrim(coalesce(unlink_reason, '')) <> '')
);
comment on table work_order_so_line is
  '작업 지시가 어느 주문 줄을 위해 낸 것인가 (0159). 비면 내부 발행. 떼기는 사유와 함께 적고 지우지 않는다';
create unique index if not exists work_order_so_line_live_uk
  on work_order_so_line (work_order_id, sales_order_line_id) where unlinked_at is null;
create index if not exists work_order_so_line_line_idx on work_order_so_line (sales_order_line_id);

drop trigger if exists work_order_so_line_audit on work_order_so_line;
create trigger work_order_so_line_audit after insert or update or delete
  on work_order_so_line for each row execute function trg_audit('id');
drop trigger if exists work_order_so_line_no_delete on work_order_so_line;
create trigger work_order_so_line_no_delete before delete
  on work_order_so_line for each row execute function trg_block_delete();
drop trigger if exists work_order_so_line_no_truncate on work_order_so_line;
create trigger work_order_so_line_no_truncate before truncate
  on work_order_so_line for each statement execute function trg_block_delete();
grant select, insert, update on work_order_so_line to app_role;
revoke delete, truncate on work_order_so_line from app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke all on work_order_so_line from app_readonly';
    execute 'grant select on work_order_so_line to app_readonly';
  end if;
end $$;

create or replace function trg_wo_so_line_rules()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_code text; v_line_cancel timestamptz; v_order_cancel timestamptz; v_po text; v_wo text;
begin
  if tg_op = 'UPDATE' then
    if new.work_order_id is distinct from old.work_order_id
       or new.sales_order_line_id is distinct from old.sales_order_line_id then
      raise exception '작업 지시와 주문 줄의 이음은 바꾸지 않습니다. 떼고 새로 거십시오';
    end if;
    if old.unlinked_at is not null and new.unlinked_at is null then
      raise exception '뗀 이음은 되돌리지 않습니다. 새로 거십시오';
    end if;
    if new.unlinked_at is not null and old.unlinked_at is null and new.unlinked_by is null then
      new.unlinked_by := current_user_id();
    end if;
    return new;
  end if;

  select i.code, l.cancelled_at, o.cancelled_at, o.customer_po_no
    into v_code, v_line_cancel, v_order_cancel, v_po
    from sales_order_line l join sales_order o on o.id = l.sales_order_id join item i on i.id = l.item_id
   where l.id = new.sales_order_line_id;
  if v_order_cancel is not null or v_line_cancel is not null then
    raise exception '주문 %의 그 줄은 취소되어 작업 지시에 걸 수 없습니다', v_po;
  end if;
  if not exists (select 1 from work_order wo cross join lateral dm_models(wo.device_master_id) d
                  where wo.id = new.work_order_id
                    and d.id = (select item_id from sales_order_line where id = new.sales_order_line_id)) then
    select wo_no into v_wo from work_order where id = new.work_order_id;
    raise exception '주문 줄의 형명 %은(는) 작업 지시 % 제품의 형명이 아닙니다', v_code, v_wo;
  end if;
  return new;
end $fn$;

drop trigger if exists work_order_so_line_rules on work_order_so_line;
create trigger work_order_so_line_rules before insert or update on work_order_so_line
  for each row execute function trg_wo_so_line_rules();


/* === 9. 시연 자료 비우기: 작업 지시 이음 · 주문 장부도 (0159) =============== */
CREATE OR REPLACE FUNCTION public.purge_demo_data()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_me uuid; v_seeded timestamptz; v_after bigint; v_counts jsonb;
begin
  v_me := current_user_id();
  if v_me is null then
    raise exception '로그인 정보가 없습니다';
  end if;

  if not exists (select 1 from user_role
                  where user_id = v_me and role = 'SYS_ADMIN') then
    raise exception '시스템관리자만 시연 자료를 비울 수 있습니다';
  end if;

  select seeded_at into v_seeded from demo_marker limit 1;
  if v_seeded is null then
    raise exception '시연 자료 표시가 없습니다. 비울 것이 없거나 이미 비웠습니다';
  end if;

  /*
   * 표시를 남긴 뒤에 한 줄이라도 움직였으면 거부한다.
   *
   * audit_log 는 모든 입력과 변경을 남기므로, 그 뒤에 행이 있다는 것은 지어낸
   * 자료와 실제 작업이 섞였다는 뜻이다. 섞인 뒤에는 갈라낼 방법이 없고,
   * 갈라내지 못하면 지워서는 안 된다.
   */
  select count(*) into v_after from audit_log where acted_at > v_seeded;
  if v_after > 0 then
    raise exception
      '시연 자료를 넣은 뒤에 기록이 %건 더 쌓였습니다. 지어낸 자료와 실제 기록을 '
      '갈라낼 수 없으므로 비우지 않습니다', v_after;
  end if;

  if not only_demo_data() then
    raise exception '시연 자료 표시 앞에 다른 기록이 있거나 기준선이 없습니다. '
      '이 DB 는 시연 전용이라고 증명되지 않습니다';
  end if;

  select jsonb_build_object(
      '작업지시', (select count(*) from work_order),
      '제품로트', (select count(*) from product_lot),
      '공정기록', (select count(*) from process_record),
      '자재로트', (select count(*) from material_lot),
      '출고',     (select count(*) from shipment),
      '주문',     (select count(*) from sales_order))
    into v_counts;

  /* 배치에서 갈라져 나온 것부터. 참조가 걸린 순서를 거슬러 올라간다 */
  delete from shipment;
  /* 작업 지시 · 주문 줄을 가리킨다 (0159). 지우기를 막는 표라 증명이 서 있는 앞쪽에서 */
  delete from work_order_so_line;
  /*
   * 주문 장부도 비운다 (0159). 시연 자료는 출고마다 주문을 낸다 (seed-flow) - 남겨 두면 지어낸 거래처와
   * 주문이 첫날부터 남은 수량을 가진 채 서 있다. 줄이 주문서를, 주문서가 거래처를 가리키므로 그 차례로.
   * 지우기를 막는 표라 증명이 서 있는 앞쪽(출고 바로 뒤)에서 지운다.
   */
  delete from sales_order_line;
  delete from sales_order;
  delete from customer;
  delete from steril_batch_lot;
  delete from steril_batch;
  delete from product_nonconformity;
  delete from wip_nonconformity;
  delete from stock_movement;      -- material_issue 를 가리킨다 (0056). 먼저 지운다
  delete from material_issue;
  delete from day_lock;
  /* 인쇄물에 담긴 제품 로트. record_print 를 가리키므로 먼저 지운다 (0105) */
  delete from record_print_lot;
  delete from record_print;
  delete from record_correction;   -- process_record 를 가리킨다 (0128)
  delete from br_entry;            -- process_record 를 가리킨다 (0132)
  /* 원액 로트를 가리킨다 (0145). 지우기를 막는 표라 증명이 서 있는 앞쪽에서 지운다 */
  delete from solution_br_entry;
  /* 제품 로트 · 배치를 가리킨다 (0149). 지우기를 막는 표라 앞쪽에서 */
  delete from process_skip;
  delete from process_record;
  delete from product_lot;
  delete from work_order_plan;
  delete from work_request;        -- work_order 를 가리킨다 (0136)
  delete from work_order;

  /*
   * 자재 로트도 지운다. 남겨 두면 잔여 수량이 지어낸 불출만큼 깎인 채로 남아,
   * 실물과 맞지 않는 재고가 첫날부터 서 있게 된다. 실 운영은 실제 성적서 번호로
   * 다시 입고하면서 시작하는 것이 맞다.
   *
   * material_lot 이 purchase_order 를 가리키므로 로트를 먼저 지운다.
   */
  delete from material_lot;
  delete from purchase_order;

  delete from demo_marker;

  /* 지운 사실은 남긴다. 지우는 것과 지웠다는 사실을 지우는 것은 다르다 */
  insert into audit_log (table_name, record_id, action, actor_id, old_value, new_value)
  values ('demo_marker', gen_random_uuid(), 'PURGE', v_me, v_counts,
          jsonb_build_object('purged_at', now(), 'seeded_at', v_seeded));

  return format('시연 자료를 비웠습니다. 작업지시 %s · 제품로트 %s · 공정기록 %s · 자재로트 %s',
                v_counts->>'작업지시', v_counts->>'제품로트',
                v_counts->>'공정기록', v_counts->>'자재로트');
end $function$;
