-- ---------------------------------------------------------------------------
-- 채번이 품목 종류와 날짜를 받는다 (사용자 결정 2026-09-07)
--
-- 사내에서 정한 번호 체계를 받아 보니 지금 채번 엔진으로 두 자리가 표현되지
-- 않았다.
--
--   자재 로트   R{YYMMDD}-{일련}   원자재
--               P{YYMMDD}-{일련}   포장재
--               M{YYMMDD}-{일련}   시약 · 소모품
--               날짜는 **합격판정일자**다
--   배치        B{YYMMDD}-{일련}   날짜는 배치생산시작일자 (= 작업지시일)
--   완제품 로트 GM-{YYMMDD}{일련}  날짜는 제조일
--
-- ── ① 접두어가 품목 종류에 따라 갈린다 ──────────────────────────────────
-- 규칙은 **공통** 아니면 **품목별** 둘뿐이었다. 원자재 R, 포장재 P 로 가르려면
-- 품목마다 규칙을 만들어야 하고 그러면 규칙이 품목 수만큼 생긴다.
--
-- `item_type` 을 받는 자리를 낸다. 고르는 차례는 **품목별 > 종류별 > 공통**.
-- 좁은 것이 먼저다 - 한 품목만 다르게 매기고 싶을 때 그 길이 남아 있어야 한다.
--
-- ── ② 날짜가 채번하는 순간이 아니다 ─────────────────────────────────────
-- `next_number()` 는 언제나 `now()` 를 썼다. 그런데 자재 로트번호의 날짜는
-- **합격판정일자**이고, 그 판정은 품질팀이 서면으로 받아 옮겨 적는 값이라
-- 입력하는 순간과 다르다. 제조번호의 날짜도 제조일이지 재단을 입력한 날이
-- 아니다.
--
-- 날짜를 인자로 받는다. 안 주면 지금까지처럼 오늘이다. **주기 키도 같은
-- 날짜로 잡는다** - 그래야 "그날의 몇 번째" 가 맞는다. 합격판정일이 사흘 전인
-- 로트를 오늘 등록해도 그날 순번을 이어받는다.
--
-- `render_number()` 는 이미 날짜를 받게 되어 있었다 (0075). 여기서는 그것을
-- 흘려주기만 한다.
--
-- 판정하지 않는다 (§1). 무엇이 합격인지 시스템이 정하지 않고, 서면 판정의
-- **날짜를 옮겨 적어 번호에 쓸 뿐이다.**
-- ---------------------------------------------------------------------------

-- === ① 품목 종류별 규칙 ====================================================

alter table numbering_rule add column if not exists item_type item_type;

comment on column numbering_rule.item_type is
  '품목 종류별 규칙. null 이면 종류를 가리지 않는다. item_id 와 함께 쓸 수 없다';

/* 품목별과 종류별을 동시에 지정하면 어느 쪽인지 말할 수 없다 */
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'numbering_rule_scope') then
    alter table numbering_rule add constraint numbering_rule_scope
      check (item_id is null or item_type is null);
  end if;
end $$;

/*
 * 활성 규칙은 (대상, 품목, 종류)당 하나다. 전에는 (대상, 품목)이었다.
 * 새 색인은 옛 것보다 넓으므로 이미 있는 자료는 그대로 통과한다.
 *
 * 옛 색인은 null 을 0 uuid 로 바꿔 넣었다 - 고유 색인이 null 을 서로 다른
 * 값으로 보기 때문이다. 종류까지 넣으면서 같은 수를 쓰려다 막혔다:
 * `item_type::text` 는 IMMUTABLE 이 아니라 색인 식에 못 들어간다.
 *
 * `nulls not distinct` 로 간다 (PostgreSQL 15+). 운영도 로컬도 17.6 이다.
 * 식이 없어져서 옛 방식보다 읽기도 낫다.
 */
drop index if exists numbering_rule_active_uniq;
create unique index if not exists numbering_rule_active_uniq
  on numbering_rule (target, item_id, item_type) nulls not distinct
  where is_active;

/*
 * 규칙은 고쳐 쓰지 않는다 (§4.10). 새로 생긴 열도 같은 자물쇠 안에 넣는다.
 *
 * 이 함수는 0004 의 것을 **통째로 옮겨 적고** item_type 한 줄만 더한 것이다.
 * 처음에는 앞부분만 베껴 와서 아래 "다시 활성화할 수 없습니다" 조항을
 * 잘라먹었고, N-17 이 그것을 잡았다 (2026-09-07). §10 의 "복제는 갈라진다" 가
 * 함수 본문에도 그대로 적용된다 - 옮겨 적을 때는 끝까지 옮긴다.
 */
