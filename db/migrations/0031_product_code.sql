-- =============================================================================
-- 0031_product_code.sql  ·  제품표준서에 제품 코드 · 설비 코드 수정 통제
-- 근거: 사용자 지적 2026-08-27
-- =============================================================================
--
-- ── 1. 제품 코드 ───────────────────────────────────────────────────────────
-- 제품표준서가 완제품 형명(PD05050510) 하나를 가리키고 있어, 화면과 인쇄물의
-- "제품" 자리에 그 형명이 나왔다. 형명은 규격 코드다 (PD + 가로 + 세로 +
-- 두께하한 + 두께상한, 62종). 최상위 관리 코드는 DX2401 이고 그것이 제품이다.
--
-- device_master.item_id 는 그대로 둔다. 재단 전 배치가 어느 형명 계열인지와
-- 채번 · 소요량이 거기 매여 있다. 그 위에 제품 코드를 얹는다.
--
-- 값이 없으면 화면은 형명으로 떨어진다. 소급해서 채우지 않는다 - 무엇이
-- 맞는지는 사람이 안다.
alter table device_master add column if not exists product_code text;
alter table device_master add column if not exists product_name text;

comment on column device_master.product_code is
  '제품 최상위 관리 코드 (DX2401 등). 완제품 형명(PD…)은 그 아래의 규격이다';

-- ── 2. 설비 코드 수정 ──────────────────────────────────────────────────────
-- 설비 코드는 기록에 문자열로 적힌다 (§4.6 equipment_id text). 한 번이라도
-- 쓰인 뒤 코드를 바꾸면 그 기록들이 가리키는 대상이 사라진다 - 기록은 고칠
-- 수도 지울 수도 없으므로 되돌릴 방법이 없다.
--
-- 그래서 "아직 쓰이지 않은 설비"만 코드를 바꿀 수 있게 한다. 오타 정정은
-- 열어 두고, 이력이 생긴 뒤에는 닫는다. 응용이 아니라 여기서 막는다 (§1).
create or replace function trg_equipment_code_locked()
returns trigger language plpgsql as $$
begin
  if new.code is not distinct from old.code then
    return new;
  end if;
  if exists (select 1 from process_record pr where pr.equipment_id = old.code) then
    raise exception '이미 사용된 설비의 코드는 바꿀 수 없습니다. 제조기록에 % 로 적혀 있습니다', old.code;
  end if;
  return new;
end $$;

drop trigger if exists equipment_code_locked on equipment;
create trigger equipment_code_locked before update on equipment
  for each row execute function trg_equipment_code_locked();
