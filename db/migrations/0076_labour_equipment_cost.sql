-- ---------------------------------------------------------------------------
-- 공수와 설비를 원가에 넣는다 (사용자 요청 2026-09-01)
--
-- 0066 이 낸 것은 **자재 원가**였다. 그 파일에 "인건비 · 전기 · 멸균 위탁비가
-- 들어 있지 않다. 화면에 자재 원가라고 못 박아야 한다" 고 적어 두었다. 이제
-- 공수와 설비가 들어간다.
--
-- ── 판정에 관여하지 않는다 ────────────────────────────────────────────────
-- 원가는 적합 · 부적합을 가르지 않는다. 여기 있는 값 중 어느 것도 작업을 막지
-- 않고, 종이에 찍히지도 않는다. §1 의 경계 밖이다.
--
-- ── 감가상각 (사용자 선택) ────────────────────────────────────────────────
-- 설비마다 기준 월 가동시간을 넣고, 월 상각비를 그 시간으로 나눠 시간당
-- 상각비를 얻는다.
--
--   시간당 = (취득원가 - 잔존가치) / 내용연수(월) / 기준 월 가동시간
--
-- 배치가 끝나면 그 자리에서 원가가 나오고, 같은 배치는 언제 돌려도 같은 값이다.
-- "그 달 상각비를 그 달 배치들이 나눈다" 는 방법도 있으나, 그러면 다음 배치가
-- 들어올 때마다 앞 배치의 값이 바뀐다.
--
-- 셋 중 하나라도 비어 있으면 **상각비를 얹지 않는다.** 지어낸 값으로 채우지
-- 않고 화면이 몇 대가 비었는지 적는다.
--
-- ── 공수 단가 (사용자 선택) ───────────────────────────────────────────────
-- 역할별 시간당 단가다. 개인 급여가 DB 에 들어오지 않아 보안상 안전하고,
-- 사람이 드나들어도 단가는 그대로다.
--
-- 시간은 기록의 시작 · 종료 시각에서 잰다. 둘 중 하나가 비면 그 기록은 시간이
-- 0 이고, 화면이 몇 건이 그런지 적는다 - 조용히 빼면 적게 나온 줄 모른다.
--
-- 순환자는 세지 않는다. 순환자가 얼마나 있었는지는 기록에 없다 (§11 - 이름만
-- 표시하고 서명하지 않는다). 없는 것을 지어내지 않는다.
-- ---------------------------------------------------------------------------


-- === 1. 설비 구입 정보와 감가상각 ==========================================
alter table equipment add column if not exists purchased_on        date;
alter table equipment add column if not exists purchase_price      numeric;
alter table equipment add column if not exists useful_life_months  int;
alter table equipment add column if not exists salvage_value       numeric;
alter table equipment add column if not exists monthly_hours       numeric;

-- 구입 업체. 자재 공급자(supplier)와 섞지 않는다 - 그쪽은 입고 화면의 선택지가
-- 되고 승인 상태가 경고에 쓰인다. 설비를 판 곳은 그 목록에 들어갈 것이 아니다.
alter table equipment add column if not exists vendor_name         text;
alter table equipment add column if not exists vendor_contact_name text;
alter table equipment add column if not exists vendor_phone        text;
alter table equipment add column if not exists vendor_email        text;
alter table equipment add column if not exists vendor_site         text;
alter table equipment add column if not exists vendor_address      text;

alter table equipment drop constraint if exists equipment_cost_sane;
alter table equipment add  constraint equipment_cost_sane check (
      (purchase_price     is null or purchase_price >= 0)
  and (useful_life_months is null or useful_life_months > 0)
  and (salvage_value      is null or salvage_value >= 0)
  and (monthly_hours      is null or monthly_hours > 0)
  -- 잔존가치가 취득원가보다 크면 상각비가 음수가 된다
  and (purchase_price is null or salvage_value is null or salvage_value <= purchase_price)
);

/*
 * 시간당 상각비. 셋 중 하나라도 비면 null 이고, 그때 원가는 설비 몫을 얹지
 * 않는다. 0 으로 두지 않는다 - 0 은 "공짜" 라는 뜻이고 null 은 "모른다" 다.
 */
create or replace function equipment_hourly_cost(p_code text) returns numeric
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select round((e.purchase_price - coalesce(e.salvage_value, 0))
               / e.useful_life_months / e.monthly_hours, 4)
    from equipment e
   where e.code = p_code
     and e.purchase_price is not null
     and e.useful_life_months is not null
     and e.monthly_hours is not null
$fn$;

comment on function equipment_hourly_cost(text) is
  '설비 시간당 감가상각비. 취득원가 · 내용연수 · 기준 월 가동시간이 다 있어야 값이 나온다';


-- === 2. 공수 단가 =========================================================
create table if not exists labour_rate (
  id             uuid primary key default gen_random_uuid(),
  role           role_code not null,
  hourly_rate    numeric not null check (hourly_rate >= 0),
  effective_from date not null,
  note           text,
  registered_by  uuid not null references app_user(id),
  registered_at  timestamptz not null default now()
);
create index if not exists labour_rate_lookup on labour_rate (role, effective_from desc);

