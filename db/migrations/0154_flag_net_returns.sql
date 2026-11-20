/* ===========================================================================
   0154 · 구간 이탈은 반납을 뺀 양으로 본다 (사용자 2026-11-20)

   B261104-01 WS-01 염화나트륨: 292.2 g · 293 g 두 줄을 넣고 292.2 g 줄을 전량 반납했다. 기록서
   결과 칸은 반납을 빼 293 g (1bfcae8 netIssues)인데, 확인해 볼 항목은 «585 g 기입» 으로 구간 이탈을
   짚었다 - 투입 줄을 더하면서 반납(stock_movement RETURN)을 빼지 않았다.

   review_flags_base 의 구간 이탈 셈만 «투입 - 반납» 으로 바꾼다. 나머지는 0129 그대로다.
=========================================================================== */

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
