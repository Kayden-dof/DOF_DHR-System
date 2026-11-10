/* ---------------------------------------------------------------------------
   로트 없이 쓰는 소모품 · 개정본 복사가 빠뜨린 칸 (사용자 2026-11-10)

   ── 1. 로트 없이 쓰는 소모품 ─────────────────────────────────────────
   타이벡 파우치(PM-021)는 초임계 가공에 들어가지만 로트번호 없이 단순
   소모품으로 쓴다. 종이 제조기록서도 부여로트번호 칸에 '-' 를 적는다.
   사용자: "굳이 로트 번호를 기입할 필요 없어서 그냥 공란을 디폴트값으로".

   그런데 시스템은 구성표에 걸린 자재마다 로트가 기록되기를 바랐다 -
   공정 마감(S05)은 로트 투입이나 해당없음 사유를 요구했고, 사유로 넘기면
   검토가 "기입 누락" 으로 짚었다. 로트가 없는 물건에 로트를 요구한 셈이다.
   운영에는 PM-021 로트가 한 건도 없다.

   품목에 lot_tracked 를 둔다. 기본은 참(지금과 같다). 거짓인 품목은
     - 공정 마감이 그 줄의 투입 기록을 묻지 않는다 (S05)
     - 그 품목만 걸린 공정을 사유로 마감해도 검토가 짚지 않는다
     - 현장 화면은 그 줄을 "로트 없음" 으로 보이고 남은 자재로 세지 않는다
   구성표 줄은 그대로 남는다. 작업 지시서 · 준비물 목록의 수량은 계속 나간다.
   기록지 인쇄는 바꾸지 않는다 - 투입 기록이 없으니 그 칸은 원래 공란이다.

   ── 2. 개정본 복사 ─────────────────────────────────────────────────
   copy_dmr_structure(0038) 는 그 뒤에 생긴 칸을 몰랐다. 재작업 수량을
   적는 공정(takes_rework · 0096)과 구간 양의 상한(qty_max · 0128)이 복사본에서
   빠져, Rev.01 을 만들면 조용히 사라졌다. 함께 옮긴다.
--------------------------------------------------------------------------- */

/* === 1. 품목: 로트를 기록하는가 ========================================== */
alter table item add column if not exists lot_tracked boolean not null default true;

comment on column item.lot_tracked is
  '투입할 때 로트를 기록하는 품목인가. 거짓이면 로트 없이 쓰는 소모품이라 공정 마감(S05)과 검토가 그 줄의 투입 기록을 묻지 않는다 (0129)';


/* === 2. S05: 로트 없이 쓰는 소모품은 묻지 않는다 =========================
 * 0039 의 정의에서 조건 한 줄(i.lot_tracked)만 더했다.
 */
