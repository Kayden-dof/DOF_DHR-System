-- =============================================================================
-- 0023_review.sql · 검토 지원 (§8.5)
--
-- 검토자가 서류를 눈으로 대조하던 부담을 덜기 위해, 명백히 어긋나거나 빠진
-- 항목을 눈에 띄게 표시한다.
--
-- 표시 대상은 산술로 판정되는 것만이다. 결론이 하나로 정해지고 해석의 여지가
-- 없는 항목이다. 사실만 적는다.
--
--   "시작 09:20, 종료 08:50 - 시각이 역전되어 있음"
--
-- 판정 문구를 쓰지 않는다. 적합 · 부적합 · 합격 · 이상 없음 · 검토 완료 전부
-- 금지다. 이상이 없으면 아무것도 돌려주지 않는다. 빈 결과가 정상이다.
--
-- 표시 항목이 있어도 인쇄와 진행을 막지 않는다. 차단은 S01~S05 뿐이다.
--
-- 왜 "이상 없음"을 절대 내보내지 않는가: 그 문구가 뜨는 순간 검토자가 그것을
-- 믿고 넘어간다. 시스템이 잡을 수 있는 항목보다 잡을 수 없는 항목이 훨씬
-- 많으므로, 잘못된 안심을 만드는 것이 검토를 돕지 않는 것보다 위험하다.
--
-- 적합 여부 판정은 전체를 보는 검토자가 한다. 시스템은 어긋난 부분을 객관적으로
-- 짚어 눈에 띄게 만드는 데서 멈춘다.
-- =============================================================================

create or replace function review_flags(p_wo uuid)
returns table (
  kind    text,   -- 시각 모순 · 수량 불일치 · 구간 이탈 · 기입 누락 · 참조 불일치
  detail  text,   -- 사실만. 판정 문구를 쓰지 않는다
  day_no  int,
  ref     text    -- 어디를 봐야 하는지
)
language sql stable as $$

  /* --- 1. 시각 역전 · 한 기록 안에서 -------------------------------------- */
  select distinct '시각 모순'::text,
         format('%s %s일차 %s: 시작 %s, 종료 %s - 시각이 역전되어 있음',
                o.code, pr.day_no, u.full_name,
                to_char(timezone('Asia/Seoul', pr.started_at), 'HH24:MI'),
                to_char(timezone('Asia/Seoul', pr.ended_at),   'HH24:MI')),
         pr.day_no,
         o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join app_user u on u.id = pr.worker_id
   where pr.work_order_id = p_wo
     and pr.started_at is not null and pr.ended_at is not null
     and pr.ended_at < pr.started_at

  union all

  /* --- 2. 공정 순서 역전 · 앞 공정 종료보다 뒤 공정 시작이 빠름 ----------- */
  select distinct '시각 모순'::text,
         format('%s%s 종료 %s 보다 %s 시작 %s 가 빠름',
                coalesce(pl.lot_no || ' ', ''),
                a.code, to_char(timezone('Asia/Seoul', pa.ended_at),  'MM-DD HH24:MI'),
                b.code, to_char(timezone('Asia/Seoul', pb.started_at),'MM-DD HH24:MI')),
         pb.day_no,
         b.code
    from process_record pa
    join dmr_operation a on a.id = pa.operation_id
    join process_record pb on pb.work_order_id = pa.work_order_id
    join dmr_operation b on b.id = pb.operation_id
    left join product_lot pl on pl.id = pb.product_lot_id
   where pa.work_order_id = p_wo
     and b.seq = a.seq + 1
     and pa.ended_at is not null and pb.started_at is not null
     and pb.started_at < pa.ended_at
     -- 재단 이후 공정은 제품 로트마다 갈리므로 같은 로트끼리만 견준다
     and pa.product_lot_id is not distinct from pb.product_lot_id

  union all

  /* --- 3. 반납이 불출보다 큼 ---------------------------------------------- */
  select '수량 불일치'::text,
         format('%s %s: 불출 %s, 반납 %s - 반납이 더 큼',
                i.name, ml.lot_no,
                trim(to_char(x.issued, 'FM999999990.###')),
                trim(to_char(x.returned, 'FM999999990.###'))),
         null::int,
         ml.lot_no
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

  /* --- 4. 장입 구간 이탈 · 시약 기입량이 정의된 구간과 다름 --------------- */
  select '구간 이탈'::text,
         format('%s %s: 장입 %s장 기준 %s %s 인데 %s %s 기입',
                o.code, i.name, wo.sheet_count,
                trim(to_char(x.need, 'FM999999990.###')), i.usage_uom,
                trim(to_char(x.put,  'FM999999990.###')), i.usage_uom),
         pr.day_no,
         o.code
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

  /* --- 5. 사유로 넘어간 자재 · S05 예외 ----------------------------------- */
  select '기입 누락'::text,
         format('%s %s일차: 자재를 기록하지 않고 마감함 - 사유 "%s"',
                o.code, pr.day_no, pr.no_material_reason),
         pr.day_no,
         o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
   where pr.work_order_id = p_wo
     and pr.no_material_reason is not null
     and exists (select 1 from dmr_bom b where b.operation_id = pr.operation_id)

  union all

  /* --- 6. 마감하지 않은 채 인쇄된 기록 ------------------------------------ */
  select '기입 누락'::text,
         format('%s %s일차 %s: 종료 시각이 빈 채로 기록서가 발행됨',
                o.code, pr.day_no, u.full_name),
         pr.day_no,
         o.code
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

  /* --- 7. 지정 원재료와 실제 투입 원재료가 다름 --------------------------- */
  select '참조 불일치'::text,
         format('지정 원재료는 %s 인데 %s 가 투입됨 (%s)',
                spec.lot_no, ml.lot_no, o.code),
         pr.day_no,
         ml.lot_no
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

  /* --- 8. 재단 수량이 예정과 다름 ----------------------------------------- */
  select '수량 불일치'::text,
         format('%s: 예정 %s개, 재단 %s개',
                i.code, p.planned_qty, coalesce(x.made, 0)),
         null::int,
         i.code
    from work_order_plan p
    join item i on i.id = p.item_id
    left join (
      select pl.item_id, sum(pl.qty_produced)::int as made
        from product_lot pl where pl.work_order_id = p_wo group by pl.item_id
    ) x on x.item_id = p.item_id
   where p.work_order_id = p_wo
     and p.planned_qty is not null
     -- 재단 전에는 견주지 않는다. 아직 안 한 것은 어긋난 것이 아니다.
     and exists (select 1 from product_lot pl where pl.work_order_id = p_wo)
     and coalesce(x.made, 0) <> p.planned_qty

  order by 3 nulls last, 1, 2
$$;

grant execute on function review_flags(uuid) to app_role;
