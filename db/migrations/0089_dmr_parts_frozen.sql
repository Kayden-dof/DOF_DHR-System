-- ---------------------------------------------------------------------------
-- 발행 뒤에는 공정과 자재 구성표도 고쳐 쓰지 않는다 (5차 감사 A3)
--
-- 0084 가 device_master 본체를 잠갔다 - 작업 지시가 나간 개정본의 제품 코드 ·
-- 제품명 · 품목 · 개정번호는 못 바꾼다. "같은 개정번호로 다른 종이가 나간다"
-- 는 이유였다.
--
-- 그런데 그 아래 표들은 열려 있었다. `dmr_operation` 의 공정 코드와 이름을
-- 바꾸면 **이미 나간 배치의 제조기록서를 다시 뽑을 때 다른 공정 이름이
-- 인쇄된다.** `dmr_bom` 의 소요량을 바꾸면 이미 인쇄된 작업지시서의 시약
-- 소요량과 다른 값이 나온다. 0084 가 막은 것과 같은 일이 한 층 아래에서
-- 그대로 일어났다.
--
-- ── 화면에는 고치는 자리가 아예 없었다 ──────────────────────────────────
-- 그래서 지금까지 문제가 되지 않았을 뿐이다. A3 이 그 자리를 내므로 문을
-- 열기 전에 울타리를 먼저 세운다. 순서를 반대로 하면 그 사이에 고쳐 쓴
-- 자료가 남는다.
--
-- ── 무엇을 막고 무엇을 여는가 ──────────────────────────────────────────
--   막는다   작업 지시가 나간 개정본의 공정 · 자재 구성표 · 구간 수정
--   연다     지시가 나가기 전에는 전부. 오기 정정이 정상 작업이다
--
-- 0084 와 같은 어법이다. 판정하지 않는다 - 무엇이 옳은 소요량인지 정하지
-- 않고, **이미 종이에 나간 값을 없던 일로 만들고 있는가**만 묻는다 (§2.1).
--
-- 새로 넣는 것(insert)은 막지 않는다. 지시가 나간 뒤에 공정이나 자재를
-- 더하는 것은 앞서 나간 종이를 뒤집지 않는다. 그것까지 막으면 개정본을
-- 이어서 채우는 정상 작업이 막힌다.
-- ---------------------------------------------------------------------------

create or replace function trg_dmr_part_frozen()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_dm uuid; n int; what text;
begin
  /* 어느 제품표준서에 딸린 줄인가. 표마다 닿는 길이 다르다 */
  if tg_table_name = 'dmr_operation' then
    v_dm := old.device_master_id;
    what := '공정';
  elsif tg_table_name = 'dmr_bom' then
    select o.device_master_id into v_dm
      from dmr_operation o where o.id = old.operation_id;
    what := '자재 구성표';
  else
    select o.device_master_id into v_dm
      from dmr_bom b join dmr_operation o on o.id = b.operation_id
     where b.id = old.dmr_bom_id;
    what := '장입 구간';
  end if;

  if v_dm is null then
    return new;
  end if;

  select count(*) into n from work_order where device_master_id = v_dm;
  if n = 0 then
    return new;                      -- 아직 아무 지시도 안 나갔다
  end if;

  raise exception
    '작업 지시가 나간 제품표준서의 %은(는) 고칠 수 없습니다 (지시 %건). '
    '같은 개정번호로 다른 종이가 나갑니다. 개정본을 새로 만드십시오', what, n;
end $$;

drop trigger if exists dmr_operation_frozen on dmr_operation;
create trigger dmr_operation_frozen before update
  on dmr_operation for each row execute function trg_dmr_part_frozen();

drop trigger if exists dmr_bom_frozen on dmr_bom;
create trigger dmr_bom_frozen before update
  on dmr_bom for each row execute function trg_dmr_part_frozen();

drop trigger if exists dmr_bom_tier_frozen on dmr_bom_tier;
create trigger dmr_bom_tier_frozen before update
  on dmr_bom_tier for each row execute function trg_dmr_part_frozen();

comment on function trg_dmr_part_frozen() is
  '작업 지시가 나간 개정본의 공정 · 자재 구성표 · 구간을 고쳐 쓰지 않는다. '
  '0084 가 본체에 건 것과 같은 성격이다 (5차 감사 A3)';
