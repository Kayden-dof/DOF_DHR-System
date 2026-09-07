-- ---------------------------------------------------------------------------
-- 채번에 {BATCH} 토큰을 낸다 (사용자 결정 2026-09-07)
--
-- 사내 규칙이 "멸균 배치번호는 생산 배치번호와 같다" 로 정해졌다. 한 번의
-- 멸균 발송이 한 생산 배치이기 때문이다.
--
-- ── 왜 코드에 박지 않는가 ────────────────────────────────────────────────
-- `steril_batch.batch_no := work_order.batch_no` 를 응용에 박으면 그 줄이 곧
-- 이 제조소의 규칙이 된다. 다른 제조소는 멸균을 여러 배치 묶어 보내거나 따로
-- 번호를 매길 수 있고, 그러면 코드를 고쳐야 한다 - §2.0 이 막으려는 것이다.
--
-- 토큰으로 낸다. DOF 는 패턴을 `{BATCH}` 하나로 두면 배치번호가 그대로 서고,
-- 다른 제조소는 `ST-{YY}{MM}-{SEQ:3}` 처럼 자기 형식을 쓰면 된다. 섞고 싶으면
-- `{BATCH}-{SEQ:2}` 도 된다.
--
-- ── 한 배치에 한 번이라는 규칙은 표가 지킨다 ─────────────────────────────
-- 패턴을 `{BATCH}` 로 두면 같은 생산 배치로 멸균을 두 번 만들 때 같은 번호가
-- 나오고, `steril_batch.batch_no` 의 고유 제약이 그것을 막는다. **새 차단을
-- 만들지 않고 이미 있는 제약이 규칙이 된다.**
--
-- 재멸균처럼 두 번 보낼 일이 생기면 그때 패턴에 `-{SEQ:1}` 을 붙이면 된다.
-- 코드는 그대로다.
--
-- ── 인자가 늘어 옛 것과 겹친다 ───────────────────────────────────────────
-- 셋 다 옛 이름을 내리고 새로 세운다. 기본값 있는 인자를 더하면 옛 서명과
-- 겹쳐 호출이 모호해진다 (0086 · 0097 과 같은 이유).
-- ---------------------------------------------------------------------------

drop function if exists preview_number(text, int, int, text);
drop function if exists next_number(numbering_target, uuid, date);
drop function if exists render_number(text, int, int, timestamp, text);

create or replace function render_number(
  p_pattern   text,
  p_seq_width int,
  p_seq       int,
  p_at        timestamp,
  p_item_code text default null,
  p_batch     text default null
) returns text language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select regexp_replace(
           replace(replace(replace(replace(replace(replace(replace(
             p_pattern,
             '{YYYY}',  to_char(p_at, 'YYYY')),
             '{YY}',    to_char(p_at, 'YY')),
             '{MM}',    to_char(p_at, 'MM')),
             '{DD}',    to_char(p_at, 'DD')),
             '{ITEM}',  coalesce(p_item_code, '{ITEM}')),
             '{MODEL}', coalesce(model_suffix(p_item_code),
                                 /* 체계가 없거나 맞지 않으면 옛 셈을 그대로 */
                                 right(p_item_code, 8), '{MODEL}')),
             '{BATCH}', coalesce(p_batch, '{BATCH}')),
           '\{SEQ:(\d+)\}', lpad(p_seq::text, p_seq_width, '0'), 'g')
$fn$;

comment on function render_number(text, int, int, timestamp, text, text) is
  '채번 형식을 값으로 바꾼다. {MODEL} 은 형명 체계에서 접두어를 뗀 부분, {BATCH} 는 생산 배치번호';

create or replace function preview_number(
  p_pattern   text,
  p_seq_width int,
  p_seq       int  default 1,
  p_item_code text default null
) returns text language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  /* 미리보기는 배치를 모른다. 토큰이 그대로 보이는 것이 맞다 - 실제로는
     그 자리에 배치번호가 들어간다는 뜻이 화면에 드러난다 */
  select render_number(p_pattern, p_seq_width, p_seq,
                       timezone('Asia/Seoul', now()), p_item_code, null)
$fn$;

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
  v_type item_type;
  v_code text;
  ck     text;
  v_base int;
  n      int;
begin
  /*
   * 품목 종류. item 표가 없는 설치(M0)에서는 종류별 규칙이 성립하지 않으므로
   * 조용히 건너뛴다 - 그때는 공통 규칙만 남는다.
   */
  if p_item is not null and to_regclass('public.item') is not null then
    execute 'select type from item where id = $1' into v_type using p_item;
  end if;

  /* 좁은 것이 먼저다 - 품목별 > 종류별 > 공통 */
  select * into r from numbering_rule
   where target = p_target and is_active
     and (item_id = p_item
          or (item_id is null and item_type is null)
          or (item_id is null and item_type = v_type))
   order by (item_id is null), (item_type is null)
   limit 1
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

comment on function next_number(numbering_target, uuid, date, text) is
  '채번. 규칙은 품목별 > 종류별 > 공통 차례로 고른다. 날짜와 배치번호를 주면 패턴에 쓴다';

revoke all on function next_number(numbering_target, uuid, date, text) from public;
grant execute on function next_number(numbering_target, uuid, date, text) to app_role;
grant execute on function render_number(text, int, int, timestamp, text, text) to app_role;
grant execute on function preview_number(text, int, int, text) to app_role;
