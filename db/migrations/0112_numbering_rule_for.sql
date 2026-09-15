-- ---------------------------------------------------------------------------
-- 규칙을 고르는 차례를 한 자리에 둔다
-- 근거 §4.10 (품목별 > 종류별 > 공통) · 0097 · 제품 세우기 화면 (2026-09-15)
--
-- ── 왜 지금인가 ────────────────────────────────────────────────────────
-- "이 제품으로 제조번호를 만들 수 있는가" 를 화면이 묻게 되었다. 그 답은
-- `next_number` 안에만 있고, 그 안의 where 와 order by 가 곧 §4.10 의 차례다.
-- 화면이 같은 조건을 다시 적으면 규칙 고르는 차례가 두 곳이 된다 - 0097 이
-- 종류별을 더했을 때 한쪽만 고쳤다면 화면과 실제가 갈렸을 것이다.
--
-- ── 잠그는 일은 그대로 next_number 가 한다 ─────────────────────────────
-- 고르는 것과 잠그는 것은 다른 일이다. 여기서는 어느 규칙인지만 답하고,
-- 발행하는 쪽은 그 id 를 다시 `for share` 로 잡는다. 화면은 잠글 이유가 없다.
--
-- ── 판정하지 않는다 ────────────────────────────────────────────────────
-- 규칙이 옳은지 묻지 않는다. 어느 규칙이 걸리는지, 걸리는 것이 있는지만 답한다.
-- ---------------------------------------------------------------------------

create or replace function numbering_rule_for(
  p_target numbering_target,
  p_item   uuid default null
) returns uuid
language plpgsql stable
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_type item_type; v_id uuid;
begin
  /*
   * 품목 종류. item 표가 없는 설치(M0)에서는 종류별 규칙이 성립하지 않으므로
   * 조용히 건너뛴다 - 그때는 공통 규칙만 남는다.
   */
  if p_item is not null and to_regclass('public.item') is not null then
    execute 'select type from item where id = $1' into v_type using p_item;
  end if;

  /* 좁은 것이 먼저다 - 품목별 > 종류별 > 공통 (§4.10 · 0097) */
  select id into v_id from numbering_rule
   where target = p_target and is_active
     and (item_id = p_item
          or (item_id is null and item_type is null)
          or (item_id is null and item_type = v_type))
   order by (item_id is null), (item_type is null)
   limit 1;

  return v_id;
end $fn$;

comment on function numbering_rule_for(numbering_target, uuid) is
  '그 대상·품목에 걸리는 채번 규칙. 없으면 null. 고르는 차례는 §4.10 (0112)';


-- === next_number 가 같은 차례를 쓴다 =======================================
--
-- 조건을 여기서 다시 적지 않는다. 고른 뒤 그 행을 `for share` 로 잡는 것은
-- 그대로다 - 발행 중에 규칙이 갈리면 번호가 반쯤 다른 규칙으로 나온다.

create or replace function next_number(
  p_target numbering_target,
  p_item   uuid default null,
  p_at     date default null,
  p_batch  text default null)
returns text language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  r      record;
  v_now  timestamp;
  v_code text;
  ck     text;
  v_base int;
  n      int;
begin
  /* 고르는 차례는 numbering_rule_for 하나에 있다 (0112) */
  select * into r from numbering_rule
   where id = numbering_rule_for(p_target, p_item)
     for share;                        -- 발행 중 규칙 교체를 막는다
  if not found then
    raise exception '채번 규칙이 정의되지 않았습니다 (%)', p_target;
  end if;

  /*
   * 날짜. 주지 않으면 오늘이다.
   *
   * 준 날짜는 **패턴과 주기 키 양쪽에 함께** 쓴다. 한쪽만 쓰면 번호에 찍힌
   * 날짜와 순번이 세는 날이 갈라져, 같은 날짜에 -01 이 둘 나온다.
   */
  v_now := coalesce(p_at::timestamp, timezone('Asia/Seoul', now()));

  ck := case r.reset
          when 'NEVER'   then 'NEVER'
          when 'YEARLY'  then to_char(v_now, 'YYYY')
          when 'MONTHLY' then to_char(v_now, 'YYYY-MM')
          when 'DAILY'   then to_char(v_now, 'YYYY-MM-DD')
        end;

  /* 순번 승계. 규칙을 교체해도 이미 나간 번호가 다시 나오지 않게 한다 */
  select coalesce(max(c.last_seq), 0) into v_base
    from numbering_counter c
    join numbering_rule  nr on nr.id = c.rule_id
   where nr.target = r.target
     and nr.item_id   is not distinct from r.item_id
     and nr.item_type is not distinct from r.item_type
     and c.cycle_key = ck;

  /* 원자적 증가. 조회 후 증가시키는 방식으로 바꾸지 말 것 */
  insert into numbering_counter (rule_id, cycle_key, last_seq)
  values (r.id, ck, v_base + 1)
  on conflict (rule_id, cycle_key)
    do update set last_seq = numbering_counter.last_seq + 1
  returning last_seq into n;

  if r.pattern like '%{ITEM}%' or r.pattern like '%{MODEL}%' then
    if to_regclass('public.item') is null then
      raise exception '품목 토큰은 item 표(M1) 도입 이후에 사용할 수 있습니다';
    end if;
    if p_item is null then
      raise exception '채번 규칙에 품목 토큰이 있으나 품목이 지정되지 않았습니다 (%)', r.pattern;
    end if;
    execute 'select code from item where id = $1' into v_code using p_item;
    if v_code is null then
      raise exception '품목을 찾을 수 없습니다 (%)', p_item;
    end if;
  end if;

  /* 풀리지 않은 토큰을 그대로 내보내지 않는다 (품목 토큰과 같은 수) */
  if r.pattern like '%{BATCH}%' and p_batch is null then
    raise exception '채번 규칙에 배치 토큰이 있으나 배치가 지정되지 않았습니다 (%)', r.pattern;
  end if;

  return render_number(r.pattern, r.seq_width, n, v_now, v_code, p_batch);
end $fn$;
