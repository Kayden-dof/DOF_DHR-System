/* ---------------------------------------------------------------------------
   배치 장입을 실제로 적용한다 (3차 검수 결함 3 · 0058 에서 이어짐)

   열거형에 값을 더하는 것과 그 값을 쓰는 것은 같은 트랜잭션에 둘 수 없다.
   그래서 0058 이 값만 더하고 여기서 쓴다.
--------------------------------------------------------------------------- */


/* === 1. 발행하면 그만큼 재고에서 빠진다 ================================= */
create or replace function trg_wo_load_material()
returns trigger language plpgsql as $fn$
declare v_lot text; v_left numeric;
begin
  select lot_no, qty_available into v_lot, v_left
    from material_lot where id = new.material_lot_id for update;

  /*
   * 잔여보다 많이 장입하는 것을 여기서 막지 않는다.
   *
   * §2 는 재고 부족을 경고 항목으로 두었지 차단으로 두지 않았다. 실물이
   * 먼저이고 장부가 뒤따르는 현장에서, 장부가 모자란다고 작업을 세우면
   * 그건 시스템이 판정하는 것이다 (§1).
   *
   * 다만 qty_available 은 음수가 될 수 없으므로 (표 제약) 모자라면 0 까지만
   * 빼고 그 사실을 사유에 적는다. 숫자를 조용히 맞추는 것보다 어긋난 채로
   * 남겨 두는 편이 낫다 - 장부와 실물이 다르다는 것 자체가 정보다.
   */
  insert into stock_movement
    (material_lot_id, type, qty, work_order_id, reason_code, reason_detail,
     registered_by)
  values
    (new.material_lot_id, 'BATCH_LOAD', -least(new.sheet_count, v_left),
     new.id, '배치 장입',
     case when v_left < new.sheet_count
       then format('장입 %s장 · 로트 %s 잔여 %s장. 장부가 실물보다 적어 잔여만큼만 뺐습니다',
                   new.sheet_count, v_lot, v_left)
       else format('장입 %s장 · 로트 %s', new.sheet_count, v_lot) end,
     new.issued_by_prod);

  return new;
end $fn$;

drop trigger if exists work_order_load_material on work_order;
create trigger work_order_load_material after insert on work_order
  for each row execute function trg_wo_load_material();


/* === 2. 발행 전에 모자란 것을 알려 준다 ================================= */
/*
 * 0011 의 경고 목록에 한 줄을 더한다. "재고 없음" 은 잔여가 0 일 때만 떴는데,
 * 원재료가 애초에 차감되지 않아 0 이 될 일이 없었다. 이제는 차감되므로
 * 그 경고도 의미가 생기고, 모자란 경우를 따로 짚어 준다.
 *
 * 경고일 뿐 차단하지 않는다 (§2).
 */
create or replace function work_order_warnings(p_material_lot uuid, p_sheets int)
returns table (kind text, detail text)
language plpgsql stable as $fn$
declare ml record; sup record;
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

  if ml.expiry_date is not null
     and ml.expiry_date < (timezone('Asia/Seoul', now()))::date + 30 then
    kind := '유효기한 임박';
    detail := format('로트 %s 유효기한 %s', ml.lot_no, ml.expiry_date);
    return next;
  end if;

  if p_sheets > 30 then
    kind := '장입 상한 초과';
    detail := format('장입 %s장. WS-02 배치 상한은 30장입니다', p_sheets);
    return next;
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


/* === 3. 이미 발행된 배치의 장입을 소급해 적는다 ========================= */
/*
 * 여섯 배치가 120장을 장입했는데 차감 기록이 하나도 없다. 실제로 일어난 일이
 * 장부에만 없는 것이므로, 사실대로 적는다. 지어내는 것이 아니다.
 *
 * 소급이라는 것을 사유에 적는다. 나중에 이 행을 보는 사람이 왜 발행일보다
 * 늦게 기록되었는지 알아야 한다.
 */
do $$
declare r record; n int := 0; skipped int := 0;
begin
  for r in
    select wo.id, wo.batch_no, wo.sheet_count, wo.material_lot_id, wo.issued_by_prod,
           ml.lot_no, ml.qty_available
      from work_order wo
      join material_lot ml on ml.id = wo.material_lot_id
     where not exists (select 1 from stock_movement sm
                        where sm.work_order_id = wo.id and sm.type = 'BATCH_LOAD')
     order by wo.issued_at
  loop
    if r.qty_available <= 0 then
      skipped := skipped + 1;
      continue;
    end if;
    insert into stock_movement
      (material_lot_id, type, qty, work_order_id, reason_code, reason_detail, registered_by)
    values
      (r.material_lot_id, 'BATCH_LOAD', -least(r.sheet_count, r.qty_available), r.id,
       '배치 장입',
       format('소급 기록 (0059). 배치 %s 장입 %s장 · 로트 %s',
              r.batch_no, r.sheet_count, r.lot_no),
       r.issued_by_prod);
    n := n + 1;
  end loop;

  if n > 0 then
    raise notice '이미 발행된 배치 %건의 장입을 소급해 적었습니다', n;
  end if;
  if skipped > 0 then
    raise notice '잔여가 없어 건너뛴 배치 %건 - 재고 조정으로 따로 맞추십시오', skipped;
  end if;
end $$;
