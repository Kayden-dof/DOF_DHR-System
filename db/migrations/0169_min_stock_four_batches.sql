/* ===========================================================================
   0169 · 최소 재고선 = 한 배치 소요량 x 4 (사용자 2026-11-26)

   «최소 재고선은 4배치 생산을 기준으로 잡아주면 될 거 같다. 항상 최소 재고선은 생산에
   들어가는 수량에서 4배치 생산량 기준으로 잡아줘.»

   ── 전에는 ─────────────────────────────────────────────────────────────────
   suggest_min_stock(0015) 은 최근 90일 사용량 ÷ 90 x 리드타임 x 1.5 를 제안값(min_stock_auto)
   에만 넣고 최소 재고선(min_stock)은 덮어쓰지 않았다. 쓴 기록이 적은 품목은 제안이 비었다.

   ── 이제 ───────────────────────────────────────────────────────────────────
   시행 중(ACTIVE)인 제품표준서의 자재 구성표에 든 품목은 «한 배치에 들어가는 양 x 4» 를
   최소 재고선으로 «잡는다» (제안이 아니라 min_stock 자체 · 사용자 «항상»).
     · 한 배치 = 장입 상한(sheet_max)장을 넣은 배치
         장입 구간 기준(SHEET_TIER) - 장입 상한이 드는 구간의 지시 수량(qty · 지시서에 찍히는 값)
         제품 개수 기준(PER_UNIT)   - 개당 소요량 x 배치당 예상 수량(expected_units)
     · 한 제품표준서 안에서 여러 공정에 들면 더한다. 시행 중인 판이 여럿이면 큰 쪽.
     · 근거 문장을 min_stock_basis 에 남긴다. 근거 없는 숫자는 아무도 믿지 않는다 (§6).
   구성표 밖 품목(완제품 · 구성표에 없는 소모품)은 예전 셈을 제안값으로만 둔다 - 생산에
   들어가는 양이 정해져 있지 않으니 지어내지 않는다.

   ── 다시 돌아도 같다 ───────────────────────────────────────────────────────
   운영 이관은 처음부터 다시 돈다. 값이 달라질 때만 고치므로 감사추적에 같은 줄이 쌓이지 않는다.
   제품표준서 · 구성표를 바꾼 뒤에는 재고 화면의 «최소 재고선 다시 셈» 이 같은 셈을 돈다.
=========================================================================== */

create or replace function suggest_min_stock(p_days int default 90)
returns int language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare n int := 0; r record; v_min numeric; v_basis text;
begin
  /* 1. 구성표에 든 품목: 한 배치 소요량 x 4 를 최소 재고선으로 */
  for r in
    with line as (
      select dm.id as dm, dm.product_code, dm.revision, dm.sheet_max, dm.expected_units,
             b.component_item_id as item_id,
             case b.basis
               when 'SHEET_TIER' then (
                 select t.qty from dmr_bom_tier t
                  where t.dmr_bom_id = b.id
                    and dm.sheet_max >= t.min_sheets
                    and (t.max_sheets is null or dm.sheet_max <= t.max_sheets)
                  order by t.min_sheets desc limit 1)
               when 'PER_UNIT' then b.qty_per_unit * dm.expected_units
             end as qty
        from device_master dm
        join dmr_operation o on o.device_master_id = dm.id
        join dmr_bom b on b.operation_id = o.id
       where dm.status = 'ACTIVE' and dm.sheet_max is not null
    ),
    per_dm as (
      select item_id, dm, product_code, revision, sheet_max, sum(qty) as per_batch
        from line where qty is not null
       group by item_id, dm, product_code, revision, sheet_max
    ),
    pick as (
      select distinct on (item_id) item_id, product_code, revision, sheet_max, per_batch
        from per_dm where per_batch > 0
       order by item_id, per_batch desc
    )
    select i.id, i.usage_uom, p.product_code, p.revision, p.sheet_max, p.per_batch
      from pick p join item i on i.id = p.item_id
     where i.is_active
  loop
    /* 개수로 세는 단위는 올린다 - 멸균 박스 4.08 개 x 4 = 16.32 개는 17 개다 */
    v_min := case when r.usage_uom in ('EA', '개', '장', '매', '통', 'BOX', 'box', '박스', 'roll', 'ROLL', '롤')
                  then ceil(r.per_batch * 4) else round(r.per_batch * 4, 3) end;
    v_basis := format('한 배치 소요 %s %s (%s %s · 장입 %s장) x 4 배치',
                      trim(trailing '.' from trim(trailing '0' from round(r.per_batch, 3)::text)),
                      r.usage_uom, r.product_code, r.revision, r.sheet_max);
    update item
       set min_stock = v_min, min_stock_auto = v_min, min_stock_basis = v_basis
     where id = r.id
       and (min_stock is distinct from v_min or min_stock_auto is distinct from v_min
            or min_stock_basis is distinct from v_basis);
    n := n + 1;
  end loop;

  /* 2. 구성표 밖 품목: 예전 셈을 제안값으로만 (0015 그대로) */
  for r in
    select i.id, i.usage_uom, coalesce(i.lead_days, 14) as lead_days,
           coalesce(sum(mi.qty), 0) as used,
           count(distinct pr.work_order_id) as batches
      from item i
      left join material_lot ml on ml.item_id = i.id
      left join material_issue mi on mi.material_lot_id = ml.id
           and mi.issued_at >= now() - make_interval(days => p_days)
      left join process_record pr on pr.id = mi.process_record_id
     where i.is_active and i.type <> 'FIN'
       and not exists (
         select 1 from dmr_bom b
           join dmr_operation o on o.id = b.operation_id
           join device_master dm on dm.id = o.device_master_id
          where b.component_item_id = i.id and dm.status = 'ACTIVE')
     group by i.id
  loop
    if r.used > 0 then
      update item
         set min_stock_auto = ceil(r.used / p_days::numeric * r.lead_days * 1.5),
             min_stock_basis = format(
               '최근 %s일 사용량 %s %s (배치 %s건) 기준. 일평균 x 리드타임 %s일 x 1.5',
               p_days, round(r.used, 2), r.usage_uom, r.batches, r.lead_days)
       where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $fn$;

comment on function suggest_min_stock(int) is
  '최소 재고선: 시행 중 구성표 품목은 한 배치(장입 상한) 소요량 x 4 를 min_stock 으로, 그 밖은 사용량 셈을 제안값으로 (0169)';

/* 셈은 0171 이 다시 정의하고 돌린다 - 여기서도 돌리면 전체 이관 때마다 0169 값으로 썼다가 0171 값으로
   되돌려 감사추적에 같은 줄이 쌓인다 */
