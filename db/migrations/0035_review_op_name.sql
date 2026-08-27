/* ---------------------------------------------------------------------------
   검토 지원 · 공정을 코드가 아니라 이름으로 부른다

   지금까지 표시 문구가 공정을 코드로만 불렀다.

     WS-DX2401-02 종료 08-27 23:10 보다 WS-DX2401-03 시작 08-27 13:20 가 빠름

   검토자가 이 줄을 보고 무엇이 어긋났는지 알려면 코드표를 따로 펴서 02 와 03
   이 무슨 공정인지 맞춰 봐야 한다 (사용자 지적). 짚어 주는 자리에서 다시 찾게
   만들면 짚어 준 것이 아니다.

     초임계 가공(WS-DX2401-02) 종료 08-27 23:10 보다
     알칼리 처리(WS-DX2401-03) 시작 08-27 13:20 이 빠름

   이름을 앞에 두고 코드를 괄호에 넣는다. 사람은 이름으로 읽고, 코드는 기록서와
   맞춰 볼 때 쓴다. 둘 다 필요하므로 하나를 버리지 않는다.

   `ref` 열은 코드 그대로 둔다. 화면에서 묶고 거르는 열쇠이지 읽는 문장이 아니다.

   내용 자체는 0033 과 같다. 짚는 항목도, 판정하지 않는다는 원칙도 그대로다
   (§8.5). 문구만 고친다.
--------------------------------------------------------------------------- */

create or replace function review_flags_base(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable as $$

  /* --- 1. 한 기록 안에서 시작이 종료보다 늦음 ----------------------------- */
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

  /* --- 2. 앞 공정 종료보다 뒤 공정 시작이 빠름 ---------------------------- */
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

  /* --- 3. 반납이 불출보다 큼 ---------------------------------------------- */
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

  /* --- 4. 장입 구간이 정하는 양과 기입량이 다름 --------------------------- */
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

  /* --- 5. 자재를 기록하지 않고 사유만 남기고 마감 ------------------------- */
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

  /* --- 6. 종료 시각이 빈 채로 기록서가 발행됨 ----------------------------- */
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

  /* --- 7. 지시된 원재료 로트와 실제 투입 로트가 다름 ---------------------- */
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

  /* --- 8. 재단 예정 수량과 실제 수량이 다름 ------------------------------- */
  select '수량 불일치'::text,
         format('%s %s: 예정 %s개, 재단 %s개',
                i.code, i.name, p.planned_qty, coalesce(x.made, 0)),
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
   9번 가지 (설비) 도 같은 이유로 이름을 붙인다.

   설비도 마찬가지다. 관리번호만 적으면 어느 기계인지 알려면 설비 목록을 열어야
   한다. 참조가 있으면 지금 이름을, 없으면 그때 찍힌 코드만 적는다.
--------------------------------------------------------------------------- */
create or replace function review_flags(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable as $$

  select * from review_flags_base(p_wo)

  union all

  select '기한 경과'::text,
         format('%s(%s) %s일차 설비 %s%s: 사용일 %s 에 유효한 밸리데이션 없음%s',
                o.name, o.code, pr.day_no,
                ve.code_snapshot,
                coalesce(' ' || e.name, ''),
                to_char(pr.work_date, 'YYYY-MM-DD'),
                coalesce(' (최근 만료 ' || to_char(v.last_until, 'YYYY-MM-DD') || ')', '')),
         pr.day_no, ve.code_snapshot
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join v_process_equipment ve on ve.process_record_id = pr.id
    left join equipment e on e.id = ve.equipment_id
    left join lateral (
      select max(ev.valid_until) as last_until
        from equipment_validation ev
       where ev.equipment_id = ve.equipment_id
    ) v on true
   where pr.work_order_id = p_wo
     and not exists (
       select 1 from equipment_validation ev
        where ev.equipment_id = ve.equipment_id
          and ev.performed_on <= pr.work_date
          and ev.valid_until  >= pr.work_date)
$$;

grant execute on function review_flags(uuid) to app_role;
