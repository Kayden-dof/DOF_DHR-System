/* ===========================================================================
   0126 · 설비마다 검교정 주기와 항목 (사용자 2026-11-09 검교정 목록)

   사용자가 정리해 준 목록은 설비마다 «교정 일자 · 검교정 주기 · 검교정 항목»
   이다. 주기는 셋 가운데 하나다.

     ANNUAL   매년. 이력의 만료일로 유효 여부를 본다 (지금까지와 같다)
     ONCE     최초 설치시 1회. 한 번 하면 끝이라 만료가 없다
     NONE     검교정 대상 아님 (포충등 · 방서기 · 후드 · 절단기 …)

   ── 대상 아님은 «기록 없음» 이 아니다 ─────────────────────────────────────
   지금까지는 이력이 없는 설비를 모두 «밸리데이션 기록 없음» 으로 빨갛게 짚었다.
   대상이 아닌 설비까지 그렇게 짚으면 진짜로 빠진 것이 그 속에 묻힌다.
   NONE 인 설비는 발행 화면 · 현장 타일 · 지시서에서 짚지 않는다.

   ── 1회는 만료일을 9999-12-31 로 적는다 ──────────────────────────────────
   이력의 valid_until 은 비울 수 없고, 사용일에 유효했는가를 보는 셈(검토 지원 ·
   발행 경고)이 모두 그 날짜와 견준다. «만료 없음» 을 그 셈들이 따로 알게 하지
   않고 날짜 하나로 둔다. 화면은 9000년 이후를 «기한 없음» 으로 읽는다
   (lib/equipment-check.ts).
=========================================================================== */

alter table equipment add column if not exists check_cycle text not null default 'ANNUAL';
alter table equipment add column if not exists check_items text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'equipment_check_cycle') then
    alter table equipment add constraint equipment_check_cycle
      check (check_cycle in ('ANNUAL', 'ONCE', 'NONE'));
  end if;
end $$;

comment on column equipment.check_cycle is
  '검교정 주기: ANNUAL 매년 · ONCE 최초 설치시 1회 · NONE 대상 아님 (0126)';
comment on column equipment.check_items is
  '검교정 항목. 압력 · 온도 · RPM · 유량 등 (0126)';
