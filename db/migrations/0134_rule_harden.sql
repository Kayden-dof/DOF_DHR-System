/* ===========================================================================
   0134 · 규칙을 세게 한다 (UI/UX 검수 2026-11-11 · 사용자 «권고대로 진행»)

   검수에서 화면이 막지 않던 자리 넷을 찾았다. 사용자가 권고안을 골랐다.

     1. 승인 기록 없이 «출하 승인» 이 되었다
        로트 «수정» 의 상태 고르개가 모든 상태를 냈다 (화면은 57aec11 에서 고쳤다).
        출고도 승인 기록을 묻지 않았다 (0016 trg_shipment_apply 는 수량만 본다).
     2. 서면 대조를 마친 개정을 고쳐도 대조 확인이 그대로 남았다
        공정을 지울 때만 거뒀다 (dmr/actions.ts deleteOperation).
     3. 시행일을 개정 추가 때만 받았다
        비워 두면 0061 발행 조건을 영영 못 채웠다 (DX2401 Rev.01 이 그렇다).
        고치는 길은 액션이 낸다. 여기서는 지시가 나간 뒤에 바꾸지 못하게 한다.
     4. 완제품 사용기간이 비어도 들어갔다 (그러면 shelf_life_at 이 12 로 떨어진다)

   ── 이것이 차단을 늘리는 것인가 ─────────────────────────────────────────
   1 과 4 는 늘린다. 판정은 여전히 하지 않는다 - 출하 승인은 품질책임자가 종이에
   서명한 사실이고, 시스템은 그 사실이 적혔는지만 본다. 사용자가 정했다.
   2 는 막지 않는다. 고치는 것은 그대로 되고, 대조 확인이 풀릴 뿐이다.
   3 은 0084 · 0089 와 같은 자리다 - 이미 종이에 나간 값을 바꾸지 않는다.

   지금 운영 자료에는 승인 없이 나간 로트가 없다 (2026-11-11 확인, 제품 로트 0건).
=========================================================================== */


/* === 1. 출하 승인은 승인 기록과 함께, 출고는 승인된 로트만 ================== */

create or replace function trg_pl_release_needs_approval()
returns trigger language plpgsql as $fn$
begin
  if new.status = 'RELEASE_APPROVED'
     and old.status is distinct from 'RELEASE_APPROVED'
     and (new.release_approved_by is null or new.release_approved_on is null) then
    raise exception '출하 승인은 품질책임자의 서면 승인(성명 · 일자)과 함께만 적습니다. '
      '출하 화면의 «승인 기록» 을 쓰십시오 (제조번호 %)', new.lot_no;
  end if;
  return new;
end $fn$;

drop trigger if exists product_lot_release_needs_approval on product_lot;
create trigger product_lot_release_needs_approval before update of status on product_lot
  for each row execute function trg_pl_release_needs_approval();

comment on function trg_pl_release_needs_approval() is
  '승인 기록(성명 · 일자) 없이 출하 승인 상태가 되지 않는다 (0134)';


create or replace function trg_shipment_needs_approval()
returns trigger language plpgsql as $fn$
declare v_by text; v_lot text;
begin
  select release_approved_by, lot_no into v_by, v_lot
    from product_lot where id = new.product_lot_id;
  if v_by is null then
    raise exception '제조번호 %은(는) 출하 승인 기록이 없어 출고할 수 없습니다. '
      '품질책임자 서면 승인을 출하 화면에 먼저 적으십시오', v_lot;
  end if;
  return new;
end $fn$;

drop trigger if exists shipment_needs_approval on shipment;
create trigger shipment_needs_approval before insert on shipment
  for each row execute function trg_shipment_needs_approval();

comment on function trg_shipment_needs_approval() is
  '출하 승인 기록이 없는 제품 로트는 출고하지 않는다 (0134)';


