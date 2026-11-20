/* ===========================================================================
   0144 · 로트 없이 쓰는 소모품의 재고 - 입고하고, 공정 마감 때 자동으로 차감한다
   (사용자 2026-11-20)

   "로트 번호가 없는건 재고 증감을 못하는건가.. 타이벡 파우치같은건 로트 번호가
    없는걸...?"  → «자동 차감까지 (권고)»

   재고는 로트에 있다. 입고 로트는 성적서 번호 · 일자 · 공급자 · 공급자 로트가 모두
   있어야 했다 (S02 · material_lot_source 0118). 타이벡 파우치(PM-021)처럼 로트 ·
   성적서가 없는 소모품은 입고할 길이 없어 로트 0 · 재고 0 이었고, 0129 가 현장에서
   로트를 묻지 않게 한 뒤로는 써도 아무것도 줄지 않았다.

   ── 1. 입고: 로트 없이 쓰는 소모품은 성적서 · 공급자 로트 없이 ─────────────
   lot_tracked 가 거짓인 품목만 성적서 번호 · 일자 · 공급자 로트를 비우고 입고한다.
   공급자는 그대로 필수다. 사내 로트번호는 지금처럼 채번 규칙이 붙인다 (재고 · 조정 ·
   반납이 로트 단위로 돈다). 로트를 기록하는 품목은 지금과 같이 넷 모두 필수 (S02).

   표의 검사(check)는 품목을 볼 수 없으므로 «공급자가 있다» 까지만 묻고, 나머지는
   트리거가 품목을 보고 묻는다.

   ── 2. 공정 마감: 구성표 소요량만큼 자동 투입 ───────────────────────────────
   공정 마감(complete_process)이 로트 없이 쓰는 소모품마다 구성표 소요량을
   (장입 구간 · 제품 개수) 셈해, 쓸 수 있는 로트(AVAILABLE · 잔량 · 유효기한)에서
   오래된 입고부터 투입 기록을 남긴다. 투입 기록 트리거(0013)가 잔량을 줄인다.
     · 자재 미사용 사유로 마감한 공정은 차감하지 않는다.
     · 그 기록에 그 품목 투입이 이미 있으면 다시 하지 않는다 (마감을 두 번 불러도 한 번).
     · 재고가 모자라면 있는 만큼만 차감하고 마감은 막지 않는다 - 차단은 S01~S05 뿐이다.
   현장은 지금처럼 로트를 묻지 않고, 제조기록서의 부여로트번호 칸도 공란이다
   (noLotCodes · 0129). 투입량은 기록서 결과 셈에 들어간다.
=========================================================================== */

/* === 1. 입고 로트의 출처 (S02) ============================================ */
alter table material_lot drop constraint if exists material_lot_source;
alter table material_lot add constraint material_lot_source check (
  (made_on is null and supplier_id is not null)
  or
  (made_on is not null
     and coa_no is null and coa_date is null
     and supplier_id is null and supplier_lot_no is null)
);

comment on constraint material_lot_source on material_lot is
  'S02 두 갈래. 입고 로트는 공급자가 있고 (성적서 · 공급자 로트는 트리거 trg_ml_s02 가 품목을 보고 묻는다), '
  '원액 로트는 넷이 모두 비고 제조일이 있다 (0118 · 0144)';

create or replace function trg_ml_s02()
returns trigger language plpgsql as $fn$
declare v_tracked boolean; v_name text;
begin
  if new.made_on is not null then
    return new;                                   -- 원액 갈래는 0118 이 본다
  end if;
  if new.coa_no is not null and btrim(new.coa_no) <> ''
     and new.coa_date is not null
     and new.supplier_lot_no is not null and btrim(new.supplier_lot_no) <> '' then
    return new;
  end if;
  select lot_tracked, name into v_tracked, v_name from item where id = new.item_id;
  if coalesce(v_tracked, true) then
    /* 표의 검사가 막던 자리다 - 같은 오류 갈래(검사 위반)로 낸다 */
    raise exception 'S02: % 은(는) 성적서 번호 · 일자 · 공급자 로트번호가 있어야 입고할 수 있습니다', v_name
      using errcode = 'check_violation';
  end if;
  /* 로트 없이 쓰는 소모품: 빈 글은 비운 것으로 둔다 */
  new.coa_no := nullif(btrim(coalesce(new.coa_no, '')), '');
  new.supplier_lot_no := nullif(btrim(coalesce(new.supplier_lot_no, '')), '');
  return new;
end $fn$;

drop trigger if exists material_lot_s02 on material_lot;
create trigger material_lot_s02 before insert or update of coa_no, coa_date, supplier_lot_no, item_id, made_on
  on material_lot for each row execute function trg_ml_s02();


/* === 2. 공정 마감: 로트 없이 쓰는 소모품 자동 투입 =========================
 * 0129 의 정의에 자동 투입 한 덩이를 더했다. S05 · 마감 · 지시 상태는 그대로.
 */
create or replace function complete_process(p_pr uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_wo uuid; v_op uuid; v_reason text; missing text;
  v_worker uuid; v_sheets int; v_units int;
  c record; l record; v_left numeric; v_take numeric;
begin
  select pr.work_order_id, pr.operation_id, pr.no_material_reason, pr.worker_id,
         w.sheet_count, coalesce(pl.qty_produced, w.planned_units, 0)
    into v_wo, v_op, v_reason, v_worker, v_sheets, v_units
    from process_record pr
    join work_order w on w.id = pr.work_order_id
    left join product_lot pl on pl.id = pr.product_lot_id
   where pr.id = p_pr for update of pr;

  if not found then
    raise exception '공정 기록을 찾을 수 없습니다';
  end if;

  if v_reason is null then
    select string_agg(i.name, ', ') into missing
      from dmr_bom b join item i on i.id = b.component_item_id
     where b.operation_id = v_op
       and i.lot_tracked
       and not exists (
         select 1 from material_issue mi
           join material_lot ml on ml.id = mi.material_lot_id
          where mi.process_record_id = p_pr
            and ml.item_id = b.component_item_id);

    if missing is not null then
      raise exception 'S05: 자재가 기록되지 않았습니다 (%). 기록하거나 해당없음 사유를 입력하십시오', missing;
    end if;

    /* 로트 없이 쓰는 소모품: 구성표 소요량만큼 오래된 입고부터 (0144) */
    for c in
      select b.component_item_id as item_id,
             required_qty(v_op, b.component_item_id, v_sheets, v_units) as need
        from dmr_bom b join item i on i.id = b.component_item_id
       where b.operation_id = v_op and not i.lot_tracked
    loop
      continue when c.need is null or c.need <= 0;
      continue when exists (
        select 1 from material_issue mi join material_lot ml on ml.id = mi.material_lot_id
         where mi.process_record_id = p_pr and ml.item_id = c.item_id);
      v_left := c.need;
      for l in
        select id, qty_available from material_lot
         where item_id = c.item_id and status = 'AVAILABLE' and qty_available > 0
           and (expiry_date is null or expiry_date >= (now() at time zone 'Asia/Seoul')::date)
         order by received_at, lot_no
         for update
      loop
        exit when v_left <= 0;
        v_take := least(v_left, l.qty_available);
        insert into material_issue (process_record_id, material_lot_id, qty, issued_by)
        values (p_pr, l.id, v_take, coalesce(current_user_id(), v_worker));
        v_left := v_left - v_take;
      end loop;
    end loop;
  end if;

  update process_record set ended_at = coalesce(ended_at, now()) where id = p_pr;

  update work_order set status = 'IN_PROCESS'
   where id = v_wo and status = 'ISSUED';
end $fn$;