/*
 * 고쳐 쓰지 않는다. 단가를 바꾸려면 새 줄을 넣는다 - 채번 규칙과 같은 규율이다
 * (§4.10 "규칙 변경은 신규 행 추가로 한다"). 잘못 넣었으면 바로잡는 줄을 하나
 * 더 넣고, 두 줄이 다 남는다.
 */
grant select on labour_rate to app_role, app_readonly;
grant insert on labour_rate to app_role;
revoke update, delete on labour_rate from app_role;

/*
 * 그 날짜에 적용되는 단가. 같은 날짜에 두 줄이면 나중에 넣은 것이 이긴다 -
 * 바로잡는 줄이 이겨야 한다.
 */
create or replace function labour_rate_at(p_role role_code, p_on date)
returns numeric language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select r.hourly_rate from labour_rate r
   where r.role = p_role and r.effective_from <= p_on
   order by r.effective_from desc, r.registered_at desc
   limit 1
$fn$;

comment on function labour_rate_at(role_code, date) is
  '그 날짜에 적용되는 역할별 시간당 공수 단가. 없으면 null';


-- === 3. 기록 한 줄의 시간과 값 =============================================
/*
 * 시간은 시작 · 종료 시각에서 잰다. 하나라도 비면 0 시간이고, timed 로
 * 표시해 둔다 - 화면이 "시각이 비어 있는 기록 N건은 빠졌습니다" 라고 적는다.
 *
 * 한 사람이 역할을 여럿 가지면 가장 높은 단가를 쓴다. 3인 현장에서는 생길 일이
 * 없지만, 생겼을 때 조용히 낮은 쪽을 고르면 원가가 적게 나온다.
 */
create or replace view v_process_cost as
select pr.id as process_record_id,
       pr.work_order_id,
       pr.product_lot_id,
       pr.worker_id,
       pr.equipment_id,
       pr.work_date,
       (pr.started_at is not null and pr.ended_at is not null)          as timed,
       coalesce(round(extract(epoch from pr.ended_at - pr.started_at)
                      / 3600.0, 4), 0)                                  as hours,
       (select max(labour_rate_at(ur.role, pr.work_date))
          from user_role ur where ur.user_id = pr.worker_id)            as labour_rate,
       equipment_hourly_cost(pr.equipment_id)                           as equip_rate
  from process_record pr;

grant select on v_process_cost to app_role, app_readonly;

comment on view v_process_cost is
  '기록 한 줄의 작업 시간과 그때의 공수 · 설비 시간당 단가. 시각이 비면 0시간';


-- === 4. 배치 원가에 두 항목을 더한다 =======================================
/*
 * 자재와 같은 짜임으로 가른다. 재단 전(product_lot_id is null)은 배치 공통분,
 * 재단 후는 그 로트 몫이다. 자재를 그렇게 가르고 있으므로 여기서만 다르게 하면
 * 두 값이 다른 뜻을 갖는다.
 */
create or replace view v_batch_cost as
select wo.id as work_order_id, wo.batch_no,
       -- 원재료: 배치에 지정된 로트에서 장입 장수만큼
       coalesce((select ml.unit_price * wo.sheet_count
                   from material_lot ml where ml.id = wo.material_lot_id), 0) as raw_cost,
       -- 재단 전 공정 자재
       coalesce((select sum(mi.qty * coalesce(ml.unit_price, 0))
                   from material_issue mi
                   join process_record pr on pr.id = mi.process_record_id
                   join material_lot ml on ml.id = mi.material_lot_id
                  where pr.work_order_id = wo.id and pr.product_lot_id is null), 0) as pre_cut_cost,
       -- 재단 후 공정 자재 (제품 로트별로 이미 갈림)
       coalesce((select sum(mi.qty * coalesce(ml.unit_price, 0))
                   from material_issue mi
                   join process_record pr on pr.id = mi.process_record_id
                   join material_lot ml on ml.id = mi.material_lot_id
                  where pr.work_order_id = wo.id and pr.product_lot_id is not null), 0) as post_cut_cost,

       -- 공수 · 설비 (재단 전 = 배치 공통분)
       coalesce((select sum(c.hours * c.labour_rate) from v_process_cost c
                  where c.work_order_id = wo.id and c.product_lot_id is null), 0) as pre_cut_labour,
       coalesce((select sum(c.hours * c.equip_rate) from v_process_cost c
                  where c.work_order_id = wo.id and c.product_lot_id is null), 0) as pre_cut_equip,
       coalesce((select sum(c.hours * c.labour_rate) from v_process_cost c
                  where c.work_order_id = wo.id and c.product_lot_id is not null), 0) as post_cut_labour,
       coalesce((select sum(c.hours * c.equip_rate) from v_process_cost c
                  where c.work_order_id = wo.id and c.product_lot_id is not null), 0) as post_cut_equip,

       -- 무엇이 빠졌는가. 화면이 이 수를 그대로 적는다
       (select count(*)::int from v_process_cost c
         where c.work_order_id = wo.id and not c.timed)                            as untimed_records,
       (select count(*)::int from v_process_cost c
         where c.work_order_id = wo.id and c.timed and c.labour_rate is null)      as no_rate_records,
       (select count(distinct c.equipment_id)::int from v_process_cost c
         where c.work_order_id = wo.id and c.equipment_id is not null
           and c.equip_rate is null)                                               as no_equip_cost
  from work_order wo;