/* === 2. 대조한 것이 바뀌면 대조 확인이 풀린다 ============================== */
/*
 * 서면 대조 확인이 짚는 항목 그대로다 (dmr-forms.tsx verifyRows).
 *   제품    제품 코드 · 제품명 · 대표 형명 · 개정 표기 · 시행일 · 예상 생산수량
 *   공정    순서 · 코드 · 이름 · 기록 단위(재단 이후) · 설비
 *   자재    품목 · 소요량 기준 · 수량 · 장입 구간
 * 짚지 않는 값(표준 일차 · 재작업 · 비고 · 장입 범위 · 허가 번호 · 시료 기준)은
 * 바뀌어도 풀지 않는다 - 대조하지 않은 것으로 대조를 거두면 이유를 설명할 수 없다.
 *
 * 시행일은 처음 정하는 것(비어 있다가 날짜가 들어가는 것)은 풀지 않는다. 비어 있는
 * 것을 대조한 개정에 날을 정해 주는 일이고, 그것이 막혀 있던 길이다 (3 번).
 * 정해 둔 날을 바꾸면 푼다.
 *
 * 풀면 status 도 DRAFT 로 돌린다. 화면이 «작성 중» 으로 읽고, 다시 대조하면
 * verifyDeviceMaster 가 ACTIVE 로 올린다. 이미 나간 지시는 건드리지 않는다 -
 * 0061 은 발행(insert) 때만 본다.
 */
create or replace function dmr_unverify(p_dm uuid)
returns void language sql
security definer
set search_path = pg_catalog, public, pg_temp as $fn$
  update device_master
     set verified_at = null, verified_by = null, status = 'DRAFT'
   where id = p_dm and verified_at is not null;
$fn$;

revoke execute on function dmr_unverify(uuid) from public;

/* 본체: 같은 줄을 고치는 순간 함께 거둔다 (before update) */
create or replace function trg_dmr_unverify_self()
returns trigger language plpgsql as $fn$
begin
  if old.verified_at is null then
    return new;                     -- 대조 전이다
  end if;
  if new.verified_at is distinct from old.verified_at then
    return new;                     -- 대조하거나 거두는 그 일 자체다
  end if;
  if new.product_code is distinct from old.product_code
     or new.product_name is distinct from old.product_name
     or new.item_id is distinct from old.item_id
     or new.revision is distinct from old.revision
     or new.expected_units is distinct from old.expected_units
     or (old.effective_from is not null
         and new.effective_from is distinct from old.effective_from) then
    new.verified_at := null;
    new.verified_by := null;
    new.status := 'DRAFT';
  end if;
  return new;
end $fn$;

drop trigger if exists device_master_unverify on device_master;
create trigger device_master_unverify before update on device_master
  for each row execute function trg_dmr_unverify_self();

/* 딸린 표: 넣고 · 고치고 · 지운 뒤에 그 개정의 대조를 거둔다 (after) */
create or replace function trg_dmr_unverify_part()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare r record; v_dm uuid;
begin
  for r in
    select x from (values (case when tg_op <> 'INSERT' then 'old' end),
                          (case when tg_op <> 'DELETE' then 'new' end)) v(x)
     where x is not null
  loop
    v_dm := null;
    if tg_table_name = 'dmr_operation' then
      v_dm := case r.x when 'old' then old.device_master_id else new.device_master_id end;
    elsif tg_table_name = 'operation_equipment' then
      select o.device_master_id into v_dm from dmr_operation o
       where o.id = case r.x when 'old' then old.operation_id else new.operation_id end;
    elsif tg_table_name = 'dmr_bom' then
      select o.device_master_id into v_dm from dmr_operation o
       where o.id = case r.x when 'old' then old.operation_id else new.operation_id end;
    else
      select o.device_master_id into v_dm
        from dmr_bom b join dmr_operation o on o.id = b.operation_id
       where b.id = case r.x when 'old' then old.dmr_bom_id else new.dmr_bom_id end;
    end if;
    if v_dm is not null then
      perform dmr_unverify(v_dm);
    end if;
  end loop;
  return null;
end $fn$;

drop trigger if exists dmr_operation_unverify on dmr_operation;
create trigger dmr_operation_unverify after insert or delete on dmr_operation
  for each row execute function trg_dmr_unverify_part();
drop trigger if exists dmr_operation_unverify_upd on dmr_operation;
create trigger dmr_operation_unverify_upd after update on dmr_operation
  for each row
  when (old.seq is distinct from new.seq or old.code is distinct from new.code
        or old.name is distinct from new.name
        or old.after_cutting is distinct from new.after_cutting)
  execute function trg_dmr_unverify_part();

drop trigger if exists dmr_bom_unverify on dmr_bom;
create trigger dmr_bom_unverify after insert or delete on dmr_bom
  for each row execute function trg_dmr_unverify_part();
