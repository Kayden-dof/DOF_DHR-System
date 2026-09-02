-- ---------------------------------------------------------------------------
-- 사람이 없어도 백업이 남게 한다 (5차 감사 C3 · 사용자 결정 2026-09-02)
--
-- 자동 백업의 유일한 경로가 **누군가의 PC 에 걸린 작업 스케줄러**였다
-- (`scripts/backup-schedule.ps1`). 그 PC 가 꺼져 있거나 사람이 바뀌면 백업이
-- 없다. 서버에서 도는 것은 하나도 없었다 - `vercel.json` 의 예약 작업은
-- 유효기한과 로그인 청소만 한다.
--
-- 보완책은 있었다. 설정 화면이 마지막 백업이 7일을 넘으면 경고를 띄운다.
-- 다만 사람이 그 화면을 열어야 보인다.
--
-- ── 표가 사람을 전제하고 있었다 ────────────────────────────────────────
-- `taken_by` 가 NOT NULL 이라 사람이 아닌 실행자를 적을 수 없었다.
-- 일 1회 배치는 이미 `app.user_id` 를 비운 채 돈다 - "사람이 한 일처럼
-- 꾸미지 않는다" (0032 · /api/daily). 백업도 같아야 한다.
--
--   taken_by   빈 값을 허용한다. 비었으면 사람이 뜬 것이 아니다
--   source     MANUAL(화면에서 내려받음) · AUTO(예약 작업이 떴음)
--   stored_at  파일을 어디에 두었는가. 못 두었으면 비어 있다
--
-- 판정하지 않는다. 백업이 좋은지 나쁜지 말하지 않고, 무엇이 언제 어디에
-- 남았는지만 적는다.
-- ---------------------------------------------------------------------------

alter table backup_log alter column taken_by drop not null;

alter table backup_log add column if not exists source    text not null default 'MANUAL';
alter table backup_log add column if not exists stored_at text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'backup_log_source_check') then
    alter table backup_log add constraint backup_log_source_check
      check (source in ('MANUAL', 'AUTO'));
  end if;
end $$;

comment on column backup_log.taken_by is
  '사람이 떴으면 그 계정. 예약 작업이 떴으면 비어 있다 - 꾸미지 않는다';
comment on column backup_log.source is
  'MANUAL 화면에서 내려받음 · AUTO 예약 작업이 떴음 (5차 감사 C3)';
comment on column backup_log.stored_at is
  '파일을 둔 자리. 사람이 내려받은 것은 그 PC 에 있으므로 비어 있다';

/*
 * 예약 작업이 이 표에 줄을 남긴다. 실행자가 없으므로 소유자로 도는데,
 * app_role 에도 열어 둔다 - 화면에서 뜨는 백업이 같은 표를 쓴다.
 */
grant insert, select on backup_log to app_role;
