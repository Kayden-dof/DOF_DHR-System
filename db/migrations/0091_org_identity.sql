-- ---------------------------------------------------------------------------
-- 제조소를 가리키는 값을 설정에 담는다 (5차 감사 D1 · 사용자 결정 2026-09-02)
--
-- `org_brand` 는 이름 · 색 · 로고 · 표어만 갖고 있었다. 제조소 소재지 ·
-- 사업자등록번호 · 대표자를 담을 곳이 아예 없어, 종이에 그것이 필요하면
-- **코드를 고치는 수밖에 없었다** (§2.0 "다른 제조소가 받아 쓸 수 있는가").
--
-- 이 시스템의 인쇄물은 미리 인쇄된 양식에 얹는 것이 아니라 통째로 만들어
-- 낸다. 그러니 종이 위에 제조소가 누구인지 적을 자리는 여기여야 한다.
--
-- ── 판정하지 않는다 ────────────────────────────────────────────────────
-- 무엇이 필요한지 정하지 않는다. 비워 두면 인쇄되지 않는다 - 서면 양식이
-- 이미 갖고 있으면 시스템이 낼 이유가 없다 (§1). 셋 다 선택이다.
-- ---------------------------------------------------------------------------

alter table org_brand add column if not exists address     text;
alter table org_brand add column if not exists biz_no      text;
alter table org_brand add column if not exists ceo_name    text;

comment on column org_brand.address is
  '제조소 소재지. 인쇄물 머리에 회사 이름과 함께 나온다. 비우면 안 나온다';
comment on column org_brand.biz_no is
  '사업자등록번호. 비우면 안 나온다';
comment on column org_brand.ceo_name is
  '대표자. 비우면 안 나온다';
