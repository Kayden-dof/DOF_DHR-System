-- ---------------------------------------------------------------------------
-- 종료 시각이 없는 공정이 있으면 그 묶음을 잠그지 않는다
-- (사용자 결정 2026-09-02)
--
-- 1일차 기록서가 나왔는데 알칼리 처리에 시작 09:35 만 있고 종료가 비어 있었다.
-- 그런데도 마감이 지나갔다.
--
-- 화면은 경고하고 있었다 - "아직 마감하지 않은 공정이 N건 있습니다. 마감하지
-- 않은 공정은 종료 시각이 빈 채로 인쇄됩니다". 지나갈 수 있는 경고였고,
-- 지나가면 **되돌릴 수 없다.** S04 로 잠기고 §10 이 잠금 해제를 금지하므로
-- 그 종료 칸은 영구히 빈다.
--
-- ── 이것이 판정인가 ────────────────────────────────────────────────────
-- 아니다. 적합인지 부적합인지 묻지 않는다. 묻는 것은 하나다 -
-- **아직 적히지 않은 사실을 영영 적을 수 없게 만들고 있는가.**
--
-- §2.1 의 불변식이 "이미 적힌 사실을 없던 일로 만드는가" 를 묻는다면, 이것은
-- 그 짝이다. 되돌릴 수 없는 문 앞에서 빈 칸을 확인한다.
--
-- ── 갇히지 않는다 ──────────────────────────────────────────────────────
-- 내 묶음의 열린 기록은 전부 내 현장 화면에 보이고, S05 가 사유를 받아 주므로
-- (자재를 적거나 해당없음 사유를 적거나) **언제든 종료할 수 있다.** 다른
-- 사람의 묶음을 마감하는 화면 경로는 없다 - closeDay 는 늘 본인 것을 넘긴다.
--
-- 일차를 넘겨 이어지는 공정(동결건조 등)은 끝난 뒤에 그 일차를 마감한다.
-- 종이가 하루 늦게 나오는 것이지 못 나오는 것이 아니다.
--
-- ── 왜 트리거인가 ──────────────────────────────────────────────────────
-- 묶음을 잠그는 길이 둘이다. `lock_day`(현장 마감)와
-- `print_day_record`(기록서를 여는 것 자체가 마감이다 · 0053 · 0063).
-- 함수 두 곳에 같은 검사를 적으면 갈라진다 (§10). day_lock 에 거는 것이
-- 두 길과 앞으로 생길 길을 한 번에 덮는다.
-- ---------------------------------------------------------------------------

create or replace function trg_day_lock_open()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp as $$
declare open_ops text;
begin
  /*
   * 이미 잠긴 묶음이면 묻지 않는다. `on conflict do nothing` 이 걸러 내기
   * 전에 이 트리거가 먼저 돌기 때문이다. 여기서 막으면 **재인쇄가 막힌다** -
   * 0063 이 적어 둔 대로 "이미 마감된 묶음을 다시 뽑는 것은 마감이 아니다".
   *
   * 이 규칙이 서기 전에 잠긴 묶음도 그래서 그대로 다시 뽑을 수 있다.
   * 지난 기록을 소급해 막지 않는다.
   */
  if exists (select 1 from day_lock
              where work_order_id = new.work_order_id
                and day_no        = new.day_no
                and worker_id     = new.worker_id) then
    return new;
  end if;

  select string_agg(
           o.name || case when pr.attempt > 1
                          then ' ' || pr.attempt::text || '회차' else '' end,
           ', ' order by o.seq, pr.attempt)
    into open_ops
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
   where pr.work_order_id = new.work_order_id
     and pr.day_no        = new.day_no
     and pr.worker_id     = new.worker_id
     and pr.ended_at is null;

  if open_ops is not null then
    raise exception
      '종료 시각이 없는 공정이 있어 마감할 수 없습니다 (%). '
      '마감하면 그 칸은 영영 빈 채로 남습니다. 공정을 먼저 마감하십시오', open_ops;
  end if;

  return new;
end $$;

drop trigger if exists day_lock_open on day_lock;
create trigger day_lock_open before insert
  on day_lock for each row execute function trg_day_lock_open();

comment on trigger day_lock_open on day_lock is
  '종료 시각이 없는 공정을 품은 채 잠그지 않는다. 잠금 해제가 없으므로 '
  '그 칸은 영구히 빈다 (사용자 결정 2026-09-02)';
