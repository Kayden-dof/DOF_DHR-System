-- ---------------------------------------------------------------------------
-- 검토 표시가 짚는 갈래를 넓힌다 (사용자 지시 2026-09-15)
-- 근거 CLAUDE.md §8.5 · GMP 부합 점검 §10-7
--
-- ── 무엇이 빠져 있었나 ──────────────────────────────────────────────────
-- 수량은 장입 구간(SHEET_TIER)만 보고 **제품 개수 기준(PER_UNIT)은 안 봤다** -
-- 포장재와 라벨이 거기 해당한다. §2 의 경고 목록에 있는 미승인 공급자 ·
-- 유효기한 지난 자재도 발행 화면에서만 경고였고 기록 검토에서는 아무도
-- 안 짚었다.
--
-- 처음에는 참조 불일치(지정 원재료와 다른 원재료)도 없는 줄 알고 가지를 하나
-- 더 달았다. **0023 부터 이미 있었다.** 같은 사실이 두 번 나오는 것을 시험이
-- 잡았다 - 없는 것을 새로 만들기 전에 있는 것을 먼저 세어 본다.
--
-- ── 판정하지 않는다 ────────────────────────────────────────────────────
-- 네 가지 모두 산술로 결론이 하나로 정해지는 것만 담는다 (§8.5). 적합인지
-- 부적합인지 말하지 않고, 어긋난 두 값을 나란히 적는다. 막지도 않는다 -
-- 차단은 S01~S05 뿐이다.
--
-- ── 늘 떠 있는 표시를 만들지 않는다 ────────────────────────────────────
-- 공급자는 **투입일에 승인기한이 지나 있었는가**를 먼저 묻는다. 지금 상태가
-- 승인이 아닌 경우는 그렇다고 적되 "지금" 이라고 밝힌다 - 상태에는 이력이
-- 없어서 그 날 무엇이었는지 시스템이 모른다. 모르는 것을 아는 척하지 않는다.
--
-- ── 재포장분을 빼지 않는다 ─────────────────────────────────────────────
-- 포장재는 제품 개수에 비례하는데, 다시 포장한 것이 있으면 그만큼 더 든다.
-- 기록에 적힌 재포장 수량을 더해 견준다 - 그 값도 자료이고, 빼고 보면 정상
-- 작업이 매번 표시로 뜬다.
--
-- ── 본문을 손으로 옮겨 적지 않았다 ─────────────────────────────────────
-- 0108 의 정의를 파일에서 그대로 읽어 가지만 얹었다. 0111 에서 함수를 다시
-- 쓰다 0056 의 회수 규칙을 지운 적이 있다 (시험이 잡았다).
-- ---------------------------------------------------------------------------

create or replace function review_flags(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp as $$
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

  order by 3 nulls last, 1, 2
$$;

grant execute on function review_flags(uuid) to app_role;
