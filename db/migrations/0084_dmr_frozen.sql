-- ---------------------------------------------------------------------------
-- 발행한 뒤에는 제품표준서를 고쳐 쓰지 않는다 (4차 감사 F3)
--
-- device_master 에 §2.1 성격의 트리거가 없었다. 0052 는 이 표를 다루지 않는다.
-- setProductCode 는 status 도 발행 이력도 보지 않았다.
--
-- 그래서 작업 지시를 발행한 뒤에 제품명이나 제품 코드를 바꿀 수 있었고,
-- 재인쇄하면 **개정번호는 Rev.02 그대로인데 제품명이 다른 종이**가 나왔다.
-- 종이가 정본인 시스템에서 그것은 같은 개정번호가 두 가지를 가리킨다는 뜻이다.
--
-- ── 무엇을 막고 무엇을 여는가 ──────────────────────────────────────────
-- 이 표는 판정하지 않는다 (§1). 묻는 것은 하나다 - **이미 종이에 나간 값을
-- 없던 일로 만들고 있는가.**
--
--   막는다   발행된 지시가 있는 개정본의 제품 코드 · 제품명 · 품목 · 개정번호
--   연다     발효일 · 상태 · 비고 · 대조 확인 (전부 진행이거나 사유가 남는다)
--
-- 발행 전에는 전부 열려 있다. 오기 정정이 정상 작업이다.
-- ---------------------------------------------------------------------------

create or replace function trg_dmr_frozen()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp as $$
declare n int;
begin
  select count(*) into n from work_order where device_master_id = new.id;
  if n = 0 then
    return new;                      -- 아직 아무 지시도 안 나갔다
  end if;

  if new.item_id is distinct from old.item_id then
    raise exception '작업 지시가 나간 제품표준서의 품목은 바꿀 수 없습니다 (지시 %건)', n;
  end if;
  if new.revision is distinct from old.revision then
    raise exception '작업 지시가 나간 제품표준서의 개정번호는 바꿀 수 없습니다 (지시 %건)', n;
  end if;
  if new.product_code is distinct from old.product_code then
    raise exception '작업 지시가 나간 제품표준서의 제품 코드는 바꿀 수 없습니다. '
      '같은 개정번호로 다른 종이가 나갑니다 (지시 %건)', n;
  end if;
  if new.product_name is distinct from old.product_name then
    raise exception '작업 지시가 나간 제품표준서의 제품명은 바꿀 수 없습니다. '
      '같은 개정번호로 다른 종이가 나갑니다 (지시 %건)', n;
  end if;
  return new;
end $$;

drop trigger if exists device_master_frozen on device_master;
create trigger device_master_frozen before update
  on device_master for each row execute function trg_dmr_frozen();
