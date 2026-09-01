-- ---------------------------------------------------------------------------
-- 복구 대장 (사용자 지시 2026-09-01)
--
-- 화면에서 복구를 할 수 있게 하면서, 그것이 언제 누구에 의해 무엇으로
-- 일어났는지를 남긴다.
--
-- ── 이 표만은 복구가 덮지 않는다 ────────────────────────────────────────
-- 복구는 표를 통째로 갈아 끼운다. 이 표까지 갈아 끼우면 복구 이력이 매번
-- 사라지고, "이 DB 는 언제 무엇으로 되돌려졌는가" 에 아무도 답할 수 없다.
-- 그건 감사추적을 지우는 것과 같다 (§1).
--
-- 그래서 복구 대상에서 뺀다 (lib/restore.ts 의 KEEP). 복구를 거듭해도 이
-- 표에는 그 모든 회차가 쌓인다.
--
-- ── 사람을 FK 로 걸지 않는다 ────────────────────────────────────────────
-- 복구는 app_user 도 갈아 끼운다. 복구를 실행한 사람이 그 백업 시점에는
-- 없던 계정일 수 있고, 그러면 FK 가 깨진다. 이름을 그대로 적는다 -
-- product_lot.release_approved_by 가 서면 승인자를 text 로 적는 것과 같은
-- 이유다 (§4.5).
-- ---------------------------------------------------------------------------

create table if not exists restore_log (
  id             uuid primary key default gen_random_uuid(),
  restored_at    timestamptz not null default now(),
  restored_by_name text not null,
  restored_by_code text not null,
  file_name      text not null,
  data_sha256    text not null,
  backup_taken_at text not null,
  rows_before    int not null check (rows_before >= 0),
  rows_after     int not null check (rows_after >= 0),
  table_count    int not null check (table_count > 0),
  elapsed_ms     int not null check (elapsed_ms >= 0),
  note           text
);

create index if not exists restore_log_at on restore_log (restored_at desc);

comment on table restore_log is
  '복구를 실행한 사실. 복구가 이 표를 덮지 않는다 - 덮으면 이력이 매번 사라진다';
comment on column restore_log.rows_before is
  '복구 직전 이 DB 에 있던 행 수. 무엇을 덮었는지 뒤에 알 수 있어야 한다';

grant select, insert on restore_log to app_role;
grant select on restore_log to app_readonly;
revoke delete on restore_log from app_role, app_readonly;
revoke update on restore_log from app_role, app_readonly;

drop trigger if exists restore_log_no_delete on restore_log;
create trigger restore_log_no_delete before delete or truncate
  on restore_log for each statement execute function trg_block_delete();

drop trigger if exists restore_log_audit on restore_log;
create trigger restore_log_audit after insert
  on restore_log for each row execute function trg_audit();
