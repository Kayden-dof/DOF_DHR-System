/* ===========================================================================
   0166 · 멸균 보고서 생략 - 보고서 없이 출고하는 로트 (사용자 2026-11-25)

   "멸균 보고서 대기 (스킵) 기능도 하나 만들어줘라. 멸균 선량 샘플 요청건이라 멸균 보고서 없이
   출고가 된 제품이라.. 스킵할때는 어떤 사유로 멸균 보고서를 스킵했는지 적을수 있게"

   0160 은 멸균 보고서가 적힌 로트만 출고하게 막았다. 멸균 선량 시험용 샘플처럼 보고서가 나오기
   전에 (또는 보고서 없이) 내보내는 로트가 있다. 그 로트에 «생략» 을 사유와 함께 적으면 출고를
   받는다. 시스템은 사유가 맞는지 판정하지 않는다 - 누가 · 언제 · 왜 생략했는지 남긴다 (§1).

   ── 생략 취소 ───────────────────────────────────────────────────────────────
   잘못 고른 로트를 생략하면 멸균 보고서 없는 제품이 출고 가능 목록에 선다. 그 로트를 아직 한
   개도 내보내지 않았으면 생략을 지울 수 있다 (감사추적에 남는다). 내보낸 뒤에는 출고의 근거라
   지우지 않는다.

   제품 로트를 지우는 길은 시연 자료 비우기뿐이다 (purge_demo_data 가 출고를 먼저 지운다) - 그때는
   생략도 함께 지워지도록 on delete cascade.
=========================================================================== */

create table if not exists steril_report_skip (
  product_lot_id uuid primary key references product_lot(id) on delete cascade,
  reason         text not null check (btrim(reason) <> ''),
  skipped_by     uuid not null references app_user(id),
  skipped_at     timestamptz not null default now()
);
comment on table steril_report_skip is
  '멸균 보고서 없이 출고하는 제품 로트와 그 사유 (0166 · 사용자 2026-11-25). 있으면 보고서 없이 출고를 받는다';
comment on column steril_report_skip.reason is '생략 사유 (예: 멸균 선량 시험용 샘플)';


/* === 감사 · 고치기 막기 · 내보낸 뒤 지우기 막기 · 권한 ==================== */
drop trigger if exists steril_report_skip_audit on steril_report_skip;
create trigger steril_report_skip_audit after insert or update or delete on steril_report_skip
  for each row execute function trg_audit('product_lot_id');

create or replace function trg_steril_skip_guard()
returns trigger language plpgsql as $fn$
declare v_lot text;
begin
  select lot_no into v_lot from product_lot where id = old.product_lot_id;
  if tg_op = 'UPDATE' then
    raise exception '멸균 보고서 생략은 고치지 않습니다. 생략을 취소하고 다시 적으십시오 (제조번호 %)', v_lot;
  end if;
  if exists (select 1 from shipment where product_lot_id = old.product_lot_id) then
    raise exception '제조번호 %은(는) 이미 출고해 멸균 보고서 생략을 취소할 수 없습니다', v_lot;
  end if;
  return old;
end $fn$;
comment on function trg_steril_skip_guard() is
  '멸균 보고서 생략은 고치지 않고, 출고한 로트의 생략은 지우지 않는다 (0166)';

drop trigger if exists steril_report_skip_guard on steril_report_skip;
create trigger steril_report_skip_guard before update or delete on steril_report_skip
  for each row execute function trg_steril_skip_guard();

grant select, insert, delete on steril_report_skip to app_role;
revoke update, truncate on steril_report_skip from app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke all on steril_report_skip from app_readonly';
    execute 'grant select on steril_report_skip to app_readonly';
  end if;
end $$;


/* === 묻는 함수 · 출고 막기 =================================================== */

/* 그 제품 로트의 멸균 보고서 생략 사유. 생략하지 않았으면 null */
create or replace function lot_steril_skip(p_lot uuid)
returns text
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select reason from steril_report_skip where product_lot_id = p_lot
$fn$;
comment on function lot_steril_skip(uuid) is '제품 로트의 멸균 보고서 생략 사유. 없으면 null (0166)';

/* 출고해도 되는가 - 멸균 보고서가 적혔거나 생략했다 */
create or replace function lot_steril_ok(p_lot uuid)
returns boolean
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select lot_steril_report(p_lot) is not null
      or exists (select 1 from steril_report_skip where product_lot_id = p_lot)
$fn$;
comment on function lot_steril_ok(uuid) is
  '멸균 보고서가 적혔거나 사유와 함께 생략한 제품 로트 - 출고할 수 있다 (0160 · 0166)';

grant execute on function lot_steril_skip(uuid) to app_role;
grant execute on function lot_steril_ok(uuid) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'grant execute on function lot_steril_skip(uuid) to app_readonly';
    execute 'grant execute on function lot_steril_ok(uuid) to app_readonly';
  end if;
end $$;

create or replace function trg_shipment_needs_steril_report()
returns trigger language plpgsql as $fn$
declare v_lot text;
begin
  if not lot_steril_ok(new.product_lot_id) then
    select lot_no into v_lot from product_lot where id = new.product_lot_id;
    raise exception '제조번호 %은(는) 멸균 보고서가 없어 출고할 수 없습니다. '
      '멸균 위탁에서 회수일과 멸균 보고서 번호를 먼저 적거나, 보고서 없이 내보내는 로트면 '
      '출고 화면의 멸균 보고서 대기에서 사유와 함께 생략하십시오', v_lot;
  end if;
  return new;
end $fn$;
comment on function trg_shipment_needs_steril_report() is
  '멸균 보고서가 없고 생략하지도 않은 제품 로트는 출고하지 않는다 (0160 · 0166)';
