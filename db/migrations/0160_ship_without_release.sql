/* ===========================================================================
   0160 · 출고는 출하 승인 대신 멸균 보고서로 - 생산팀 전용 (사용자 2026-11-25)

   "우리 프로그램이 생산팀에서만 굴러가는거라서 출하 승인 기능이 품질에서 쓰는거라 해당사항이
   없거든? … 품질에서는 이 프로그램을 안쓸거거든.. 전적으로 생산팀의 지원 프로그램이라고 보는게 맞아"
   "생산 배치가 종료되었을때 멸균 위탁을 보내는걸 기준으로 하고, 멸균 입고가 되면 멸균보고서를
   넣어야지만 출하가 가능한 시스템 흐름으로"

   ── 1. 출하 승인으로 막던 두 규칙을 뗀다 ─────────────────────────────────────
     shipment_needs_approval  출하 승인 기록(release_approved_by)이 없는 로트는 출고 불가 (0134)
     shipment_request_no      발행된 출하 승인 요청서 번호가 없으면 출고 불가 (0026 · 0111)
   품질이 이 시스템에 출하 승인을 적지 않으므로 이 규칙이 있으면 생산이 출고를 기록할 길이 없다.
   release_request_no 칸은 비울 수 있는 칸으로 남는다. 함수는 지우지 않는다 - 지난 이관이 다시 돌 때
   만들고 이 이관이 트리거만 뗀다.

   ── 2. 멸균 보고서가 있어야 출고한다 ─────────────────────────────────────────
   그 제품 로트가 든 멸균 위탁이 회수되고(received_at) 멸균 보고서 번호(cert_no)가 적혀 있어야
   출고를 기록한다. 사용자가 정한 차단이다 (§2 의 S01~S05 밖 · 2026-11-25). 막는 것은 «보고서가
   적혔는가» 하나다 - 멸균이 맞게 됐는지 판정하지 않는다 (§1).
=========================================================================== */

/* === 1. 출하 승인 규칙 떼기 =============================================== */
drop trigger if exists shipment_needs_approval on shipment;
drop trigger if exists shipment_request_no on shipment;

comment on column shipment.release_request_no is
  '출하 승인 요청서 번호. 0160 부터 적지 않아도 된다 - 생산팀 전용, 출하 승인은 시스템 밖';


/* === 2. 멸균 보고서 ======================================================= */
comment on column steril_batch.cert_no is
  '멸균 보고서 번호. 회수일과 함께 적혀야 그 배치의 제품 로트를 출고할 수 있다 (0160)';

/* 그 제품 로트의 멸균 보고서 번호 (회수된 멸균 위탁의 것). 없으면 null */
create or replace function lot_steril_report(p_lot uuid)
returns text
language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  select string_agg(distinct btrim(sb.cert_no), ', ')
    from steril_batch_lot sbl join steril_batch sb on sb.id = sbl.steril_batch_id
   where sbl.product_lot_id = p_lot
     and sb.received_at is not null
     and btrim(coalesce(sb.cert_no, '')) <> ''
$fn$;
comment on function lot_steril_report(uuid) is
  '제품 로트가 든 회수된 멸균 위탁의 멸균 보고서 번호. 없으면 null - 출고할 수 없다 (0160)';
grant execute on function lot_steril_report(uuid) to app_role, app_readonly;

create or replace function trg_shipment_needs_steril_report()
returns trigger language plpgsql as $fn$
declare v_lot text;
begin
  if lot_steril_report(new.product_lot_id) is null then
    select lot_no into v_lot from product_lot where id = new.product_lot_id;
    raise exception '제조번호 %은(는) 멸균 보고서가 없어 출고할 수 없습니다. '
      '멸균 위탁에서 회수일과 멸균 보고서 번호를 먼저 적으십시오', v_lot;
  end if;
  return new;
end $fn$;

drop trigger if exists shipment_needs_steril_report on shipment;
create trigger shipment_needs_steril_report before insert on shipment
  for each row execute function trg_shipment_needs_steril_report();

comment on function trg_shipment_needs_steril_report() is
  '멸균 보고서가 없는 제품 로트는 출고하지 않는다 (0160 · 사용자 2026-11-25)';
