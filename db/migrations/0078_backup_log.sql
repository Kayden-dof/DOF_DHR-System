-- ---------------------------------------------------------------------------
-- 백업 대장 (사용자 요청 2026-09-01)
--
-- 백업을 CLI 로만 뜰 수 있었다. `.env.deploy` 를 가진 사람만 돌릴 수 있고,
-- 파일은 그 사람의 기계에 떨어졌다. 자동으로 도는 것도 없었다. 그래서 실제
-- 상태는 "생각날 때 손으로 뜬 것이 노트북에 있다" 였다.
--
-- 시스템관리자가 화면에서 뜰 수 있게 하면서, 그것이 언제 누구에 의해
-- 일어났는지를 남긴다.
--
-- ── 왜 남기는가 ─────────────────────────────────────────────────────────
-- 백업 한 번은 이 회사의 제조기록 전부가 한 파일로 밖으로 나가는 일이다.
-- 감사추적이 답해야 하는 "무엇이 언제 누구에 의해" 에 이보다 더 맞는 것이
-- 드물다. 파일 자체는 담지 않는다 - 대장은 그것이 일어났다는 사실을 적는
-- 자리이지 그 내용을 보관하는 자리가 아니다 (§2.2).
--
-- ── 마지막이 언제였는지가 화면에 보여야 한다 ─────────────────────────────
-- 뜨는 것을 사람에게 맡기면 잊는다. 대장이 있으면 화면이 "마지막 백업 12일
-- 전" 이라고 말할 수 있고, 그것이 잊지 않게 하는 유일한 장치다. 차단하지
-- 않는다 - 경고만 한다 (§2).
-- ---------------------------------------------------------------------------

create table if not exists backup_log (
  id            uuid primary key default gen_random_uuid(),
  taken_at      timestamptz not null default now(),
  taken_by      uuid not null references app_user(id),
  file_name     text not null,
  byte_size     bigint not null check (byte_size > 0),
  total_rows    int not null check (total_rows >= 0),
  table_count   int not null check (table_count > 0),
  data_sha256   text not null,
  migration_count int not null check (migration_count > 0),
  note          text
);

create index if not exists backup_log_taken_at on backup_log (taken_at desc);

comment on table backup_log is
  '백업을 뜬 사실. 파일은 담지 않는다 - 언제 누가 떴는지만 남긴다';
comment on column backup_log.data_sha256 is
  '내려받은 파일의 지문. 나중에 그 파일이 이 대장의 그것인지 대조한다';

grant select, insert on backup_log to app_role;
grant select on backup_log to app_readonly;
revoke delete on backup_log from app_role, app_readonly;
revoke update on backup_log from app_role, app_readonly;

-- 뜬 사실은 고쳐 쓰지 않는다. 대장이 곧 기록이다
drop trigger if exists backup_log_no_delete on backup_log;
create trigger backup_log_no_delete before delete or truncate
  on backup_log for each statement execute function trg_block_delete();

drop trigger if exists backup_log_audit on backup_log;
create trigger backup_log_audit after insert
  on backup_log for each row execute function trg_audit();
