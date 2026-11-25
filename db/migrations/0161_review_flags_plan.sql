/* ===========================================================================
   0161 · 확인해 볼 항목(review_flags)의 실행 계획을 다시 쓴다 (최적화 2026-11-25)

   돌려주는 것은 한 글자도 바뀌지 않는다. 질의 본문은 0135 그대로이고 겉만 바꾼다.

   ── 왜 ────────────────────────────────────────────────────────────────────
   운영에서 가장 무거운 화면 질의였다 (pg_stat_statements 평균 117 ms · 최대 1.7 초).
   재 보니 실제 조회는 5 ms 남짓이고 나머지는 **부를 때마다 실행 계획을 새로 짜는
   비용**이었다 - security definer 인 SQL 함수는 바깥 질의에 펼쳐지지 않고, PG 17 은
   SQL 함수의 계획을 호출 사이에 남기지 않는다. 갈래가 열 개라 계획만 17 ms 안팎,
   연결의 첫 호출은 카탈로그까지 읽어 45~285 ms 였다.

   ── 어떻게 ────────────────────────────────────────────────────────────────
   plpgsql 의 return query 로 감싼다. plpgsql 은 문장의 계획을 연결에 남겨 다음
   호출이 그대로 쓴다. plan_cache_mode = force_generic_plan 으로 처음부터 그 남긴
   계획을 쓰게 한다 - 표가 작고 조건이 배치 하나(p_wo)뿐이라 값마다 다시 짤 까닭이
   없다. 운영 B261104-01 에서 이어진 호출 약 21 → 4 ms, 첫 호출 약 275 → 31 ms
   (이 PC 의 풀러 왕복 약 10 ms 를 뺀 값).

   #variable_conflict use_column - 결과 열 이름(kind · detail · day_no · ref)이 본문
   표의 열 이름과 같다. SQL 함수에서는 결과 열이 변수로 보이지 않았으므로, 열을
   먼저 보게 해야 같은 뜻이 된다.

   review_flags_base (0156) 는 그대로 둔다 - security definer 가 아닌 SQL 함수라
   이 문장 안에 펼쳐진다. 편철 표지의 자료 식별자에 이 결과가 들어가므로 (cover
   payload flags) 본문 · 정렬을 손대지 않았다.
=========================================================================== */