create or replace function complete_process(p_pr uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_wo uuid; v_op uuid; v_reason text; missing text;
begin
  select work_order_id, operation_id, no_material_reason
    into v_wo, v_op, v_reason
    from process_record where id = p_pr for update;

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
  end if;

  update process_record set ended_at = coalesce(ended_at, now()) where id = p_pr;

  update work_order set status = 'IN_PROCESS'
   where id = v_wo and status = 'ISSUED';
end $fn$;

grant execute on function complete_process(uuid) to app_role;


/* === 3. 검토: 로트 없이 쓰는 소모품만 걸린 공정의 사유 마감은 짚지 않는다 ==
 * 0128 의 정의를 그대로 옮기고 사유 마감 갈래의 조건만 고쳤다.
 */
create or replace function review_flags_base(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable as $$

  select distinct '시각 모순'::text,
         format('%s(%s) %s일차 %s: 시작 %s, 종료 %s - 시각이 역전되어 있음',
                o.name, o.code, pr.day_no, u.full_name,
                to_char(timezone('Asia/Seoul', pr.started_at), 'HH24:MI'),
                to_char(timezone('Asia/Seoul', pr.ended_at),   'HH24:MI')),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join app_user u on u.id = pr.worker_id
   where pr.work_order_id = p_wo
     and pr.started_at is not null and pr.ended_at is not null
     and pr.ended_at < pr.started_at

  union all

  select distinct '시각 모순'::text,
         format('%s%s(%s) 종료 %s 보다 %s(%s) 시작 %s 가 빠름',
                coalesce(pl.lot_no || ' ', ''),
                a.name, a.code, to_char(timezone('Asia/Seoul', pa.ended_at),  'MM-DD HH24:MI'),
                b.name, b.code, to_char(timezone('Asia/Seoul', pb.started_at),'MM-DD HH24:MI')),
         pb.day_no, b.code
    from process_record pa
    join dmr_operation a on a.id = pa.operation_id
    join process_record pb on pb.work_order_id = pa.work_order_id
    join dmr_operation b on b.id = pb.operation_id
    left join product_lot pl on pl.id = pb.product_lot_id
   where pa.work_order_id = p_wo
     and b.seq = a.seq + 1
     and pa.ended_at is not null and pb.started_at is not null
     and pb.started_at < pa.ended_at
     and pa.product_lot_id is not distinct from pb.product_lot_id

  union all

  select '수량 불일치'::text,
         format('%s %s: 불출 %s, 반납 %s - 반납이 더 큼',
                i.name, ml.lot_no,
                trim(to_char(x.issued, 'FM999999990.###')),
                trim(to_char(x.returned, 'FM999999990.###'))),
         null::int, ml.lot_no
    from (
      select mi.material_lot_id,
             sum(mi.qty) as issued,
             coalesce((select sum(sm.qty) from stock_movement sm
                        where sm.work_order_id = p_wo
                          and sm.type = 'RETURN'
                          and sm.material_lot_id = mi.material_lot_id), 0) as returned
        from material_issue mi
        join process_record pr on pr.id = mi.process_record_id
       where pr.work_order_id = p_wo
       group by mi.material_lot_id
    ) x
    join material_lot ml on ml.id = x.material_lot_id
    join item i on i.id = ml.item_id
   where x.returned > x.issued

  union all

  select '구간 이탈'::text,
         format('%s(%s) %s: 장입 %s장 기준 %s %s 인데 %s %s 기입',
                o.name, o.code, i.name, wo.sheet_count,
                trim(to_char(x.need, 'FM999999990.###'))
                  || case when x.need_max > x.need
                          then '~' || trim(to_char(x.need_max, 'FM999999990.###')) else '' end,
                i.usage_uom,
                trim(to_char(x.put,  'FM999999990.###')), i.usage_uom),
         pr.day_no, o.code
    from (
      select pr2.id as pr_id, ml2.item_id, sum(mi2.qty) as put,
             required_qty(pr2.operation_id, ml2.item_id, wo2.sheet_count, 0) as need,
             required_qty_max(pr2.operation_id, ml2.item_id, wo2.sheet_count) as need_max
        from material_issue mi2
        join process_record pr2 on pr2.id = mi2.process_record_id
        join work_order wo2 on wo2.id = pr2.work_order_id
        join material_lot ml2 on ml2.id = mi2.material_lot_id
       where pr2.work_order_id = p_wo
       group by pr2.id, ml2.item_id, pr2.operation_id, wo2.sheet_count
    ) x
    join process_record pr on pr.id = x.pr_id
    join dmr_operation o on o.id = pr.operation_id
    join work_order wo on wo.id = pr.work_order_id
    join item i on i.id = x.item_id
    join dmr_bom b on b.operation_id = pr.operation_id and b.component_item_id = x.item_id
   where b.basis = 'SHEET_TIER'
     and x.need is not null
     and (x.put < x.need or x.put > coalesce(x.need_max, x.need))

  union all

  select '기입 누락'::text,
         format('%s(%s) %s일차: 자재를 기록하지 않고 마감함 - 사유 "%s"',
                o.name, o.code, pr.day_no, pr.no_material_reason),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
   where pr.work_order_id = p_wo
     and pr.no_material_reason is not null
     /* 로트 없이 쓰는 소모품만 걸린 공정은 적을 자재가 없다 (0129) */
     and exists (select 1 from dmr_bom b join item bi on bi.id = b.component_item_id
                  where b.operation_id = pr.operation_id and bi.lot_tracked)

  union all

  select '기입 누락'::text,
         format('%s(%s) %s일차 %s: 종료 시각이 빈 채로 기록서가 발행됨',
                o.name, o.code, pr.day_no, u.full_name),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join app_user u on u.id = pr.worker_id
   where pr.work_order_id = p_wo
     and pr.ended_at is null
     and exists (select 1 from day_lock dl
                  where dl.work_order_id = pr.work_order_id
                    and dl.day_no = pr.day_no
                    and dl.worker_id = pr.worker_id)

  union all

  select '참조 불일치'::text,
         format('지정 원재료는 %s 인데 %s 가 투입됨 (%s · %s)',
                spec.lot_no, ml.lot_no, o.name, o.code),
         pr.day_no, ml.lot_no
    from material_issue mi
    join process_record pr on pr.id = mi.process_record_id
    join dmr_operation o on o.id = pr.operation_id
    join material_lot ml on ml.id = mi.material_lot_id
    join item i on i.id = ml.item_id
    join work_order wo on wo.id = pr.work_order_id
    join material_lot spec on spec.id = wo.material_lot_id
   where pr.work_order_id = p_wo
     and i.type = 'RAW'
     and ml.id <> wo.material_lot_id

  union all

  /* --- 8. 예정 개수와 재단 개수가 다름 (형명별이 아니라 총량) ------------- */
  select '수량 불일치'::text,
         format('예정 %s개, 재단 %s개', wo.planned_units, x.made),
         null::int, wo.batch_no
    from work_order wo
    join (
      select work_order_id, sum(qty_produced)::int as made
        from product_lot where work_order_id = p_wo group by work_order_id
    ) x on x.work_order_id = wo.id
   where wo.id = p_wo
     and wo.planned_units is not null
     and x.made <> wo.planned_units
$$;

grant execute on function review_flags_base(uuid) to app_role;

grant execute on function review_flags_base(uuid) to app_role;


/* === 4. 개정본 복사가 재작업 칸 · 구간 상한을 함께 옮긴다 ==================
 * 0038 의 정의에 takes_rework 와 qty_max 를 더했다.
 */
create or replace function copy_dmr_structure(p_src uuid, p_dst uuid)
returns int language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
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
      (device_master_id, seq, code, name, after_cutting, typical_day, takes_rework)
    values
      (p_dst, r.seq, r.code, r.name, r.after_cutting, r.typical_day, r.takes_rework)
    returning id into new_op;
    n := n + 1;

    for b in select * from dmr_bom where operation_id = r.id loop
      insert into dmr_bom (operation_id, component_item_id, basis, qty_per_unit)
      values (new_op, b.component_item_id, b.basis, b.qty_per_unit)
      returning id into new_bom;

      insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty, qty_max)
      select new_bom, t.min_sheets, t.max_sheets, t.qty, t.qty_max
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
