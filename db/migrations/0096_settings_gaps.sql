-- ---------------------------------------------------------------------------
-- 설정으로 열어야 할 것이 아직 코드에 있었다 (6차 감사 · §2.0)
--
-- "프로그램만으로 모든 셋팅이 되는가" 를 다시 물어 나온 것들이다. 둘로 나뉜다.
--
--   ① 그 제조소가 정할 값인데 코드가 정하고 있었다
--   ② 같은 것을 두 곳이 서로 다르게 정하고 있었다 (§10 복제는 갈라진다)
--
-- ── N1. 임박 문턱 ──────────────────────────────────────────────────────
-- "유효기한이 며칠 남으면 눈에 띄게 하는가" 가 네 화면과 함수 하나에 박혀
-- 있었다. 게다가 **화면마다 달랐다** - 설비 밸리데이션을 자재 화면은 30일로,
-- 첫 화면은 7일로 보고 있었다. 같은 것을 두 자리가 다르게 말하면 둘 다
-- 못 믿는다.
--
-- 며칠인지는 그 제조소의 절차가 정한다. 한 자리에 두고 화면이 읽어 간다.
--
-- ── N6. 재포장 수량 칸 ────────────────────────────────────────────────
-- 현장 화면이 **공정 이름에 '포장' 이 들어갈 때만** 재포장 수량 칸을 냈다.
-- 그 공정을 '1차 밀봉' 이라 부르는 제조소는 그 칸을 영영 못 본다. 재포장
-- 수량은 §7 이 제조기록서의 핵심 항목으로 적어 둔 값인데, 이름 하나로
-- 적을 길이 사라진다.
--
-- 이름이 아니라 제품표준서가 정한다. 어느 공정에서 재작업 수량을 적는지는
-- 그 공정을 등록하는 사람이 안다.
--
-- 판정하지 않는다. 재작업이 옳은지 그른지 묻지 않고, 그 칸을 낼지만 정한다.
-- ---------------------------------------------------------------------------

-- === N1. 임박 문턱을 한 자리로 =============================================

alter table org_brand add column if not exists expiry_warn_days int;

update org_brand set expiry_warn_days = 30 where expiry_warn_days is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expiry_warn_days_range') then
    alter table org_brand add constraint expiry_warn_days_range
      check (expiry_warn_days is null or expiry_warn_days between 1 and 400);
  end if;
end $$;

comment on column org_brand.expiry_warn_days is
  '유효기한 · 밸리데이션이 며칠 남으면 화면이 눈에 띄게 하는가. 그 제조소의 '
  '절차가 정한다 (6차 감사 N1)';


-- === N6. 재작업 수량을 적는 공정 ===========================================

alter table dmr_operation
  add column if not exists takes_rework boolean not null default false;

comment on column dmr_operation.takes_rework is
  '이 공정에서 재작업(재포장) 수량을 적는가. 전에는 공정 이름에 "포장" 이 '
  '들어가는지로 정했다 - 그 공정을 달리 부르는 제조소는 그 칸을 못 봤다 '
  '(6차 감사 N6)';

/*
 * 이미 있는 제품표준서에는 지금 화면이 하던 대로를 옮겨 심는다. 그래야
 * 고친 뒤에도 같은 자리에 같은 칸이 난다. 새로 만드는 곳에는 아무것도
 * 심지 않는다 - 그 제조소가 고른다.
 *
 * ── 동결 트리거를 이 문장에서만 내린다 ────────────────────────────────
 * 0089 가 지시가 나간 개정본의 공정을 얼린다. 옳은 차단이고, 사람이 고쳐
 * 쓰는 것을 막는다. 그런데 이것은 사람의 수정이 아니라 **없던 열에 지금
 * 동작을 옮겨 적는 구조 이관**이다. 옮기지 않으면 이미 도는 제조소에서
 * 재포장 칸이 조용히 사라진다.
 *
 * 감사 트리거는 그대로 둔다 - 무엇이 바뀌었는지는 남아야 한다. 그래서
 * session_replication_role 로 전부 내리지 않고 그 트리거 하나만 내린다.
 */
alter table dmr_operation disable trigger dmr_operation_frozen;

update dmr_operation set takes_rework = true
 where not takes_rework and name like '%포장%';

alter table dmr_operation enable trigger dmr_operation_frozen;


-- === N1 이 함수에도 있었다 =================================================
--
-- work_order_warnings 가 유효기한 임박을 `+ 30` 으로 보고 있었다. 화면이
-- 설정을 읽는데 함수만 코드로 남으면 또 갈라진다.

create or replace function work_order_warnings(
  p_material_lot uuid, p_sheets int, p_device_master uuid default null)
returns table (kind text, detail text)
language plpgsql stable
set search_path = pg_catalog, public, pg_temp as $fn$
declare ml record; sup record; lo int; hi int; warn int;
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

  /* 며칠 남으면 알릴지는 설정이 정한다 (6차 감사 N1) */
  select coalesce(expiry_warn_days, 30) into warn from org_brand limit 1;

  if ml.expiry_date is not null
     and ml.expiry_date < (timezone('Asia/Seoul', now()))::date + coalesce(warn, 30) then
    kind := '유효기한 임박';
    detail := format('로트 %s 유효기한 %s', ml.lot_no, ml.expiry_date);
    return next;
  end if;

  if p_device_master is not null then
    select dm.sheet_min, dm.sheet_max into lo, hi
      from device_master dm where dm.id = p_device_master;

    if hi is not null and p_sheets > hi then
      kind := '장입 상한 초과';
      detail := format('장입 %s장. 제품표준서가 정한 상한은 %s장입니다', p_sheets, hi);
      return next;
    elsif lo is not null and p_sheets < lo then
      kind := '장입 하한 미만';
      detail := format('장입 %s장. 제품표준서가 정한 하한은 %s장입니다', p_sheets, lo);
      return next;
    end if;
  end if;

  if ml.qty_available <= 0 then
    kind := '재고 없음';
    detail := format('로트 %s 잔여 0', ml.lot_no);
    return next;
  elsif p_sheets > ml.qty_available then
    kind := '재고 부족';
    detail := format('장입 %s장 · 로트 %s 잔여 %s장', p_sheets, ml.lot_no, ml.qty_available);
    return next;
  end if;
end $fn$;