create or replace function trg_rule_immutable()
returns trigger language plpgsql as $fn$
begin
  if new.target         is distinct from old.target
  or new.item_id        is distinct from old.item_id
  or new.item_type      is distinct from old.item_type
  or new.pattern        is distinct from old.pattern
  or new.reset          is distinct from old.reset
  or new.seq_width      is distinct from old.seq_width
  or new.effective_from is distinct from old.effective_from
  or new.registered_by  is distinct from old.registered_by
  or new.registered_at  is distinct from old.registered_at then
    raise exception '채번 규칙은 수정할 수 없습니다. is_active를 내리고 새 규칙을 등록하십시오';
  end if;
  if old.is_active = false and new.is_active = true then
    raise exception '내린 채번 규칙은 다시 활성화할 수 없습니다. 새 규칙을 등록하십시오';
  end if;
  return new;
end $fn$;


-- === ② 날짜를 받는 채번 ====================================================

/* 인자가 늘어 옛 것과 겹치므로 먼저 내린다 (0086 과 같은 이유) */
drop function if exists next_number(numbering_target, uuid);

create or replace function next_number(
  p_target numbering_target,
  p_item   uuid default null,
  p_at     date default null)
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

  return render_number(r.pattern, r.seq_width, n, v_now, v_code);
end $fn$;

comment on function next_number(numbering_target, uuid, date) is
  '채번. 규칙은 품목별 > 종류별 > 공통 차례로 고른다. 날짜를 주면 패턴과 주기 키에 그 날짜를 쓴다';

revoke all on function next_number(numbering_target, uuid, date) from public;
grant execute on function next_number(numbering_target, uuid, date) to app_role;


-- === ③ 합격판정일자 ========================================================
/*
 * 자재 로트번호의 날짜가 이 값이다. 품질팀이 서면 합격 판정 서류를 받고
 * 옮겨 적는다 (사용자 결정 2026-09-07).
 *
 * 시스템이 판정하지 않는다 (§1). 무엇이 합격인지 정하지 않고 **서면 판정이
 * 있었다는 사실과 그 날짜**만 받는다. 특채 기록지 문서번호나 멸균 성적서
 * 번호를 옮겨 적는 것과 같은 성격이다.
 *
 * 옛 로트에는 없으므로 null 을 허용한다. 새로 등록하는 자리에서 화면이
 * 받는다 - 표에 not null 을 걸면 이관이 옛 자료에서 멈춘다.
 */
alter table material_lot add column if not exists qc_passed_on date;

comment on column material_lot.qc_passed_on is
  '합격판정일자. 서면 판정 서류의 날짜를 옮겨 적는다. 로트번호가 이 날짜로 만들어진다';

-- === ④ 제조번호의 날짜는 제조일이다 ========================================
/*
 * 완제품 로트번호가 `GM-{YYMMDD}{일련}` 이고 그 날짜는 **생산일**이다. 그런데
 * cut_product_lot 은 제조일(v_on)을 이미 손에 쥐고도 채번에는 넘기지 않아,
 * 재단을 나중에 소급 입력하면 번호에 입력한 날이 박혔다.
 *
 * 아래는 **DB 에 서 있던 정의를 그대로 떠 온 것**이고 바뀐 곳은 한 줄뿐이다
 * (next_number 에 v_on 을 넘긴다). 파일에서 베끼지 않은 까닭은 같은 이관에서
 * trg_rule_immutable 을 옮겨 적다 조항을 잘라먹었기 때문이다 - 옮겨 적을
 * 때는 지금 실제로 도는 것을 떠 온다.
 */
create or replace function cut_product_lot(
  p_work_order uuid,
  p_item       uuid,
  p_produced   int,
  p_sample     int,
  p_on         date default null)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_on      date := coalesce(p_on, (timezone('Asia/Seoul', now()))::date);
  v_lot_no  text;
  v_months  int;
  v_ref     uuid;
  v_id      uuid;
  v_actor   uuid := current_user_id();
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;

  select months, ref_id into v_months, v_ref from shelf_life_at(p_item, v_on);

  /* 제조일로 채번한다. 소급 입력해도 번호의 날짜가 제조일과 같다 (0097) */
  v_lot_no := next_number('PRODUCT_LOT', p_item, v_on);

  insert into product_lot (
    work_order_id, lot_no, item_id, qty_produced, qty_sample, qty_available,
    manufactured_on, expiry_date, shelf_life_ref, registered_by)
  values (
    p_work_order, v_lot_no, p_item, p_produced, p_sample, p_produced - p_sample,
    v_on, (v_on + make_interval(months => v_months))::date, v_ref, v_actor)
  returning id into v_id;

  update work_order set status = 'CUT'
   where id = p_work_order and status in ('ISSUED','IN_PROCESS');

  return v_id;
end $fn$;
