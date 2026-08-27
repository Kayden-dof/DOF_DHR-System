/* ---------------------------------------------------------------------------
   작업지시서에서 예정 형명을 내리고 예정 수량만 남긴다

   형명은 재단에서 정해진다 (§3 ①). 두께는 원재료가 정하고 가로x세로는 잘라
   봐야 아는데, 착수 전에 발행하는 지시서에 형명을 적어 두면 작업자가 재료가
   허락하는 대로 자르는 대신 종이에 적힌 수에 맞추려 하게 된다 (사용자 지적).
   종이가 제품을 끌고 가는 방향이라 반대로 가야 한다.

   ── 형명별로 쪼갤 이유가 없었다 ───────────────────────────────────────────
   work_order_plan 의 형명별 내역이 실제로 쓰이던 곳은 지시서 인쇄와 재단 후
   대조뿐이었다. 셈에는 합계만 들어간다.

     내포장 파우치  제품 1개당 1
     제품 라벨      제품 1개당 2
     멸균 박스      제품 1개당 0.02

   전부 제품 개수에만 비례하고 형명과 무관하다. 그러니 예정 총 개수 하나면
   지시서가 할 일은 다 된다.

   ── 표는 지우지 않는다 ────────────────────────────────────────────────────
   work_order_plan 에 이미 들어간 행은 그때 무엇을 계획했는지에 대한 기록이다.
   지우지 않고 그대로 둔다 (§10). 대신 합계를 새 열로 옮기고, 다시 쓰이지
   않도록 쓰기 권한만 내린다. 응용에서 안 쓰기로 하는 것과 못 쓰게 하는 것은
   다르고, 여기서는 뒤엣것이 필요하다 - 두 곳에 같은 뜻의 자료가 살아 있으면
   반드시 어긋난다.
--------------------------------------------------------------------------- */

alter table work_order
  add column if not exists planned_units int check (planned_units > 0);

comment on column work_order.planned_units is
  '배치에서 나올 예정 제품 개수. 포장재 소요량의 셈에 쓴다. 형명은 재단에서 정해진다';

/* 이미 계획이 잡힌 지시서는 합계를 옮겨 온다. 숫자가 사라지지 않게 */
update work_order wo
   set planned_units = x.total
  from (
    select work_order_id, sum(planned_qty)::int as total
      from work_order_plan
     where planned_qty is not null
     group by work_order_id
  ) x
 where x.work_order_id = wo.id
   and wo.planned_units is null
   and x.total > 0;

/* 더는 쓰지 않는다. 읽기는 남겨 두어 지난 계획을 조회할 수 있게 한다 */
revoke insert, update on work_order_plan from app_role;

/* ---------------------------------------------------------------------------
   검토 지원 · 8번 가지를 총량 대조로 바꾼다

   형명별 예정이 없어졌으므로 형명별로 견줄 수 없다. 배치에서 나오기로 한
   개수와 실제로 재단한 개수를 견준다. 산술로 답이 하나로 정해지는 항목이라
   §8.5 안에 그대로 남는다.

   재단 전에는 짚지 않는다. 아직 안 한 일을 어긋났다고 적을 수 없다.
--------------------------------------------------------------------------- */
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
         format('%s(%s) %s일차: 자재를 기록하지 않고 마감함 - 사유 "%s"',
                o.name, o.code, pr.day_no, pr.no_material_reason),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
   where pr.work_order_id = p_wo
     and pr.no_material_reason is not null
     and exists (select 1 from dmr_bom b where b.operation_id = pr.operation_id)

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
