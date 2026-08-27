/* ---------------------------------------------------------------------------
   공정이 보통 몇 일차에 오는가

   DX2401 은 열두 공정이 하루에 다 끝나지 않는다. NaCl 처리부터 동결건조까지
   며칠에 걸쳐 흐르는데, 그 며칠이 어떻게 나뉘는지는 지금 아무 데도 적혀 있지
   않다. 해 본 사람 머릿속에만 있다 (사용자 지적).

   제품 등록에서 공정마다 "보통 몇 일차"를 받아 두고, 공정을 늘어놓는 자리마다
   작게 함께 보인다. 작업자가 오늘 무엇까지 하는지 가늠하고, 지시서를 받은
   사람이 이 배치가 며칠짜리인지 안다.

   ── 참고값이다. 판정하지 않는다 ───────────────────────────────────────────
   실제 일차는 현장이 정한다. 재세척이 붙으면 하루가 밀리고, 두 공정을 한 날에
   몰아 하기도 한다. 그건 잘못이 아니라 그날의 사정이다.

     · 다른 일차에 기록해도 막지 않는다. 차단은 S01~S05 뿐이다 (§2)
     · 어긋나도 검토 지원에 올리지 않는다. §8.5 는 산술로 답이 하나로 정해지는
       것만 짚는데, "보통과 다르다"는 그런 항목이 아니다. 여기에 표시를 달면
       정상 작업마다 경고가 떠 진짜 표시까지 묻힌다
     · 비워 두면 아무 데도 나오지 않는다. 모르면 적지 않는 것이 맞다

   그래서 expected_units 와 같은 성격이다. 계획을 돕는 값이지 지키게 하는 값이
   아니다.
--------------------------------------------------------------------------- */

alter table dmr_operation
  add column if not exists typical_day int check (typical_day > 0);

comment on column dmr_operation.typical_day is
  '보통 몇 일차에 하는 공정인가. 참고값이며 실제 일차를 제약하지 않는다';

/* 공정 순서와 함께 읽는 값이라 같은 색인에 얹는다 */
create index if not exists dmr_operation_day
  on dmr_operation (device_master_id, typical_day);

/* --- 구조 복사에 함께 실린다 ----------------------------------------------
   0034 의 copy_dmr_structure() 는 공정을 옮길 때 이 열을 몰랐다. 새 제품을
   기존 제품에서 떠 올 때 일차만 빠지면, 옮겼다고 생각한 사람이 빠진 줄 모른다.
-------------------------------------------------------------------------- */
create or replace function copy_dmr_structure(p_src uuid, p_dst uuid)
returns int language plpgsql security definer as $$
declare n int := 0; r record; new_op uuid; b record; new_bom uuid;
begin
  if p_src = p_dst then
    raise exception '같은 제품표준서로는 복사할 수 없습니다';
  end if;
  if not exists (select 1 from device_master where id = p_src) then
    raise exception '가져올 제품표준서를 찾을 수 없습니다';
  end if;
  if not exists (select 1 from device_master where id = p_dst) then
    raise exception '옮겨 넣을 제품표준서를 찾을 수 없습니다';
  end if;
  if exists (select 1 from dmr_operation where device_master_id = p_dst) then
    raise exception '받을 제품표준서에 이미 공정이 있습니다. 비어 있는 표준서에만 복사할 수 있습니다';
  end if;

  for r in
    select * from dmr_operation where device_master_id = p_src order by seq
  loop
    insert into dmr_operation
      (device_master_id, seq, code, name, after_cutting, typical_day)
    values
      (p_dst, r.seq, r.code, r.name, r.after_cutting, r.typical_day)
    returning id into new_op;
    n := n + 1;

    for b in select * from dmr_bom where operation_id = r.id loop
      insert into dmr_bom (operation_id, component_item_id, basis, qty_per_unit)
      values (new_op, b.component_item_id, b.basis, b.qty_per_unit)
      returning id into new_bom;

      insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty)
      select new_bom, t.min_sheets, t.max_sheets, t.qty
        from dmr_bom_tier t where t.dmr_bom_id = b.id;
    end loop;

    /* 걸린 설비도 함께 온다. 살아 있는 연결만 */
    insert into operation_equipment (operation_id, equipment_id, is_active)
    select new_op, oe.equipment_id, true
      from operation_equipment oe
     where oe.operation_id = r.id and oe.is_active;
  end loop;

  return n;
end $$;

grant execute on function copy_dmr_structure(uuid, uuid) to app_role;
