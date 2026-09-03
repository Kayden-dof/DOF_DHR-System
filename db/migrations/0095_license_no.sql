-- ---------------------------------------------------------------------------
-- 제품 허가증 번호를 제품표준서에 담는다 (사용자 지시 2026-09-02)
--
-- 제품을 등록할 때 허가(인증 · 신고) 번호를 함께 적을 자리가 없었다. 그 번호는
-- **의료기기 라벨에 찍히는 값**이고, 라벨요청서를 받는 업체가 그것을 보고
-- 찍는다.
--
-- ── 왜 제품표준서에 붙는가 ─────────────────────────────────────────────
-- 제품 코드 · 제품명이 이미 여기 있다. 그리고 허가는 **바뀐다** - 변경허가가
-- 나면 번호나 내용이 달라진다. 제품표준서는 개정으로 판을 가르는 표이므로,
-- 개정마다 그때 유효한 번호가 적히면 지난 배치의 종이가 그때의 번호를 그대로
-- 가리킨다. 한 자리에 한 값만 두면 옛 종이가 새 번호를 가리키게 된다.
--
-- 그래서 변경허가는 새 개정본으로 간다. 그것이 이 표의 원래 어법이다.
--
-- ── 판정하지 않는다 ────────────────────────────────────────────────────
-- 허가인지 인증인지 신고인지 고르게 하지 않는다. 그 갈래는 나라와 등급이
-- 정하는 것이고, 목록을 화면에 내놓는 순간 그 목록이 분류 체계가 된다
-- (§10 이 일탈 등급에 대해 적은 것과 같은 이유). **서면 허가증에 적힌 번호를
-- 그대로 옮겨 적는다.** 유효한지 만료됐는지도 묻지 않는다.
--
-- 허가증 자체는 담지 않는다. 번호로 가리킬 뿐이다 (§2.2 · §1).
--
-- ── 발행 뒤에는 얼린다 ─────────────────────────────────────────────────
-- 0084 가 제품 코드 · 제품명을 얼린 것과 같은 이유다. 작업 지시가 나간 뒤에
-- 번호를 바꾸면 **같은 개정번호로 다른 번호가 찍힌 종이가 나간다.**
-- ---------------------------------------------------------------------------

alter table device_master add column if not exists license_no text;

comment on column device_master.license_no is
  '서면 허가증(인증 · 신고)에 적힌 번호를 그대로 옮겨 적는다. 라벨에 찍히는 '
  '값이며, 변경허가는 새 개정본으로 간다 (사용자 지시 2026-09-02)';


-- === 발행 뒤에는 고쳐 쓰지 않는다 (0084 와 같은 자리) ======================

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
  /*
   * 허가 번호도 같다 (0095). 라벨에 찍히는 값이라, 바꾸면 이미 나간 배치의
   * 라벨요청서를 다시 뽑을 때 다른 번호가 인쇄된다. 변경허가는 새 개정본으로.
   */
  if new.license_no is distinct from old.license_no then
    raise exception '작업 지시가 나간 제품표준서의 허가 번호는 바꿀 수 없습니다. '
      '변경허가는 새 개정본으로 등록하십시오 (지시 %건)', n;
  end if;
  return new;
end $$;
