-- ---------------------------------------------------------------------------
-- 형명 체계를 설정으로 (M5-4 · §2.0)
--
-- 형명 `PD + 가로2 + 세로2 + 두께하한2 + 두께상한2` 가 코드 일곱 자리에 박혀
-- 있었다. spec_label · item_area_cm2 · generate_finished_items · 채번의
-- {MODEL} 토큰 · 두께 구간 고르기 · 품목 등록 안내 문구.
--
-- 다른 제조소는 형명 규칙이 다르다. 접두어가 없을 수도 있고, 자리 수도 뜻도
-- 다르다. 그 규칙이 코드에 있으면 §2.0 의 판단 기준("다른 제조소가 이
-- 프로그램을 그대로 받아 쓸 수 있는가")에서 걸린다.
--
-- ── 왜 위험한가 ───────────────────────────────────────────────────────────
-- 이 값이 라벨요청서에 실려 라벨 업체로 가고, 출하 승인 요청서에 실려
-- 품질책임자 서명 위에 놓인다. 한 번 틀리면 10배 틀린 치수가 종이로 나가고,
-- 붙은 라벨은 회수 말고 되돌릴 방법이 없다 (0057).
--
-- 그래서 갈아 끼우기 전에 안전망을 놓았다. test/cases/12_model_scheme.mjs 가
-- 사양의 규칙을 SQL 과 무관하게 JS 로 다시 셈해 전건 대조하고,
-- test/mutation.mjs 의 M-SPEC · M-AREA 가 그 시험이 실제로 잡는지 확인한다.
--
-- ── 무엇을 담는가 ─────────────────────────────────────────────────────────
--   model_scheme    접두어 · 규격 문구 틀 · 이름 틀
--   model_segment   자리마다 몇 글자인가, 몇으로 나누는가, 소수 몇 자리인가
--
-- DX2401 을 그대로 옮겨 심는다. 옮긴 뒤 62종 전건이 같은 문구를 내야 한다.
-- ---------------------------------------------------------------------------

create table if not exists model_scheme (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  -- 형명 앞에 붙는 글자. 없는 제조소도 있으므로 빈 글을 허용한다
  prefix        text not null default '',
  -- 규격 문구 틀. {1} {2} ... 가 자리 순서다.  '{1}x{2}cm · 두께 {3}~{4}mm'
  spec_pattern  text not null,
  -- 품목 이름 틀. {P} 는 generate_finished_items 가 받는 제품 이름이다
  name_pattern  text not null,
  is_active     boolean not null default true,
  -- 이관이 옮겨 심은 줄에는 사람이 없다. 화면에서 넣은 것만 사람이 있다
  registered_by uuid references app_user(id),
  registered_at timestamptz not null default now(),
  check (prefix ~ '^[A-Za-z0-9-]*$'),
  check (spec_pattern <> ''),
  check (name_pattern <> '')
);

-- 접두어가 같은 체계가 둘이면 어느 것으로 읽을지 알 수 없다
create unique index if not exists model_scheme_prefix_active
  on model_scheme (prefix) where is_active;

create table if not exists model_segment (
  scheme_id uuid not null references model_scheme(id),
  seq       int  not null check (seq between 1 and 8),
  digits    int  not null check (digits between 1 and 4),
  -- 자리의 숫자를 몇으로 나누는가. 1 이면 그대로, 10 이면 05 가 0.5 가 된다
  divisor   numeric not null default 1 check (divisor > 0),
  decimals  int  not null default 0 check (decimals between 0 and 3),
  label     text not null,
  -- 이 자리가 무엇인가. 넓이와 두께 구간을 셈하는 데 쓴다
  role      text check (role in ('WIDTH', 'HEIGHT', 'BAND')),
  primary key (scheme_id, seq)
);

grant select on model_scheme, model_segment to app_role, app_readonly;
grant insert, update on model_scheme, model_segment to app_role;
revoke delete on model_scheme, model_segment from app_role;


-- === 자리를 읽는다 =========================================================
/*
 * 형명 하나를 자리별 값으로 가른다. 맞는 체계가 없으면 빈 결과다.
 *
 * search_path 를 박는다. 이 함수가 보는 표를 호출자가 임시 표로 바꿔치기할
 * 수 있으면 종이에 찍히는 치수가 바뀐다 (§10).
 */
create or replace function model_parts(p_code text)
returns table (seq int, raw text, value numeric, shown text, role text)
language plpgsql stable
set search_path = pg_catalog, public, pg_temp as $fn$
declare sc record; seg record; pos int; total int;
begin
  if p_code is null then return; end if;

  for sc in select * from model_scheme where is_active order by length(prefix) desc loop
    select coalesce(sum(s.digits), 0) into total
      from model_segment s where s.scheme_id = sc.id;
    continue when total = 0;

    -- 접두어는 글자 그대로 견준다. 정규식 특수문자가 섞여도 뜻이 변하지 않게
    continue when left(p_code, length(sc.prefix)) <> sc.prefix;
    continue when substr(p_code, length(sc.prefix) + 1) !~ ('^[0-9]{' || total || '}$');

    pos := length(sc.prefix) + 1;
    for seg in select * from model_segment s where s.scheme_id = sc.id order by s.seq loop
      seq   := seg.seq;
      raw   := substr(p_code, pos, seg.digits);
      /* trim_scale 로 꼬리 0 을 뗀다. 나눗셈은 눈금을 크게 잡아
         25 가 25.00000000000000000000 으로 나온다 */
      value := trim_scale(raw::numeric / seg.divisor);
      shown := trim(to_char(value,
                 case when seg.decimals = 0 then 'FM9999999990'
                      else 'FM9999999990.' || repeat('0', seg.decimals) end));
      role  := seg.role;
      pos   := pos + seg.digits;
      return next;
    end loop;
    return;
  end loop;
end $fn$;

comment on function model_parts(text) is
  '형명을 자리별 값으로 가른다. 맞는 체계가 없으면 빈 결과';


-- === 규격 문구 =============================================================
/*
 * 종이와 화면이 이 하나만 쓴다 (§7). 인쇄 페이지가 각자 환산하면 갈라지고,
 * 한때 실제로 갈라져 10배 작은 치수가 라벨 업체로 나갔다 (0057).
 */
create or replace function spec_label(p_code text) returns text
language plpgsql stable
set search_path = pg_catalog, public, pg_temp as $fn$
declare sc record; p record; out_ text;
begin
  select s.spec_pattern into out_
    from model_scheme s
   where s.is_active
     and left(p_code, length(s.prefix)) = s.prefix
     and exists (select 1 from model_parts(p_code))
   order by length(s.prefix) desc limit 1;

  if out_ is null then return ''; end if;

  for p in select * from model_parts(p_code) loop
    out_ := replace(out_, '{' || p.seq || '}', p.shown);
  end loop;
  return out_;
end $fn$;

comment on function spec_label(text) is
  '형명을 사람이 읽는 규격으로. 인쇄물과 화면이 이 하나만 쓴다 (체계는 model_scheme)';


-- === 넓이 =================================================================
/*
 * 배치가 함께 쓴 자재 값을 제품 로트에 나눌 때 쓴다 (0066). WIDTH · HEIGHT
 * 자리가 없는 체계에서는 null 이고, 그때 0066 은 넓이 배분을 하지 않는다.
 */
create or replace function item_area_cm2(p_code text) returns numeric
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select case
    when count(*) filter (where role in ('WIDTH', 'HEIGHT')) = 2
      then trim_scale((max(value) filter (where role = 'WIDTH'))
                    * (max(value) filter (where role = 'HEIGHT')))
  end
  from model_parts(p_code)
$fn$;

comment on function item_area_cm2(text) is
  '형명에서 넓이(cm2). WIDTH · HEIGHT 자리가 있는 체계에서만 값이 나온다';


-- === 두께 구간 · 접두어를 뗀 뒷자리 ========================================
/*
 * 원재료 로트의 thickness_band 와 견주는 값이다. 화면이 code.slice(-4) 로
 * 잘라 쓰던 것을 여기로 옮긴다 - 자리 수가 바뀌면 그 화면만 조용히 틀린다.
 */
create or replace function model_band(p_code text) returns text
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select nullif(string_agg(raw, '' order by seq) filter (where role = 'BAND'), '')
    from model_parts(p_code)
$fn$;

comment on function model_band(text) is
  '형명의 두께 구간 자리. 원재료 로트의 thickness_band 와 견준다';

/* 채번의 {MODEL} 토큰. 전에는 right(code, 8) 로 여덟 자리를 못박고 있었다 */
create or replace function model_suffix(p_code text) returns text
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select nullif(string_agg(raw, '' order by seq), '') from model_parts(p_code)
$fn$;

comment on function model_suffix(text) is
  '형명에서 접두어를 뗀 숫자 부분. 채번의 {MODEL} 토큰이 쓴다';


-- === 이름 만들기 ===========================================================
/*
 * §4.2 가 "62개를 손으로 등록하지 말 것" 이라고 못박은 자리다. 크기 목록과
 * 두께 목록을 곱해 만들되, 자리 수는 체계가 정한다.
 */
create or replace function generate_finished_items(
  p_sizes          text[],
  p_bands          text[],
  p_exclude        text[] default '{}',
  p_name_prefix    text   default 'DX2401',
  p_shelf_months   int    default 12
) returns table (item_code text, item_name text, was_created boolean)
language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  sc record; s text; b text; suffix text; v_code text; v_name text; v_new boolean;
  head int; tail int; p record;
begin
  select * into sc from model_scheme where is_active order by registered_at limit 1;
  if not found then
    raise exception '형명 체계가 정의되지 않았습니다. 설정에서 먼저 등록하십시오';
  end if;

  /* 앞쪽 자리(크기)와 뒤쪽 자리(두께)가 각각 몇 글자인지 체계에서 읽는다 */
  select coalesce(sum(digits) filter (where role is distinct from 'BAND'), 0),
         coalesce(sum(digits) filter (where role = 'BAND'), 0)
    into head, tail
    from model_segment where scheme_id = sc.id;

  if head = 0 or tail = 0 then
    raise exception '체계에 크기 자리 또는 두께 자리가 없습니다';
  end if;

  foreach s in array p_sizes loop
    if s !~ ('^[0-9]{' || head || '}$') then
      raise exception '크기는 숫자 %자리여야 합니다: %', head, s;
    end if;
    foreach b in array p_bands loop
      if b !~ ('^[0-9]{' || tail || '}$') then
        raise exception '두께 구간은 숫자 %자리여야 합니다: %', tail, b;
      end if;

      suffix := s || b;
      continue when suffix = any (p_exclude);

      v_code := sc.prefix || suffix;

      /* 이름도 체계의 틀에서 나온다. 자리 값은 규격 문구와 같은 셈을 쓴다 */
      v_name := replace(sc.name_pattern, '{P}', p_name_prefix);
      for p in select * from model_parts(v_code) loop
        v_name := replace(v_name, '{' || p.seq || '}', p.shown);
      end loop;

      insert into item (code, name, type, purchase_uom, usage_uom,
                        shelf_life_months, is_active)
      values (v_code, v_name, 'FIN', 'EA', 'EA', p_shelf_months, true)
      on conflict (code) do nothing;

      v_new := found;
      item_code := v_code; item_name := v_name; was_created := v_new;
      return next;
    end loop;
  end loop;
end $fn$;


-- === 이미 쓰고 있던 체계만 옮겨 심는다 =====================================
/*
 * 지금 코드에 박혀 있던 규칙을 값으로 옮긴다. 옮긴 뒤 등록된 형명 전건이
 * 같은 문구를 내야 하고, 12_model_scheme.mjs 가 그것을 확인한다.
 *
 * ── 빈 설치에는 심지 않는다 ──────────────────────────────────────────────
 * 조건을 "PD 형명이 이미 있는가" 로 둔다. 처음 받는 제조소에 DOF 의 체계를
 * 심어 주면, 자기 로고 옆에 남의 회사 형명 규칙이 깔린 채로 시작한다 - §2.0
 * 이 막으려는 바로 그것이다.
 *
 * 체계가 없으면 spec_label 은 빈 글을 내고 generate_finished_items 는 거부한다.
 * 그게 맞다 - 무엇이 형명인지 아직 아무도 말하지 않았다. 첫 설정 차례표가
 * 그것을 짚는다.
 */
do $$
declare v_id uuid;
begin
  if exists (select 1 from model_scheme) then return; end if;
  if not exists (select 1 from item where code ~ '^PD[0-9]{8}$') then return; end if;

  insert into model_scheme (name, prefix, spec_pattern, name_pattern)
  values ('이종 진피 완제품', 'PD',
          '{1}x{2}cm · 두께 {3}~{4}mm',
          '{P} {1}x{2}cm {3}~{4}mm')
  returning id into v_id;

  insert into model_segment (scheme_id, seq, digits, divisor, decimals, label, role) values
    (v_id, 1, 2,  1, 0, '가로 (cm)',      'WIDTH'),
    (v_id, 2, 2,  1, 0, '세로 (cm)',      'HEIGHT'),
    (v_id, 3, 2, 10, 1, '두께 하한 (mm)', 'BAND'),
    (v_id, 4, 2, 10, 1, '두께 상한 (mm)', 'BAND');

  raise notice '형명 체계를 설정으로 옮겼습니다 (PD + 가로2 + 세로2 + 두께2 + 두께2)';
end $$;


-- === 채번의 {MODEL} 토큰도 체계를 읽는다 ===================================
/*
 * 0004 는 right(p_item_code, 8) 로 여덟 자리를 못박고 있었다. 자리 수가 다른
 * 제조소에서는 형명이 잘리거나 접두어가 섞여 들어간다.
 *
 * immutable 을 stable 로 낮춘다 - 표를 읽으므로 immutable 이 거짓말이 된다.
 * 그러면 이 함수를 색인에 쓸 수 없는데, 쓰는 곳이 없다 (채번과 미리보기뿐).
 */
create or replace function render_number(
  p_pattern   text,
  p_seq_width int,
  p_seq       int,
  p_at        timestamp,
  p_item_code text default null
) returns text language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select regexp_replace(
           replace(replace(replace(replace(replace(replace(
             p_pattern,
             '{YYYY}',  to_char(p_at, 'YYYY')),
             '{YY}',    to_char(p_at, 'YY')),
             '{MM}',    to_char(p_at, 'MM')),
             '{DD}',    to_char(p_at, 'DD')),
             '{ITEM}',  coalesce(p_item_code, '{ITEM}')),
             '{MODEL}', coalesce(model_suffix(p_item_code),
                                 /* 체계가 없거나 맞지 않으면 옛 셈을 그대로 */
                                 right(p_item_code, 8), '{MODEL}')),
           '\{SEQ:(\d+)\}', lpad(p_seq::text, p_seq_width, '0'), 'g')
$fn$;

comment on function render_number(text, int, int, timestamp, text) is
  '채번 형식을 값으로 바꾼다. {MODEL} 은 형명 체계에서 접두어를 뗀 부분';
