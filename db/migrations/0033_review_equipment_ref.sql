-- =============================================================================
-- 0033_review_equipment_ref.sql  ·  검토 지원을 나누고, 설비 판정을 참조로
-- 근거: 0032 (equipment_ref), CLAUDE.md §8.5
-- =============================================================================
--
-- 두 가지를 함께 고친다.
--
-- 1) 설비 밸리데이션 판정이 코드 문자열 대조였다. 참조가 생겼으니 그걸 쓴다.
--    참조가 없는 지난 기록은 v_process_equipment 가 코드로 떨어뜨려 준다.
--
-- 2) 가지를 하나 더할 때마다 함수 전체를 다시 쓰고 있었다 (0023 -> 0027).
--    여덟 가지를 손으로 복사하다 보면 언젠가 한 줄이 어긋난다. 자료에서
--    나오는 가지들을 review_flags_base 에 두고, review_flags 는 거기에
--    설비 가지를 얹는다. 다음에 가지가 늘어도 base 는 건드리지 않는다.

create or replace function review_flags_base(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable as $$


  select distinct '시각 모순'::text,
         format('%s %s일차 %s: 시작 %s, 종료 %s - 시각이 역전되어 있음',
                o.code, pr.day_no, u.full_name,
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
         format('%s%s 종료 %s 보다 %s 시작 %s 가 빠름',
                coalesce(pl.lot_no || ' ', ''),
                a.code, to_char(timezone('Asia/Seoul', pa.ended_at),  'MM-DD HH24:MI'),
                b.code, to_char(timezone('Asia/Seoul', pb.started_at),'MM-DD HH24:MI')),
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
         format('%s %s: 장입 %s장 기준 %s %s 인데 %s %s 기입',
                o.code, i.name, wo.sheet_count,
                trim(to_char(x.need, 'FM999999990.###')), i.usage_uom,
                trim(to_char(x.put,  'FM999999990.###')), i.usage_uom),
         pr.day_no, o.code
    from (
      select pr2.id as pr_id, ml2.item_id, sum(mi2.qty) as put,
             required_qty(pr2.operation_id, ml2.item_id, wo2.sheet_count, 0) as need
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
     and x.put <> x.need

  union all

  select '기입 누락'::text,
         format('%s %s일차: 자재를 기록하지 않고 마감함 - 사유 "%s"',
                o.code, pr.day_no, pr.no_material_reason),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
   where pr.work_order_id = p_wo
     and pr.no_material_reason is not null
     and exists (select 1 from dmr_bom b where b.operation_id = pr.operation_id)

  union all

  select '기입 누락'::text,
         format('%s %s일차 %s: 종료 시각이 빈 채로 기록서가 발행됨',
                o.code, pr.day_no, u.full_name),
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
         format('지정 원재료는 %s 인데 %s 가 투입됨 (%s)',
                spec.lot_no, ml.lot_no, o.code),
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

  select '수량 불일치'::text,
         format('%s: 예정 %s개, 재단 %s개',
                i.code, p.planned_qty, coalesce(x.made, 0)),
         null::int, i.code
    from work_order_plan p
    join item i on i.id = p.item_id
    left join (
      select pl.item_id, sum(pl.qty_produced)::int as made
        from product_lot pl where pl.work_order_id = p_wo group by pl.item_id
    ) x on x.item_id = p.item_id
   where p.work_order_id = p_wo
     and p.planned_qty is not null
     and exists (select 1 from product_lot pl where pl.work_order_id = p_wo)
     and coalesce(x.made, 0) <> p.planned_qty
$$;

grant execute on function review_flags_base(uuid) to app_role;

/* ---------------------------------------------------------------------------
   검토 지원 = 자료에서 나오는 가지 + 설비 밸리데이션
--------------------------------------------------------------------------- */
create or replace function review_flags(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable as $$
  select r.kind, r.detail, r.day_no, r.ref
    from review_flags_base(p_wo) r

  union all

  select '기한 경과'::text,
         format('%s %s일차 설비 %s: 사용일 %s 에 유효한 밸리데이션 없음%s',
                o.code, pr.day_no, coalesce(e.code, pr.equipment_id),
                to_char(pr.work_date, 'YYYY-MM-DD'),
                coalesce(' (최근 만료 ' || to_char(
                  (select max(valid_until) from equipment_validation ev
                    where ev.equipment_id = e.id), 'YYYY-MM-DD') || ')', '')),
         pr.day_no, coalesce(e.code, pr.equipment_id)
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join v_process_equipment ve on ve.process_record_id = pr.id
    left join equipment e on e.id = ve.equipment_id
   where pr.work_order_id = p_wo
     and ve.equipment_id is not null
     and not exists (
       select 1 from equipment_validation ev
        where ev.equipment_id = ve.equipment_id
          and ev.performed_on <= pr.work_date
          and ev.valid_until  >= pr.work_date)

  order by 3 nulls last, 1, 2
$$;

grant execute on function review_flags(uuid) to app_role;
