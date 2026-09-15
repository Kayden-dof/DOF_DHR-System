-- ---------------------------------------------------------------------------
-- 라벨 용지 크기를 설정으로 (사용자 지시 2026-09-15)
-- 근거 CLAUDE.md §2.0 · §7 · 사내문서/하드웨어 조건.md
--
-- ── 왜 필요한가 ────────────────────────────────────────────────────────
-- 인쇄물이 전부 A4 세로로 고정되어 있었다 (`globals.css` 의 `@page` 한 줄이
-- 일곱 양식을 전부 정한다). 자재 라벨도 A4 한 장에 하나씩 테두리 상자로
-- 나왔다. 그래서 **라벨 전용 프린터를 살 수 없었다** - 용지가 100×70mm 인데
-- 종이는 A4 로 나가니 맞을 자리가 없다.
--
-- ── 크기를 코드에 박지 않는다 ──────────────────────────────────────────
-- 어느 용지를 쓰는지는 **제조소가 정하는 값**이다. 다른 제조소는 다른 프린터를
-- 쓰고 다른 용지를 쓴다. §2.0 의 판단 기준("다른 제조소가 이 프로그램을 그대로
-- 받아 쓸 수 있는가")에서 코드에 박힌 치수는 걸린다.
--
-- 그래서 회사 표시 설정에 둔다. 넣으면 라벨 용지 인쇄가 열리고, 비우면 A4
-- 하나만 남는다 - **기본값을 두지 않는다.** 아무 치수나 기본으로 넣어 두면
-- 그 값이 코드에 박힌 치수와 같아진다.
--
-- ── 판정하지 않는다 ────────────────────────────────────────────────────
-- 종이 크기는 GMP 판정과 무관하다. 무엇이 라벨에 적히는지는 그대로이고,
-- 담기는 자리만 달라진다.
--
-- ── 울타리만 둔다 ──────────────────────────────────────────────────────
-- 20mm ~ 300mm. 어느 제조소의 값도 아니고 **있을 수 없는 값**을 막는 바깥
-- 울타리다 (§4.5 의 sheet_count 와 같은 성격). 5mm 짜리 종이에는 바코드가
-- 들어가지 않고, 300mm 를 넘으면 그것은 라벨이 아니라 전지다.
-- ---------------------------------------------------------------------------

alter table org_brand add column if not exists label_width_mm  int;
alter table org_brand add column if not exists label_height_mm int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_brand_label_size') then
    alter table org_brand add constraint org_brand_label_size check (
      (label_width_mm is null) = (label_height_mm is null)
      and (label_width_mm  is null or label_width_mm  between 20 and 300)
      and (label_height_mm is null or label_height_mm between 20 and 300)
    );
  end if;
end $$;

comment on column org_brand.label_width_mm is
  '라벨 용지 가로(mm). 비면 라벨 용지 인쇄를 내지 않는다 (§2.0 · 0114)';
comment on column org_brand.label_height_mm is
  '라벨 용지 세로(mm). 가로와 함께 채우거나 함께 비운다 (0114)';
