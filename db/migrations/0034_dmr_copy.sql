-- =============================================================================
-- 0034_dmr_copy.sql  ·  제품표준서 구조를 통째로 복사
-- 근거: 사용자 지시 2026-08-27 ("그런 세트를 입력할 수 있는 형태")
-- =============================================================================
--
-- DX2401 은 시드 스크립트가 넣은 세트다. 같은 것을 화면에서 만들려면 공정 12개 ·
-- 자재 구성표 8개 · 구간 · 설비 연결을 폼으로 마흔 번쯤 눌러야 한다. 새 제품이나
-- 새 개정을 낼 때마다 그 짓을 하면 반드시 어딘가 빠뜨린다.
--
-- 구조를 통째로 뜬다. 공정 · 자재 구성표 · 장입 구간 · 설비 연결까지 한 번에.
--
-- ── 무엇을 복사하지 않는가 ────────────────────────────────────────────────
-- 대조 확인(verified_at) 은 복사하지 않는다. 복사된 표준서는 서면과 다시
-- 대조해야 한다 - 그게 그 확인의 뜻이다. 복사가 확인을 대신하면 안 된다.
-- 예상 생산수량 · 제품 코드도 복사하지 않는다. 새 제품의 값은 새로 정한다.
--
-- ── 언제 거부하는가 ───────────────────────────────────────────────────────
-- 받는 쪽에 공정이 이미 있으면 거부한다. 덮어쓰면 무엇이 지워졌는지 알 수
-- 없고, 이 시스템에는 삭제가 없다 (§10). 비어 있는 표준서에만 붓는다.

create or replace function copy_dmr_structure(p_src uuid, p_dst uuid)
returns int
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  n_op int := 0;
  r record;
  new_op uuid;
  new_bom uuid;
begin
  if p_src = p_dst then
    raise exception '같은 제품표준서로는 복사할 수 없습니다';
  end if;
  if not exists (select 1 from device_master where id = p_src) then
    raise exception '원본 제품표준서를 찾을 수 없습니다';
  end if;
  if not exists (select 1 from device_master where id = p_dst) then
    raise exception '받을 제품표준서를 찾을 수 없습니다';
  end if;
  if exists (select 1 from dmr_operation where device_master_id = p_dst) then
    raise exception '받을 제품표준서에 이미 공정이 있습니다. 비어 있는 표준서에만 복사할 수 있습니다';
  end if;

  for r in
    select * from dmr_operation where device_master_id = p_src order by seq
  loop
    insert into dmr_operation (device_master_id, seq, code, name, after_cutting)
    values (p_dst, r.seq, r.code, r.name, r.after_cutting)
    returning id into new_op;
    n_op := n_op + 1;

    -- 자재 구성표와 장입 구간
    for new_bom in
      select b.id from dmr_bom b where b.operation_id = r.id order by b.component_item_id
    loop
      declare
        b_row dmr_bom%rowtype;
        made  uuid;
      begin
        select * into b_row from dmr_bom where id = new_bom;
        insert into dmr_bom (operation_id, component_item_id, basis, qty_per_unit)
        values (new_op, b_row.component_item_id, b_row.basis, b_row.qty_per_unit)
        returning id into made;

        insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
        select made, t.min_sheets, t.max_sheets, t.qty
          from dmr_bom_tier t where t.dmr_bom_id = b_row.id;
      end;
    end loop;

    -- 설비 연결. 내려간 연결은 가져오지 않는다
    insert into operation_equipment (operation_id, equipment_id, is_active)
    select new_op, oe.equipment_id, true
      from operation_equipment oe
     where oe.operation_id = r.id and oe.is_active;
  end loop;

  return n_op;
end $fn$;

grant execute on function copy_dmr_structure(uuid, uuid) to app_role;
