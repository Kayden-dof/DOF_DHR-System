/* ===========================================================================
   0156 · 확인해 볼 항목은 적힌 기록의 문제만 (사용자 2026-11-20)

   "시스템 기록에 대한 특이 사항은 언급하지 말것. 작성된 기록에서의 문제만을 언급할것" → «둘 다».

   시스템 시작 · 종료 시각(process_record.started_at · ended_at)으로 짚던 세 가지를 뺀다.
     시각 모순 (시작이 종료보다 늦음)
     시각 모순 (앞 공정 종료보다 다음 공정 시작이 빠름)
     기입 누락 (종료 시각이 빈 채로 기록서가 발행됨)
   종이의 시각은 기록서 칸에 사람이 적은 값이고, 시스템 시각은 화면을 누른 때라 종이를 뒤에 옮겨 적으면
   어긋난다. 나머지(수량 불일치 · 구간 이탈 · 자재 미기록 · 참조 불일치)는 0155 그대로다.
   기록서 특이사항 칸의 «시스템 기록 · 시작 · 종료 · 설비 …» 줄은 화면 쪽에서 뺀다 (app/print/day-record).
=========================================================================== */

create or replace function review_flags_base(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable as $$

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
      /* 투입 - 반납 (0154). 반납은 stock_movement 의 RETURN 줄이다 (0041 · 0056) */
      select pr2.id as pr_id, ml2.item_id,
             sum(mi2.qty - coalesce((select sum(sm.qty) from stock_movement sm
                                      where sm.material_issue_id = mi2.id and sm.type = 'RETURN'), 0)) as put,
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
     /* 기록서에 «-»(사용 안 함)로 적은 자재는 적지 않은 것이 아니다 (0155) */
     and pr.no_material_reason not like '사용 안 함 · %'
     /* 로트 없이 쓰는 소모품만 걸린 공정은 적을 자재가 없다 (0129) */
     and exists (select 1 from dmr_bom b join item bi on bi.id = b.component_item_id
                  where b.operation_id = pr.operation_id and bi.lot_tracked)

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
