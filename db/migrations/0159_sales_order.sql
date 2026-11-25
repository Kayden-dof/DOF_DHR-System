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
