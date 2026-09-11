-- ---------------------------------------------------------------------------
-- 기록 보존 기간 (GMP 부합 점검 A6 · 사용자 결정 2026-09-11 · 5년)
--
-- 13485 §4.2.5 는 기록을 정해진 기간 동안 보존하라고 한다. 그런데 이 시스템에도
-- 사내문서에도 **그 기간이 적힌 곳이 없었다.** `보존기간` 을 코드·이관·문서에서
-- 찾으면 0곳이었다. 범위 밖 목록(§9.1)에도 없어서 빠뜨린 것인지 정한 것인지
-- 알 수 없는 상태였다.
--
-- ── 시스템이 이것으로 무엇을 하는가 ─────────────────────────────────────
-- 지우지 않는다 - 그건 원래 그렇다 (S03). 이 값이 하는 일은 **종이에 적어
-- 주는 것**이다. 정본은 종이이고 오프라인으로 보관하므로(사용자), 편철 표지에
-- "언제까지 두는가" 가 적혀 있어야 철하는 사람이 안다.
--
-- 막지 않는다. 기간이 지났다고 무엇을 지우거나 알리지 않는다 - 지우는 길은
-- 이 시스템에 없다.
--
-- ── 코드에 박지 않는다 (§2.0) ───────────────────────────────────────────
-- 몇 년인지는 제조소와 제품이 정한다. `backup_warn_days` · `expiry_warn_days`
-- 와 같은 자리에 둔다. 비워 두면 응용이 5년으로 읽는다 (lib/brand.ts).
-- ---------------------------------------------------------------------------

alter table org_brand add column if not exists record_retention_years int;

comment on column org_brand.record_retention_years is
  '기록 보존 기간(년). 편철 표지에 인쇄된다. 비우면 5년으로 읽는다';

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'org_brand_retention_range') then
    return;
  end if;
  alter table org_brand add constraint org_brand_retention_range
    check (record_retention_years is null
           or (record_retention_years between 1 and 100));
end $$;
