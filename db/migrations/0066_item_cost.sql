/* ---------------------------------------------------------------------------
   제품코드별 자재 원가 (사용자 요청 2026-09-01)

   경영 화면에서 "어느 형명이 얼마나 드는가" 를 보려는 것이다.

   ── 왜 새 뷰가 필요한가 ───────────────────────────────────────────────────
   v_product_lot_cost 가 이미 로트별 원가를 낸다. 그런데 배치 공통분(원재료 +
   재단 전 공정)을 **생산 수량 비율**로 배분한다. 그러면 5x5cm 한 장과
   10x10cm 한 장이 같은 값을 진다.

   실제 자료로 돌려 보면 형명이 셋인데 단가가 전부 4,515원으로 같았다. 제품
   코드별로 보려는 목적이 "어느 형명이 남고 어느 형명이 밑지는가" 라면, 그
   기준으로는 그 질문에 답이 나오지 않는다.

   원재료는 **면적이 정해진 가죽 한 장**이다. 조각이 그 면적을 쓰는 만큼
   가져가는 것이 맞다. 그래서 배치 공통분은 면적으로 배분한다.

   ── 합치지 않는다 (사용자 결정) ───────────────────────────────────────────
   배치 공통분과 이 형명에만 들어간 포장재를 한 줄로 더하지 않는다. 두 열로
   나란히 두면 어디서 온 값인지가 화면에 남는다. 합계도 함께 내지만 그것은
   두 열의 합일 뿐이고, 화면이 따로 더하지 않는다 (§10 - 화면이 각자 나누면
   갈라진다).

   ── 이것은 제조원가가 아니다 ──────────────────────────────────────────────
   인건비·전기·멸균 위탁비가 들어 있지 않다. 위탁비는 지금 어디에도 기록되지
   않는다. 화면에 "자재 원가" 라고 못 박아야 한다 - 그러지 않으면 이 숫자가
   "한 장 만드는 데 드는 돈" 으로 읽힌다.

   ── 재단 손실은 제품이 나눠 진다 ──────────────────────────────────────────
   가죽 한 장에서 조각을 떼고 남는 자투리의 면적은 기록되지 않는다. 그래서
   배분은 **실제로 나온 조각들의 면적 합**을 분모로 삼는다. 자투리 몫이 제품에
   비례해 얹힌다. §10 이 금지한 "제품 원가에 폐기분 포함" 은 폐기 처리한 자재를
   말하고, 재단 수율 손실은 그것과 다르다.
--------------------------------------------------------------------------- */

/* === 1. 형명에서 면적을 뽑는다 ============================================ */
/*
 * 형명 파싱을 화면이나 조회가 각자 하지 않는다. 규격 표기가 한때 두 곳에서
 * 갈려 10배 틀린 치수가 종이에 나간 적이 있다 (0057). 같은 실수를 되풀이하지
 * 않는다.
 */
create or replace function item_area_cm2(p_code text) returns numeric
language sql immutable as $fn$
  select case
    when p_code ~ '^PD[0-9]{8}$'
      then (cm_label(substr(p_code, 3, 2)))::numeric
         * (cm_label(substr(p_code, 5, 2)))::numeric
    else null
  end
$fn$;

comment on function item_area_cm2(text) is
  '형명의 한 장 면적(cm²). 크기 두 자리는 숫자가 곧 cm 다 (0057). 형명 규칙에 안 맞으면 null';


/* === 2. 제품코드별 자재 원가 ============================================== */
create or replace view v_item_cost as
with lot as (
  select lc.work_order_id, lc.item_id, lc.qty_produced,
         lc.own_cost::numeric as own_cost,
         lc.qty_produced * item_area_cm2(i.code) as area,
         pl.manufactured_on
    from v_product_lot_cost lc
    join item i on i.id = lc.item_id
    join product_lot pl on pl.id = lc.product_lot_id
),
/* 배치 안에서 나눈다. 배치를 넘어 섞으면 다른 가죽의 값이 옮겨 붙는다 */
batch as (
  select work_order_id, sum(area) as batch_area from lot group by 1
)
select l.item_id, i.code as item_code, i.name as item_name,
       item_area_cm2(i.code)                                   as area_cm2,
       date_trunc('month', l.manufactured_on)::date            as month,
       sum(l.qty_produced)::int                                as qty,
       /* 배치 공통분(원재료 + 재단 전 공정)을 면적 몫으로 */
       round(sum((bc.raw_cost + bc.pre_cut_cost)
                 * (l.area / nullif(b.batch_area, 0))), 2)     as shared_cost,
       /* 이 형명에만 들어간 재단 후 자재 */
       round(sum(l.own_cost), 2)                               as own_cost
  from lot l
  join item i on i.id = l.item_id
  join batch b on b.work_order_id = l.work_order_id
  join v_batch_cost bc on bc.work_order_id = l.work_order_id
 group by l.item_id, i.code, i.name, 4, 5;

comment on view v_item_cost is
  '제품코드별 자재 원가. 배치 공통분은 면적으로 배분하고 형명 자체 자재와 합치지 않는다. 인건비·전기·멸균 위탁비는 들어 있지 않다';

grant select on v_item_cost to app_role, app_readonly;