create or replace function review_flags(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language plpgsql stable
security definer
set search_path = pg_catalog, public, pg_temp
set plan_cache_mode = force_generic_plan as $$
#variable_conflict use_column
begin
  return query
  select r.kind, r.detail, r.day_no, r.ref
    from review_flags_base(p_wo) r

  union all

  /* 설비: 사용일에 유효한 밸리데이션 · 교정이 있었는가 (0107) */
  select '기한 경과'::text,
         format('%s %s일차 설비 %s: 사용일 %s - 유효한 %s 없음%s',
                o.code, pr.day_no, coalesce(e.code, pr.equipment_id),
                to_char(pr.work_date, 'YYYY-MM-DD'),
                case k.kind when 'VALIDATION' then '밸리데이션' else '교정' end,
                coalesce(' (최근 만료 ' || to_char(
                  (select max(ev.valid_until) from equipment_validation ev
                    where ev.equipment_id = e.id and ev.kind = k.kind),
                  'YYYY-MM-DD') || ')', '')),
         pr.day_no, coalesce(e.code, pr.equipment_id)
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join v_process_equipment ve on ve.process_record_id = pr.id
    left join equipment e on e.id = ve.equipment_id
    join lateral (
      select distinct ev.kind
        from equipment_validation ev
       where ev.equipment_id = ve.equipment_id
    ) k on true
   where pr.work_order_id = p_wo
     and ve.equipment_id is not null
     and not exists (
       select 1 from equipment_validation ev
        where ev.equipment_id = ve.equipment_id
          and ev.kind = k.kind
          and ev.performed_on <= pr.work_date
          and ev.valid_until  >= pr.work_date)

  union all

  /* 사람: 작업일에 그 공정 자격이 있었는가 (0108) */
  select '자격 없음'::text,
         format('%s %s일차 %s: 작업일 %s - 이 공정의 유효한 자격 없음',
                o.code, pr.day_no, u.full_name,
                to_char(pr.work_date, 'YYYY-MM-DD')),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join app_user u on u.id = pr.worker_id
   where pr.work_order_id = p_wo
     /* 이 공정에 자격 줄이 하나라도 있을 때만 묻는다 */
     and exists (select 1 from worker_qualification q
                  where q.operation_code = o.code)
     and not worker_qualified(pr.worker_id, o.code, pr.work_date)


  union all

  /* 유효기한이 지난 자재가 들어갔는가 (§8.5 "기입 누락" 이 아니라 사실 대조) */
  select distinct '기한 경과'::text,
         format('%s %s일차: %s %s - 유효기한 %s, 투입일 %s',
                o.code, pr.day_no, i.name, ml.lot_no,
                to_char(ml.expiry_date, 'YYYY-MM-DD'),
                to_char(pr.work_date,  'YYYY-MM-DD')),
         pr.day_no, ml.lot_no
    from material_issue mi
    join process_record pr on pr.id = mi.process_record_id
    join dmr_operation o on o.id = pr.operation_id
    join material_lot ml on ml.id = mi.material_lot_id
    join item i on i.id = ml.item_id
   where pr.work_order_id = p_wo
     and ml.expiry_date is not null
     and ml.expiry_date < pr.work_date

  union all

  /*
   * 공급자.
   *
   * 승인기한은 날짜라 그 날 유효했는지 물을 수 있다. 상태는 이력이 없어서
   * 그 날 무엇이었는지 모른다 - 그래서 "지금" 이라고 밝혀 적는다.
   */
  select distinct '미승인 공급자'::text,
         format('%s %s일차: %s %s - 공급자 %s %s',
                o.code, pr.day_no, i.name, ml.lot_no, s.name,
                case when s.approved_until is not null and s.approved_until < pr.work_date
                     then '승인기한이 ' || to_char(s.approved_until, 'YYYY-MM-DD')
                          || ' 로 투입일 ' || to_char(pr.work_date, 'YYYY-MM-DD') || ' 이전'
                     else '상태가 지금 ' || s.status end),
         pr.day_no, ml.lot_no
    from material_issue mi
    join process_record pr on pr.id = mi.process_record_id
    join dmr_operation o on o.id = pr.operation_id
    join material_lot ml on ml.id = mi.material_lot_id
    join item i on i.id = ml.item_id
    join supplier s on s.id = ml.supplier_id
   where pr.work_order_id = p_wo
     and (s.status <> 'APPROVED'
          or (s.approved_until is not null and s.approved_until < pr.work_date))

  union all

  /*
   * 제품 개수 기준 자재 (§8.5 "수량 불일치").
   *
   * 장입 구간 기준은 0023 부터 보고 있었는데 제품 개수 기준은 아무도 안 봤다.
   * 포장재 · 라벨이 여기 해당한다. 다시 포장한 것이 있으면 그만큼 더 드므로
   * 기록에 적힌 재포장 수량을 더해 견준다.
   */
  select '수량 불일치'::text,
         format('%s %s일차 %s: %s - 제품 %s개%s 기준 %s %s 인데 %s %s 기입',
                o.code, pr.day_no, pl.lot_no, i.name, pl.qty_produced,
                case when coalesce(pr.rework_qty, 0) > 0
                     then ' + 재포장 ' || pr.rework_qty || '개' else '' end,
                trim(to_char(x.need, 'FM999999990.###')), i.usage_uom,
                trim(to_char(x.put,  'FM999999990.###')), i.usage_uom),
         pr.day_no, o.code
    from (
      select pr2.id as pr_id, ml2.item_id, sum(mi2.qty) as put,
             required_qty(pr2.operation_id, ml2.item_id, wo2.sheet_count,
                          pl2.qty_produced + coalesce(pr2.rework_qty, 0)) as need
        from material_issue mi2
        join process_record pr2 on pr2.id = mi2.process_record_id
        join work_order wo2 on wo2.id = pr2.work_order_id
        join product_lot pl2 on pl2.id = pr2.product_lot_id
        join material_lot ml2 on ml2.id = mi2.material_lot_id
       where pr2.work_order_id = p_wo
       group by pr2.id, ml2.item_id, pr2.operation_id, wo2.sheet_count,
                pl2.qty_produced, pr2.rework_qty
    ) x
    join process_record pr on pr.id = x.pr_id
    join product_lot pl on pl.id = pr.product_lot_id
    join dmr_operation o on o.id = pr.operation_id
    join item i on i.id = x.item_id
    join dmr_bom b on b.operation_id = pr.operation_id
                  and b.component_item_id = x.item_id
   where b.basis = 'PER_UNIT'
     and x.need is not null
     and x.put <> x.need

  union all

  /*
   * 표준서 밖 (0135 · 기록서 중심 화면 2026-11-11).
   * «전체 설비 보기» · «전체 자재 로트 보기» 로 고른 것은 기록되고 제품표준서에는
   * 더하지 않는다 (사용자 결정 «권고대로»). 그 사실을 검토가 짚는다 - 판정하지 않고
   * 무엇이 표준서에 없었는지만 적는다.
   */
  select '표준서 밖'::text,
         format('%s %s일차 설비 %s: 제품표준서에서 이 공정에 걸리지 않은 설비 (%s)',
                o.code, pr.day_no, coalesce(e.code, ve.code_snapshot), o.name),
         pr.day_no, coalesce(e.code, ve.code_snapshot)
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join v_process_equipment ve on ve.process_record_id = pr.id
    left join equipment e on e.id = ve.equipment_id
   where pr.work_order_id = p_wo
     and not exists (select 1 from operation_equipment oe
                      where oe.operation_id = pr.operation_id
                        and oe.equipment_id = ve.equipment_id)

  union all

  select '표준서 밖'::text,
         format('%s %s일차 자재 %s %s (로트 %s): 자재 구성표에 없는 자재 (%s)',
                o.code, pr.day_no, i.code, i.name, ml.lot_no, o.name),
         pr.day_no, ml.lot_no
    from material_issue mi
    join process_record pr on pr.id = mi.process_record_id
    join dmr_operation o on o.id = pr.operation_id
    join material_lot ml on ml.id = mi.material_lot_id
    join item i on i.id = ml.item_id
   where pr.work_order_id = p_wo
     and i.type <> 'RAW'
     and not exists (select 1 from dmr_bom b
                      where b.operation_id = pr.operation_id
                        and b.component_item_id = i.id)

  order by 3 nulls last, 1, 2;
end
$$;

grant execute on function review_flags(uuid) to app_role;
