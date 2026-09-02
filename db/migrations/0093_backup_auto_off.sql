-- ---------------------------------------------------------------------------
-- 자동 백업을 걷는다 (사용자 결정 2026-09-02)
--
-- 0092 가 예약 작업이 뜬 백업을 담으려고 표를 넓혔다. 그런데 **자동 백업을
-- 두지 않기로 했다** - 운영하는 주체가 달마다 또는 분기마다 사람이 뜨고,
-- 그 절차를 따로 문서로 만든다.
--
-- 그러면 0092 가 더한 것은 아무도 쓰지 않는다. 쓰지 않는 열은 "무언가 그것을
-- 쓴다" 고 읽히게 만들고, 나중에 이 표를 보는 사람이 자동 백업이 도는 줄
-- 안다. 되돌린다.
--
--   taken_by   다시 필수로. 백업은 사람이 뜬다
--   source     내린다. 갈래가 하나뿐이면 갈래를 적을 이유가 없다
--   stored_at  내린다. 사람이 내려받은 파일은 그 사람의 자리에 있다
--
-- ── 지우는 것이 §10 을 어기지 않는가 ───────────────────────────────────
-- §10 이 막는 것은 **기록**을 지우는 것이다. 이것은 기록이 아니라 하루 만에
-- 생겼다 없어지는 열이고, 그 열에 담긴 기록이 없다. 담긴 것이 있으면 아래
-- 확인에서 걸려 이관이 멈춘다.
-- ---------------------------------------------------------------------------

do $$
declare n int;
begin
  /*
   * 담긴 것이 있으면 멈춘다. 지우기 전에 무엇을 지우는지 아는 것이 먼저다.
   * 예약 작업이 실제로 뜬 적이 있으면 사람 손으로 옮기고 다시 올린다.
   */
  if exists (select 1 from information_schema.columns
              where table_name = 'backup_log' and column_name = 'source') then

    select count(*) into n from backup_log
     where taken_by is null or source <> 'MANUAL' or stored_at is not null;

    if n > 0 then
      raise exception
        '자동으로 뜬 백업 기록이 %건 있습니다. 지우기 전에 옮기십시오', n;
    end if;
  end if;
end $$;

alter table backup_log drop constraint if exists backup_log_source_check;
alter table backup_log drop column if exists source;
alter table backup_log drop column if exists stored_at;

/* 사람이 뜬다. 실행자가 없는 백업은 이제 없다 */
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'backup_log' and column_name = 'taken_by'
                and is_nullable = 'YES') then
    alter table backup_log alter column taken_by set not null;
  end if;
end $$;

comment on column backup_log.taken_by is
  '누가 떴는가. 백업은 사람이 화면에서 뜬다 (사용자 결정 2026-09-02)';


-- === 백업 주기를 코드에 박지 않는다 ========================================
--
-- 설정 화면이 마지막 백업이 **7일**을 넘으면 경고했다. 자동 백업이 있을 때는
-- 맞는 값이었는데, 사람이 달마다 또는 분기마다 뜨기로 하면 그 경고는 늘 켜져
-- 있게 된다. **늘 켜진 경고는 아무도 보지 않는다** - 경고가 아니라 배경이 된다.
--
-- 며칠이 지나면 물어야 하는지는 그 제조소의 절차가 정한다 (§2.0). 코드가
-- 정할 일이 아니다. 기본값은 35일 - 달마다 뜨기로 했을 때 한 번 걸러도
-- 한 달을 조금 넘겨야 켜진다.
--
-- 판정하지 않는다. 백업이 늦었는지 아닌지 말할 뿐 아무것도 막지 않는다.

alter table org_brand add column if not exists backup_warn_days int;

update org_brand set backup_warn_days = 35 where backup_warn_days is null;

/*
 * 되풀이해 올려도 되게 감싼다. 그리고 NOT VALID 로 걸지 않는다 - 위에서
 * 전부 채웠으므로 어길 행이 없고, NOT VALID 는 옛 행을 품은 백업의 복구를
 * 막은 전례가 있다 (§10).
 */
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'backup_warn_days_range') then
    alter table org_brand add constraint backup_warn_days_range
      check (backup_warn_days is null or backup_warn_days between 1 and 400);
  end if;
end $$;

comment on column org_brand.backup_warn_days is
  '마지막 백업이 며칠을 넘기면 설정 화면이 묻는가. 그 제조소의 절차가 정한다';
