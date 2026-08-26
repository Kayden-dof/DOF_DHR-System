-- =============================================================================
-- 0007_m1_item.sql  ·  품목
-- 근거: CLAUDE.md §4.2
-- 범위: M1
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'item_type') then
    create type item_type as enum ('RAW','REAGENT','PROCESS','PACK','FIN');
  end if;
end $$;

create table if not exists item (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,       -- RM-006, PM-002, PD05050510 등
  name            text not null,
  type            item_type not null,
  purchase_uom    text not null,
  usage_uom       text not null,
  conversion      numeric not null default 1 check (conversion > 0),
  min_stock       numeric,
  min_stock_auto  numeric,                    -- 자동 제안값. 덮어쓰지 않는다
  min_stock_basis text,                       -- 산출 근거 문구
  lead_days       int,
  default_supplier_id uuid,                   -- FK는 0008에서 붙인다
  shelf_life_months int,                      -- 완제품용. 기본 12
  is_active       boolean not null default true
);
create index if not exists item_type_active_idx on item (type, is_active);

-- 채번 규칙의 품목 FK. M0에서 item 표가 없어 미뤄 뒀던 것을 여기서 복구한다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'numbering_rule_item_id_fkey'
  ) then
    alter table numbering_rule
      add constraint numbering_rule_item_id_fkey
      foreign key (item_id) references item(id);
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 완제품 형명 생성 (§4.2)
--
--   "완제품 62종도 item이다. 모델명이 PD + 가로2 + 세로2 + 두께하한2 + 두께상한2
--    규칙이므로 코드로 생성한다. 62개를 손으로 등록하지 말 것."
--
-- 크기 목록과 두께 구간은 제품표준서에서 오는 값이라 여기에 박지 않는다.
-- 관리 화면에서 입력받아 이 함수에 넘긴다. 손으로 62줄을 치는 것과
-- 규칙으로 생성하는 것의 차이가 요점이지, 값을 코드에 박는 것이 아니다.
--
--   p_sizes      가로세로 4자리 문자열 배열. 예 {'0505','1015','1018'}
--   p_bands      두께 구간 4자리 문자열 배열. 예 {'0510','1015','1520','2025','2530'}
--   p_exclude    제외할 8자리 조합. 예 {'10152530','10182530','12152530'}
--                (10x15, 10x18, 12x15의 2.5~3mm 세 조합이 빠진다)
--
-- 이미 있는 코드는 건드리지 않는다. 여러 번 돌려도 안전하다.
-- -----------------------------------------------------------------------------
create or replace function generate_finished_items(
  p_sizes          text[],
  p_bands          text[],
  p_exclude        text[] default '{}',
  p_name_prefix    text   default 'DX2401',
  p_shelf_months   int    default 12
) returns table (item_code text, item_name text, was_created boolean)
language plpgsql as $fn$
declare
  s text;
  b text;
  suffix text;
  v_code text;
  v_name text;
  v_new  boolean;
begin
  foreach s in array p_sizes loop
    if s !~ '^[0-9]{4}$' then
      raise exception '크기는 숫자 4자리여야 합니다 (가로2+세로2): %', s;
    end if;
    foreach b in array p_bands loop
      if b !~ '^[0-9]{4}$' then
        raise exception '두께 구간은 숫자 4자리여야 합니다 (하한2+상한2): %', b;
      end if;

      suffix := s || b;
      continue when suffix = any (p_exclude);

      v_code := 'PD' || suffix;
      -- 표시용 이름. 05 -> 5.0, 0510 -> 0.5~1.0mm
      v_name := format('%s %sx%s %s~%smm',
                  p_name_prefix,
                  mm_label(substr(s,1,2)), mm_label(substr(s,3,2)),
                  mm_label(substr(b,1,2)), mm_label(substr(b,3,2)));

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

-- 형명의 두 자리는 mm를 10배한 값이다. '05' -> 0.5, '10' -> 1.0, '25' -> 2.5
-- 소수 한 자리를 항상 붙인다. 1mm 와 1.0mm 가 섞이면 규격 표기가 흔들린다.
create or replace function mm_label(p text) returns text
language sql immutable as $fn$
  select to_char(p::numeric / 10, 'FM990.0')
$fn$;
