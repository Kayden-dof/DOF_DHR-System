/* ===========================================================================
   0158 · 형명의 UDI-DI · 형명 체계를 제품에 잇는다 (사용자 2026-11-25)

   "왜 계속 형명을 매칭을 못하지??" → «Yes, register them» · "형명은 입력하면 자동으로 배치되게 해줘.
   재단할때" · "여기 폴더 안에 형명에 따른 UDI 코드도 있으니까 다 입력해서 매칭하고."

   DX2401(메디포젠)의 형명은 PD + 가로 · 세로(cm) · 두께 하한 · 상한(0.1 mm) 이고, 품질파트의 표준코드
   등록대장(F809-01)에 형명마다 GTIN(UDI-DI) 이 있다. 그런데 형명 체계가 PC(DX2402) 하나뿐이었고, 제품표준서의
   대표 품목이 형명이 아닌 DX2401 이라 재단에서 고를 형명이 DX2401 하나였다.

   ── 1. 형명의 UDI-DI ────────────────────────────────────────────────────────
   item.udi_di  GTIN-14 (숫자 14자리). 한 UDI-DI 는 한 품목에만 - 표준코드는 형명마다 하나다.
                재단에서 형명 대신 UDI(라벨 바코드)를 넣어도 그 형명을 고른다.

   ── 2. 형명 체계를 제품에 잇는다 ─────────────────────────────────────────────
   model_scheme.product_code  이 체계가 어느 제품의 형명인가 (DX2401 → PD).
   dm_models 는 대표 품목 코드로 체계를 찾고(PC035008 → PC), 못 찾으면 제품 코드로 이은 체계를 본다.
   둘 다 없으면 0151 그대로 (그 제품 코드로 시작하는 완제품 · 대표 품목).

   체계 · 형명 · UDI 자료는 운영에 따로 적는다 - 시험 자료의 형명(PD05050510)과 겹치지 않게 이관에 넣지 않는다.
=========================================================================== */

/* === 1. 형명의 UDI-DI ==================================================== */
alter table item add column if not exists udi_di text;
alter table item drop constraint if exists item_udi_di_check;
alter table item add constraint item_udi_di_check check (udi_di is null or udi_di ~ '^[0-9]{14}$');
create unique index if not exists item_udi_di_uk on item (udi_di) where udi_di is not null;
comment on column item.udi_di is
  '형명의 UDI-DI (GTIN-14, 표준코드 등록대장 F809-01). 재단에서 형명 대신 넣어도 그 형명을 고른다 (0158)';


/* === 2. 형명 체계를 제품에 잇는다 ======================================== */
alter table model_scheme add column if not exists product_code text;
comment on column model_scheme.product_code is
  '이 체계가 어느 제품(device_master.product_code)의 형명인가. 대표 품목이 형명이 아닌 제품이 체계를 찾는 길 (0158)';

create or replace function dm_models(p_dm uuid)
returns table (id uuid, code text, name text)
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  with rep as (
    select coalesce(
             /* 대표 품목 코드가 맞는 체계 (PC035008 → PC) */
             (select ms.prefix from model_scheme ms
               where ms.is_active and ms.prefix <> ''
                 and left(i.code, length(ms.prefix)) = ms.prefix
               order by length(ms.prefix) desc limit 1),
             /* 제품 코드로 이은 체계 (DX2401 → PD · 0158) */
             (select ms.prefix from model_scheme ms
               where ms.is_active and ms.prefix <> ''
                 and ms.product_code = dm.product_code
               order by length(ms.prefix) desc limit 1)) as prefix,
           dm.item_id as own,
           nullif(btrim(coalesce(dm.product_code, '')), '') as product
      from device_master dm join item i on i.id = dm.item_id
     where dm.id = p_dm)
  select i.id, i.code, i.name
    from item i cross join rep
   where i.type = 'FIN' and i.is_active
     and case
           when rep.prefix is not null
             then left(i.code, length(rep.prefix)) = rep.prefix
           /* 체계 밖 제품: 그 제품 코드로 시작하는 완제품, 없으면 대표 품목 하나 (0151) */
           else i.id = rep.own
             or (rep.product is not null and left(i.code, length(rep.product)) = rep.product
                 and not exists (select 1 from model_scheme ms
                                  where ms.is_active and ms.prefix <> ''
                                    and left(i.code, length(ms.prefix)) = ms.prefix))
         end
   order by i.code
$fn$;
comment on function dm_models(uuid) is
  '제품표준서의 형명. 대표 품목 또는 제품 코드로 이은 형명 체계의 완제품, 체계가 없으면 그 제품 코드로 시작하는 완제품 (0138 · 0151 · 0158)';

grant execute on function dm_models(uuid) to app_role, app_readonly;
