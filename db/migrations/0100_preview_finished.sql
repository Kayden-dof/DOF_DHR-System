-- ---------------------------------------------------------------------------
-- 완제품 형명을 만들기 전에 보여 준다 (사용자 지적 2026-09-07)
--
-- 형명 생성 화면이 `크기 (가로2+세로2)` · `두께 구간 (하한2+상한2)` ·
-- `제외 조합 (8자리)` 라고 적고 있었다. **DX2401 의 모양이지 프로그램의
-- 성질이 아니다** - 자리 수와 이름은 형명 체계가 정하는데(0075) 화면만 옛
-- 모양으로 굳어 있었다. 다른 품목을 올리는 사람은 화면이 시키는 대로 넣다가
-- 틀린 형명을 만든다.
--
-- 화면을 체계에서 짓게 하려면 **만들기 전에 무엇이 나오는지** 물어볼 자리가
-- 있어야 한다. 그 자리를 낸다.
--
-- ── 왜 화면이 스스로 조합하지 않는가 ────────────────────────────────────
-- 크기 목록과 구간 목록을 곱하는 것은 자바스크립트로도 두 줄이다. 그런데
-- **자리 수 검사와 이름 짓기가 함께 붙어 있다** - 그것을 화면이 다시 쓰면
-- 같은 셈이 두 곳에 생기고, §10 이 적은 대로 복제는 갈라진다. 규격 문구가
-- 실제로 그렇게 갈라져 라벨 업체에 10배 작은 치수가 나간 적이 있다.
--
-- 그래서 `preview_finished_items()` 를 내고, **`generate_finished_items()` 가
-- 그것을 나눠 쓰게** 한다. 미리보기와 실제 생성이 같은 한 곳에서 나온다.
--
-- 미리보기는 아무것도 만들지 않는다. 이미 있는 형명은 `already` 로 표시해
-- 무엇이 새로 생기는지 화면이 말할 수 있게 한다.
-- ---------------------------------------------------------------------------

create or replace function preview_finished_items(
  p_sizes       text[],
  p_bands       text[],
  p_exclude     text[] default '{}',
  p_name_prefix text   default null,
  p_scheme      uuid   default null)
returns table (item_code text, item_name text, spec text,
               size_part text, band_part text, already boolean)
language plpgsql stable
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  sc record; s text; b text; suffix text; v_code text; v_name text;
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
    select count(*) into n from model_scheme where is_active;
    if n = 0 then
      raise exception '형명 체계가 정의되지 않았습니다. 설정에서 먼저 등록하십시오';
    end if;
    if n > 1 then
      raise exception '활성 형명 체계가 %개입니다. 어느 체계로 만들지 고르십시오', n;
    end if;
    select * into sc from model_scheme where is_active;
  end if;

  /* 앞쪽 자리(크기)와 뒤쪽 자리(구간)가 각각 몇 글자인지 체계에서 읽는다 */
  select coalesce(sum(digits) filter (where role is distinct from 'BAND'), 0),
         coalesce(sum(digits) filter (where role = 'BAND'), 0)
    into head, tail
    from model_segment where scheme_id = sc.id;

  if head = 0 or tail = 0 then
    raise exception '체계에 크기 자리 또는 구간 자리가 없습니다';
  end if;

  foreach s in array p_sizes loop
    if s !~ ('^[0-9]{' || head || '}$') then
      raise exception '크기는 숫자 %자리여야 합니다: %', head, s;
    end if;
    foreach b in array p_bands loop
      if b !~ ('^[0-9]{' || tail || '}$') then
        raise exception '구간은 숫자 %자리여야 합니다: %', tail, b;
      end if;

      suffix := s || b;
      continue when suffix = any (p_exclude);

      v_code := sc.prefix || suffix;

      /* 이름도 체계의 틀에서 나온다. 자리 값은 규격 문구와 같은 셈을 쓴다 */
      v_name := replace(sc.name_pattern, '{P}', p_name_prefix);
      for p in select * from model_parts(v_code) loop
        v_name := replace(v_name, '{' || p.seq || '}', p.shown);
      end loop;

      item_code := v_code;
      item_name := v_name;
      spec      := spec_label(v_code);
      size_part := s;
      band_part := b;
      already   := exists (select 1 from item i where i.code = v_code);
      return next;
    end loop;
  end loop;
end $fn$;

comment on function preview_finished_items(text[], text[], text[], text, uuid) is
  '만들어질 완제품 형명을 미리 보여 준다. 아무것도 만들지 않는다. generate_finished_items 와 같은 셈을 쓴다';


-- === 생성기가 미리보기를 나눠 쓴다 =========================================
/*
 * 조합·검사·이름 짓기를 위에서 한 번만 한다. 여기 남는 것은 넣는 일뿐이다.
 * 두 곳이 각자 조합하면 언젠가 갈라지고, 그때 화면이 보여 준 것과 실제로
 * 만들어진 것이 달라진다 - 사람은 화면을 믿는다.
 */
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
declare r record;
begin
  for r in
    select * from preview_finished_items(p_sizes, p_bands, p_exclude,
                                         p_name_prefix, p_scheme)
  loop
    insert into item (code, name, type, purchase_uom, usage_uom,
                      shelf_life_months, is_active)
    values (r.item_code, r.item_name, 'FIN', 'EA', 'EA', p_shelf_months, true)
    on conflict (code) do nothing;

    item_code := r.item_code;
    item_name := r.item_name;
    was_created := found;
    return next;
  end loop;
end $fn$;

/* 아무것도 만들지 않으므로 열람 역할도 부를 수 있다. 화면이 읽기 경로로 부른다 */
grant execute on function preview_finished_items(text[], text[], text[], text, uuid)
  to app_role, app_readonly;
