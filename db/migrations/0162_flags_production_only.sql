/* ===========================================================================
   0162 · 확인해 볼 항목에서 품질 판정 갈래를 뺀다 - 생산팀 전용 (사용자 2026-11-25)

   "품질이 하는 업무는 전부 배제하고, 생산의 관점에서 생산에 적극적인 서포트를 할 수 있는 시스템으로"
   → 제안 1단계 «걷기부터 시작». 0160 (출하 승인 걷음) 과 같은 결정의 줄기다.

   ── 뺀다 (판정 · 자격 · 승인은 품질 몫이고, 품질은 이 시스템을 쓰지 않는다) ──
     기한 경과    설비를 쓴 날 유효한 밸리데이션 · 교정이 없었다 (0107)
     자격 없음    작업일에 그 공정 자격이 없었다 (0108)
     미승인 공급자 공급자 상태 · 승인기한 (0113)
     표준서 밖    제품표준서에 걸리지 않은 설비 · 자재 구성표에 없는 자재 (0135)
   설비 밸리데이션 · 교정 기록과 현장 고르기 타일의 «기한 경과 · 표준서 밖» 표시는 그대로다 -
   쓰기 전에 보는 생산의 정보이고, 막지도 않는다. 이 목록(검토)에서만 뺀다.

   ── 남긴다 (생산이 제 기록을 고칠 수 있는 것) ──────────────────────────────
     review_flags_base (0156) 수량 불일치 · 구간 이탈 · 기입 누락 · 참조 불일치 · 예정 대비 재단
     기한 경과    유효기한이 지난 자재를 넣었다
     수량 불일치  제품 개수 기준 자재 (포장재 · 라벨)
   본문 · 정렬은 0161 그대로이고 갈래만 고른다. 편철 표지의 자료 식별자에 이 결과가 들어가지만
   운영에 발행된 표지는 아직 없다 (2026-11-25 기준 record_print 4줄 모두 제조기록서).
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

  order by 3 nulls last, 1, 2;
end
$$;

grant execute on function review_flags(uuid) to app_role;
