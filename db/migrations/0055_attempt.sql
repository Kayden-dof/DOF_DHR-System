/* ---------------------------------------------------------------------------
   회차는 DB 가 센다 (2차 검수 결함 7)

   §3 은 WS-05 에서 pH 8 을 넘으면 추가 세척을 하고 회차가 오른다고 정한다.
   그런데 회차를 화면이 정하고 있었고, 세는 범위가 "선택된 일차의, 내 기록"
   뿐이었다. 어제 세척하고 오늘 다시 세척하면 회차가 다시 1 이 된다.
   다른 작업자가 이어받아도 같다.

   막아야 할 유일 제약도 일하지 않았다. 재단 전 공정은 product_lot_id 가
   비어 있는데, PostgreSQL 은 빈 값을 서로 다른 값으로 보므로 같은 조합이
   몇 줄이든 들어간다. WS-01 부터 PI-01 까지 전 공정이 해당한다.

   ── 왜 종이에서 문제가 되는가 ─────────────────────────────────────────────
   제조기록서는 회차가 2 이상일 때만 "N회차" 를 찍는다. 둘 다 1회차로 나오면
   검토자는 중복 기입인지 정당한 재세척인지 종이만 봐서는 가릴 수 없다.
   시약도 두 번 불출되어 장입 20장에 4통이 들어가는데, 검토 지원의 구간 이탈
   판정은 기록 단위로 견주므로 두 줄 모두 통과한다. "이 수량이 맞다는 근거가
   무엇인가" 에 시스템이 답하지 못한다.

   ── 어디서 세는가 ─────────────────────────────────────────────────────────
   배치와 공정과 제품 로트가 같으면 같은 계열이다. 일차도 작업자도 보지 않는다 -
   어제 내가 한 것을 오늘 네가 이어받아도 그건 같은 공정의 두 번째다.
--------------------------------------------------------------------------- */


/* === 1. 빈 값을 같은 값으로 보게 한다 =================================== */
/*
 * 0013 의 유일 제약을 걷고 같은 컬럼으로 다시 만든다. 이번에는
 * nulls not distinct 를 붙인다 - 이것 하나가 빠져서 제약이 아무것도 막지
 * 못하고 있었다.
 *
 * 겹친 행이 이미 있으면 인덱스를 만들 수 없다. 시연 자료에 실제로 있으므로
 * 인쇄 시각 대신 기록 순서(작업일, 일차)로 회차를 다시 매겨 자리를 만든다.
 */
do $$
declare n int;
begin
  /*
   * 이미 자리가 잡혔으면 건너뛴다 (4차 감사 F4).
   *
   * 이 블록은 인덱스를 만들 자리를 마련하는 **일회성 복구**인데, 이관에
   * 대장이 없어 배포마다 다시 돌았다. 값이 같으면 UPDATE 가 0건이라 결과는
   * 같지만, session_replication_role='replica' 로 감사 · S03 · S04 · 불변식을
   * 전부 물러나게 한 채 기록 컬럼을 쓰는 코드가 상시 재실행되는 것이다.
   *
   * 인덱스가 이미 서 있으면 겹친 행이 없다는 뜻이므로 할 일이 없다.
   */
  if exists (select 1 from pg_class where relname = 'process_record_attempt_uk' and relkind = 'i') then
    return;
  end if;

  set local session_replication_role = 'replica';

  with ranked as (
    select id, row_number() over (
             partition by work_order_id, product_lot_id, operation_id
             order by work_date, day_no, started_at nulls last, id) as rn
      from process_record)
  update process_record pr
     set attempt = r.rn
    from ranked r
   where pr.id = r.id and pr.attempt <> r.rn;

  get diagnostics n = row_count;
  if n > 0 then
    raise notice '겹치거나 어긋난 공정 회차 %건을 기록 순서로 다시 매겼습니다', n;
  end if;

  set local session_replication_role = 'origin';
end $$;

alter table process_record
  drop constraint if exists process_record_work_order_id_product_lot_id_operation_id_at_key;

drop index if exists process_record_attempt_uk;
create unique index process_record_attempt_uk
  on process_record (work_order_id, product_lot_id, operation_id, attempt)
  nulls not distinct;


/* === 2. 회차는 넣을 때 DB 가 채운다 ===================================== */
/*
 * 화면이 비워 보내면 DB 가 센다. 값을 보내면 그대로 쓴다 - 시드와 시험이
 * 특정 회차를 지정해 넣는 일이 있고, 그건 막을 이유가 없다. 겹치면 위
 * 인덱스가 잡는다.
 *
 * attempt 는 not null 이지만 BEFORE 트리거가 제약 검사보다 먼저 돌므로
 * 빈 값으로 들어와도 여기서 채워진다.
 */
create or replace function trg_pr_attempt()
returns trigger language plpgsql as $fn$
begin
  if new.attempt is null then
    select coalesce(max(attempt), 0) + 1 into new.attempt
      from process_record
     where work_order_id = new.work_order_id
       and operation_id = new.operation_id
       and product_lot_id is not distinct from new.product_lot_id;
  end if;
  return new;
end $fn$;

drop trigger if exists process_record_attempt on process_record;
create trigger process_record_attempt before insert on process_record
  for each row execute function trg_pr_attempt();

comment on column process_record.attempt is
  '재작업 · 재세척 회차. 비워 두면 DB 가 (배치, 공정, 제품로트) 기준으로 채운다';
