-- ---------------------------------------------------------------------------
-- 장입 상한 경고가 제품표준서를 보게 한다 (5차 감사 B1)
--
-- 0069 가 장입 범위를 `device_master.sheet_min` · `sheet_max` 로 옮기고
-- 제품표준서 화면에 넣었다 (§2.0). 그런데 발행 화면의 경고만 따라가지 않았다.
--
--     if p_sheets > 30 then
--       kind   := '장입 상한 초과';
--       detail := format('장입 %s장. WS-02 배치 상한은 30장입니다', p_sheets);
--
-- 구조적으로 따라갈 수가 없었다 - 인자가 (자재 로트, 장입 장수) 둘뿐이라
-- 어느 제품표준서인지를 알 방법이 없다.
--
-- 두 가지가 코드에 박혀 있었다.
--   ① 30. 상한 50인 제조소는 31장에서 거짓 경고를 보고, 20인 제조소는
--      25장에서 경고를 못 본다 (트리거는 막으므로 넣지는 못한다)
--   ② WS-02. DX2401 의 공정 코드다. 그 공정이 없는 제조소 화면에 그 이름이 뜬다
--
-- ── 판정하지 않는다 ────────────────────────────────────────────────────
-- 여전히 경고일 뿐 발행을 막지 않는다 (§2 "경고만"). 무엇이 상한인지는
-- 제품표준서가 정하고, 이 함수는 그 값과 견주기만 한다. 범위가 정해지지
-- 않았으면 아무 말도 하지 않는다 - 지어내지 않는다.
--
-- 나머지 검사는 하던 그대로다. 인자 하나가 늘고 장입 대목만 바뀐다.
-- ---------------------------------------------------------------------------

drop function if exists work_order_warnings(uuid, int);

create or replace function work_order_warnings(
  p_material_lot uuid, p_sheets int, p_device_master uuid default null)
returns table (kind text, detail text)
language plpgsql stable
set search_path = pg_catalog, public, pg_temp as $fn$
declare ml record; sup record; lo int; hi int;
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

  /*
   * 장입 범위는 제품표준서가 정한다 (0069 · §2.0). 어느 표준서인지 안 주면
   * 견줄 것이 없으므로 아무 말도 하지 않는다. 지어내는 것보다 낫다.
   */
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

revoke execute on function work_order_warnings(uuid, int, uuid) from public;
grant execute on function work_order_warnings(uuid, int, uuid) to app_role;
grant execute on function work_order_warnings(uuid, int, uuid) to app_readonly;

comment on function work_order_warnings(uuid, int, uuid) is
  '발행 전 경고. 장입 범위는 제품표준서에서 읽는다 - 코드에 박지 않는다 '
  '(5차 감사 B1). 표시만 하고 발행을 막지 않는다 (§2)';