comment on view v_batch_cost is
  '배치 원가. 자재 · 공수 · 설비를 재단 전후로 갈라 낸다. 빠진 건수도 함께 낸다';


-- === 5. 로트 · 형명 원가 ===================================================
create or replace view v_product_lot_cost as
with base as (
  select pl.id, pl.lot_no, pl.item_id, pl.work_order_id, pl.qty_produced,
         sum(pl.qty_produced) over (partition by pl.work_order_id) as batch_qty
    from product_lot pl
)
select b.id as product_lot_id, b.lot_no, b.item_id, b.work_order_id, b.qty_produced,
       -- 배치 공통분(원재료 + 재단 전 공정)을 생산 수량 비율로 배분
       round((bc.raw_cost + bc.pre_cut_cost)
             * (b.qty_produced::numeric / nullif(b.batch_qty, 0)), 2) as shared_cost,
       -- 이 로트에만 들어간 재단 후 자재
       coalesce((select sum(mi.qty * coalesce(ml.unit_price, 0))
                   from material_issue mi
                   join process_record pr on pr.id = mi.process_record_id
                   join material_lot ml on ml.id = mi.material_lot_id
                  where pr.product_lot_id = b.id), 0) as own_cost,
       /*
        * 가공비는 뒤에 붙인다. create or replace view 는 있던 열의 이름과
        * 순서를 바꾸지 못한다 - 가운데 끼우면 이관이 서지 않는다.
        */
       round((bc.pre_cut_labour + bc.pre_cut_equip)
             * (b.qty_produced::numeric / nullif(b.batch_qty, 0)), 2) as shared_conv_cost,
       coalesce((select round(sum(c.hours * (coalesce(c.labour_rate, 0)
                                           + coalesce(c.equip_rate, 0))), 2)
                   from v_process_cost c where c.product_lot_id = b.id), 0) as own_conv_cost
  from base b
  join v_batch_cost bc on bc.work_order_id = b.work_order_id;

comment on view v_product_lot_cost is
  '제품 로트별 원가. 자재(cost)와 가공비(conv_cost)를 갈라 낸다 - 합치면 어디서 온 값인지 사라진다';


create or replace view v_item_cost as
with lot as (
  select lc.work_order_id, lc.item_id, lc.qty_produced,
         lc.own_cost::numeric      as own_cost,
         lc.own_conv_cost::numeric as own_conv_cost,
         lc.qty_produced * item_area_cm2(i.code) as area,
         pl.manufactured_on
    from v_product_lot_cost lc
    join item i on i.id = lc.item_id
    join product_lot pl on pl.id = lc.product_lot_id
),
/* 배치 안에서 나눈다. 배치를 넘어 섞으면 다른 가죽의 값이 옮겨 붙는다 */
batch as (
  select work_order_id, sum(area) as batch_area from lot group by 1
)
select l.item_id, i.code as item_code, i.name as item_name,
       item_area_cm2(i.code)                                   as area_cm2,
       date_trunc('month', l.manufactured_on)::date            as month,
       sum(l.qty_produced)::int                                as qty,
       /* 배치 공통분(원재료 + 재단 전 공정)을 면적 몫으로 */
       round(sum((bc.raw_cost + bc.pre_cut_cost)
                 * (l.area / nullif(b.batch_area, 0))), 2)     as shared_cost,
       /* 이 형명에만 들어간 재단 후 자재 */
       round(sum(l.own_cost), 2)                               as own_cost,
       /* 공수 · 설비도 같은 몫으로 */
       round(sum((bc.pre_cut_labour + bc.pre_cut_equip)
                 * (l.area / nullif(b.batch_area, 0))), 2)     as shared_conv_cost,
       round(sum(l.own_conv_cost), 2)                          as own_conv_cost
  from lot l
  join item i on i.id = l.item_id
  join batch b on b.work_order_id = l.work_order_id
  join v_batch_cost bc on bc.work_order_id = l.work_order_id
 group by l.item_id, i.code, i.name, 4, 5;

comment on view v_item_cost is
  '제품코드별 원가. 배치 공통분은 면적으로 배분한다. 자재와 가공비(공수 · 설비)를 갈라 낸다. 전기 · 멸균 위탁비는 아직 들어 있지 않다';

grant select on v_item_cost to app_role, app_readonly;


-- === 6. 감사추적 ==========================================================
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'labour_rate_audit') then
    create trigger labour_rate_audit after insert or update
      on labour_rate for each row execute function trg_audit();
  end if;
  /* 설비 표에 값이 늘었다. 이미 걸려 있지 않으면 건다 */
  if not exists (select 1 from pg_trigger where tgname = 'equipment_audit') then
    create trigger equipment_audit after insert or update
      on equipment for each row execute function trg_audit();
  end if;
end $$;