drop trigger if exists dmr_bom_unverify_upd on dmr_bom;
create trigger dmr_bom_unverify_upd after update on dmr_bom
  for each row
  when (old.component_item_id is distinct from new.component_item_id
        or old.basis is distinct from new.basis
        or old.qty_per_unit is distinct from new.qty_per_unit
        or old.operation_id is distinct from new.operation_id)
  execute function trg_dmr_unverify_part();

drop trigger if exists dmr_bom_tier_unverify on dmr_bom_tier;
create trigger dmr_bom_tier_unverify after insert or update or delete on dmr_bom_tier
  for each row execute function trg_dmr_unverify_part();

drop trigger if exists operation_equipment_unverify on operation_equipment;
create trigger operation_equipment_unverify after insert or delete on operation_equipment
  for each row execute function trg_dmr_unverify_part();
drop trigger if exists operation_equipment_unverify_upd on operation_equipment;
create trigger operation_equipment_unverify_upd after update on operation_equipment
  for each row
  when (old.is_active is distinct from new.is_active
        or old.equipment_id is distinct from new.equipment_id
        or old.operation_id is distinct from new.operation_id)
  execute function trg_dmr_unverify_part();

comment on function trg_dmr_unverify_part() is
  '서면 대조가 짚는 공정 · 설비 · 자재 · 구간이 바뀌면 그 개정의 대조 확인을 거둔다 (0134)';


/* === 3. 지시가 나간 뒤에는 시행일을 바꾸지 않는다 (0095 정의에 한 줄) ======= */
create or replace function trg_dmr_frozen()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp as $$
declare n int;
begin
  select count(*) into n from work_order where device_master_id = new.id;
  if n = 0 then
    return new;                      -- 아직 아무 지시도 안 나갔다
  end if;

  if new.item_id is distinct from old.item_id then
    raise exception '작업 지시가 나간 제품표준서의 품목은 바꿀 수 없습니다 (지시 %건)', n;
  end if;
  if new.revision is distinct from old.revision then
    raise exception '작업 지시가 나간 제품표준서의 개정번호는 바꿀 수 없습니다 (지시 %건)', n;
  end if;
  if new.product_code is distinct from old.product_code then
    raise exception '작업 지시가 나간 제품표준서의 제품 코드는 바꿀 수 없습니다. '
      '같은 개정번호로 다른 종이가 나갑니다 (지시 %건)', n;
  end if;
  if new.product_name is distinct from old.product_name then
    raise exception '작업 지시가 나간 제품표준서의 제품명은 바꿀 수 없습니다. '
      '같은 개정번호로 다른 종이가 나갑니다 (지시 %건)', n;
  end if;
  if new.license_no is distinct from old.license_no then
    raise exception '작업 지시가 나간 제품표준서의 허가 번호는 바꿀 수 없습니다. '
      '변경허가는 새 개정본으로 등록하십시오 (지시 %건)', n;
  end if;
  /*
   * 시행일도 같다 (0134). 지시가 나간 뒤에 바꾸면 이미 나간 지시가 시행 전에
   * 발행된 것처럼 읽힌다.
   */
  if new.effective_from is distinct from old.effective_from then
    raise exception '작업 지시가 나간 제품표준서의 시행일은 바꿀 수 없습니다. '
      '새 개정본으로 등록하십시오 (지시 %건)', n;
  end if;
  return new;
end $$;


/* === 4. 완제품은 사용기간과 함께 만든다 ================================== */
/*
 * 0061 은 바꾸는 것을 막고 처음 정하는 것은 열어 두었다. 그런데 비워서 만들 수
 * 있었고, 그러면 shelf_life_at() 이 12 로 떨어져 아무도 정하지 않은 유효기한이
 * 로트에 박혔다. 처음 정할 때 비우지 못하게 한다.
 */
create or replace function trg_item_fin_shelf_life()
returns trigger language plpgsql as $fn$
begin
  if new.type = 'FIN' and new.shelf_life_months is null then
    raise exception '완제품 형명 %은(는) 사용기간(개월)과 함께 등록하십시오. '
      '유효기한을 셈할 근거입니다', new.code;
  end if;
  return new;
end $fn$;

drop trigger if exists item_fin_shelf_life on item;
create trigger item_fin_shelf_life before insert on item
  for each row execute function trg_item_fin_shelf_life();
