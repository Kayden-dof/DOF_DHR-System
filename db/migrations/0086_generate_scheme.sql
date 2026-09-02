-- ---------------------------------------------------------------------------
-- 완제품 생성기가 형명 체계를 고르게 한다 (5차 감사 B2 · B4)
--
-- 0075 가 형명 규칙을 표로 옮겼다. 그런데 생성기는 이렇게 골랐다.
--
--     select * into sc from model_scheme where is_active
--       order by registered_at limit 1;      -- 가장 먼저 등록한 것
--
-- 화면은 체계를 여러 개 등록하게 해 두었다 - 활성 유일 제약이 `prefix` 별이라
-- 서로 다른 접두어는 함께 활성이다. 그런데 생성기는 가장 오래된 것 하나만
-- 쓴다. **두 번째 제품군을 올리면 형명이 첫 체계의 접두어로 만들어진다.**
--
-- `spec_label` 은 같은 표를 접두어로 골라 맞게 읽는다
-- (order by length(prefix) desc). 같은 표를 두 함수가 다르게 읽고 있었다.
--
-- ── 무엇을 바꾸는가 ────────────────────────────────────────────────────
--   ① 어느 체계로 만들지 인자로 받는다 (`p_scheme`)
--   ② 안 주면 활성 체계가 **하나일 때만** 그것을 쓴다. 둘 이상이면 거절한다.
--      조용히 하나를 고르는 것이 이 결함의 뿌리였다
--   ③ 이름 앞머리의 기본값 'DX2401' 을 없앤다. 이 제조소의 품목 코드이지
--      프로그램의 성질이 아니다 (§2.0)
--
-- 판정하지 않는다. 무엇이 옳은 형명인지 정하지 않고, **무엇으로 만들지
-- 정해지지 않았을 때 지어내지 않을 뿐이다.**
-- ---------------------------------------------------------------------------

/* 인자가 늘어 이름이 겹치지 않으므로 옛 것을 먼저 내린다 */
drop function if exists generate_finished_items(text[], text[], text[], text, int);

create or replace function generate_finished_items(
  p_sizes        text[],
  p_bands        text[],
  p_exclude      text[] default '{}',
  p_name_prefix  text   default null,
  p_shelf_months int    default 12,
  p_scheme       uuid   default null)
returns table (item_code text, item_name text, was_created boolean)
language plpgsql
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  sc record; s text; b text; suffix text; v_code text; v_name text; v_new boolean;
  head int; tail int; p record; n int;
begin
  if coalesce(btrim(p_name_prefix), '') = '' then
    raise exception '이름 앞머리를 적으십시오. 완제품 이름의 앞에 붙습니다';
  end if;

  if p_scheme is not null then
    select * into sc from model_scheme where id = p_scheme;
    if not found then
      raise exception '형명 체계를 찾을 수 없습니다';
    end if;
    if not sc.is_active then
      raise exception '내려 둔 형명 체계로는 만들지 않습니다 (%)', sc.name;
    end if;
  else
    /*
     * 고르지 않았으면 활성 체계가 하나일 때만 그것을 쓴다. 둘 이상일 때
     * 조용히 하나를 고르는 것이 이 결함이었다.
     */
    select count(*) into n from model_scheme where is_active;
    if n = 0 then
      raise exception '형명 체계가 정의되지 않았습니다. 설정에서 먼저 등록하십시오';
    end if;
    if n > 1 then
      raise exception '활성 형명 체계가 %개입니다. 어느 체계로 만들지 고르십시오', n;
    end if;
    select * into sc from model_scheme where is_active;
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

revoke execute on function
  generate_finished_items(text[], text[], text[], text, int, uuid) from public;
grant execute on function
  generate_finished_items(text[], text[], text[], text, int, uuid) to app_role;

comment on function generate_finished_items(text[], text[], text[], text, int, uuid) is
  '완제품 형명을 조합으로 만든다. 어느 체계로 만들지 고르지 않으면 활성 체계가 '
  '하나일 때만 돈다 - 조용히 하나를 고르지 않는다 (5차 감사 B2)';
