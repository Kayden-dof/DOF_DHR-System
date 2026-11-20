/* ===========================================================================
   0151 · 형명은 그 제품의 것만 · 쓰지 않은 제조번호 지우기 (사용자 2026-11-20)

   "이부분 버튼은 왜 있는거지?? ... 그리고 잘못넣었으면 어떻게 삭제 하는데??"

   B261104-01 (DX2401 메디포젠) 배치 화면의 «제조번호 부여» 형명 칸에 DX2402(탈세포화 돼지 늑연골
   이식재)가 함께 떠, 그것으로 GM-26111002 가 붙었다.

   ── 1. 형명 ─────────────────────────────────────────────────────────────────
   dm_models 는 형명 체계(PC …)가 없는 제품이면 «체계 밖 완제품» 을 모두 냈다. DX2401 · DX2402 가
   둘 다 체계 밖 품목이라 서로의 배치에 떴다. 체계가 없으면 그 제품표준서의 제품 코드로 시작하는
   완제품만, 그것도 없으면 제품표준서의 대표 품목 하나만 낸다.

   ── 2. 쓰지 않은 제조번호 지우기 ─────────────────────────────────────────────
   delete_unused_product_lot(로트, 사유) - 생산관리자 · 시스템관리자. 그 제조번호를 가리키는 기록이
   하나도 없을 때만 (공정 기록 · 건너뛰기 · 인쇄 · 멸균 · 출고 · 부적합 · 일탈 · 재고 이동 - 제품
   로트를 가리키는 모든 표를 DB 가 스스로 찾아 본다). 종료된 배치는 지우지 않는다. 지운 행과 사유는
   감사추적에 남고, 번호는 다시 쓰지 않는다 (채번은 앞으로만 간다). 쓴 로트는 부적합 · 폐기로 다룬다.
=========================================================================== */

/* === 1. 형명 ============================================================== */
create or replace function dm_models(p_dm uuid)
returns table (id uuid, code text, name text)
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  with rep as (
    select (select ms.prefix from model_scheme ms
             where ms.is_active and ms.prefix <> ''
               and left(i.code, length(ms.prefix)) = ms.prefix
             order by length(ms.prefix) desc limit 1) as prefix,
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
  '제품표준서의 형명. 대표 형명과 같은 형명 체계의 완제품, 체계가 없으면 그 제품 코드로 시작하는 완제품 (0138 · 0151)';

grant execute on function dm_models(uuid) to app_role, app_readonly;


/* === 2. 쓰지 않은 제조번호 지우기 ======================================== */
/* 제품 로트를 가리키는 모든 표 - 한 줄이라도 있으면 쓴 로트다. 표가 늘어도 DB 가 스스로 찾는다 */
create or replace function product_lot_used(p_lot uuid)
returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  f      record;
  v_used boolean;
begin
  for f in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'product_lot'::regclass
  loop
    execute format('select exists (select 1 from %s where %I = $1)', f.tbl, f.col)
      into v_used using p_lot;
    if v_used then
      return true;
    end if;
  end loop;
  return false;
end $fn$;
grant execute on function product_lot_used(uuid) to app_role, app_readonly;

create or replace function delete_unused_product_lot(p_lot uuid, p_reason text)
returns text
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  v_why   text := btrim(coalesce(p_reason, ''));
  v_no    text;
  v_status text;
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if not exists (select 1 from user_role
                  where user_id = v_actor and role in ('PROD_MGR', 'SYS_ADMIN')) then
    raise exception '제조번호는 생산관리자 또는 시스템관리자가 지웁니다';
  end if;
  if v_why = '' then
    raise exception '왜 지우는지 적으십시오';
  end if;

  select pl.lot_no, w.status::text into v_no, v_status
    from product_lot pl join work_order w on w.id = pl.work_order_id
   where pl.id = p_lot for update of pl;
  if v_no is null then
    raise exception '제조번호를 찾을 수 없습니다';
  end if;
  if v_status = 'DONE' then
    raise exception '종료된 배치의 제조번호는 지우지 않습니다';
  end if;

  if product_lot_used(p_lot) then
    raise exception '제조번호 %로 남은 기록이 있어 지울 수 없습니다. 부적합 · 폐기로 다루십시오', v_no;
  end if;

  perform set_config('app.change_reason', '제조번호 지움 · ' || v_why, true);
  delete from product_lot where id = p_lot;
  return v_no;
end $fn$;
comment on function delete_unused_product_lot(uuid, text) is
  '생산관리자 · 시스템관리자가 아무 기록도 가리키지 않는 제조번호를 사유와 함께 지운다 (0151)';

revoke all on function delete_unused_product_lot(uuid, text) from public;
grant execute on function delete_unused_product_lot(uuid, text) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke execute on function delete_unused_product_lot(uuid, text) from app_readonly';
  end if;
end $$;
