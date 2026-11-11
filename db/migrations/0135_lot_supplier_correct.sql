-- ---------------------------------------------------------------------------
-- 자재 로트의 공급자를 바로잡는 문 (사용자 2026-11-11 «004는 위즈애드로»)
--
-- 0090 은 공급자를 잠근 채 두었다 - 어디서 왔는지가 성적서 · 승인 상태와
-- 묶여 있어서다. 그 판단은 그대로 둔다. 다만 입고 등록에서 공급자를 잘못
-- 고르면 영구히 되돌릴 수 없었고, 같은 로트번호로 다시 등록할 수도 없었다
-- (lot_no unique). 실물 라벨의 번호는 이미 정해져 있으므로 갈 곳이 없다.
--
-- 그래서 문을 하나만 낸다.
--   · 시스템관리자만, 사유를 적어야 연다 (0128 · 0131 과 같은 결)
--   · **아직 쓰이지 않은 로트만** - 원재료로 지시에 걸렸거나, 공정에 투입됐거나,
--     원액 원료로 꺼낸 로트는 계보가 이미 그 공급자를 가리키므로 막는다
--   · 바꾼 값과 사유는 감사추적에 남는다 (audit_log.reason)
--
-- lot_no · item_id · qty_received · made_on 은 지금처럼 잠근다.
--
-- material_lot_coa_once 는 0056 · 0090 · 0119 가 차례로 다시 건다. 배포마다
-- 앞의 것들이 다시 돌므로 마지막 모양은 **마지막에 도는 이 파일**이 정한다.
-- 0119 가 더한 made_on 을 빠뜨리지 말 것 (SL-05).
-- ---------------------------------------------------------------------------

/* === 1. 공급자 잠금을 따로 떼어 낸다 ===================================== */
drop trigger if exists material_lot_coa_once on material_lot;
create trigger material_lot_coa_once before update
  on material_lot for each row
  execute function trg_once_written('lot_no', 'item_id', 'qty_received', 'made_on');

comment on trigger material_lot_coa_once on material_lot is
  '고쳐 쓰면 계보가 뒤집히는 넷을 잠근다. 공급자는 material_lot_supplier_once 가 따로 잠근다 (0090 · 0119 · 0135)';

create or replace function trg_ml_supplier_once()
returns trigger language plpgsql as $fn$
begin
  if old.supplier_id is not null and new.supplier_id is distinct from old.supplier_id then
    /* 공급자 정정(0135): 표시는 정의자 함수 안일 때만 믿는다 */
    if current_setting('app.force_correct', true) = new.id::text
       and current_user not in ('app_role', 'app_readonly') then
      return new;
    end if;
    raise exception 'supplier_id(은)는 한 번 적으면 고칠 수 없습니다 (전 값 %)', old.supplier_id;
  end if;
  return new;
end $fn$;

drop trigger if exists material_lot_supplier_once on material_lot;
create trigger material_lot_supplier_once before update
  on material_lot for each row
  execute function trg_ml_supplier_once();


/* === 2. 공급자 정정 ======================================================= */
create or replace function force_correct_lot_supplier(p_lot uuid, p_supplier uuid, p_why text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  r       record;
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if not has_role('SYS_ADMIN') then
    raise exception '공급자 정정은 시스템관리자만 할 수 있습니다';
  end if;
  if p_why is null or btrim(p_why) = '' then
    raise exception '공급자 정정 사유를 적으십시오';
  end if;

  select id, lot_no, supplier_id, made_on into r from material_lot where id = p_lot for update;
  if not found then
    raise exception '자재 로트를 찾을 수 없습니다';
  end if;
  if r.made_on is not null then
    raise exception '자체 제조 로트에는 공급자가 없습니다 (%)', r.lot_no;
  end if;
  if not exists (select 1 from supplier where id = p_supplier) then
    raise exception '공급자를 찾을 수 없습니다';
  end if;
  if r.supplier_id = p_supplier then
    raise exception '지금 값과 같습니다';
  end if;
  if exists (select 1 from work_order where material_lot_id = p_lot)
     or exists (select 1 from material_issue where material_lot_id = p_lot)
     or exists (select 1 from stock_movement where material_lot_id = p_lot and type = 'SOLUTION') then
    raise exception '이미 쓰인 로트입니다 (%). 계보가 그 공급자를 가리키므로 바꿀 수 없습니다', r.lot_no;
  end if;

  perform set_config('app.change_reason', '공급자 정정 · ' || btrim(p_why), true);
  perform set_config('app.force_correct', p_lot::text, true);
  update material_lot set supplier_id = p_supplier where id = p_lot;
  perform set_config('app.force_correct', '', true);
end $fn$;

comment on function force_correct_lot_supplier(uuid, uuid, text) is
  '아직 쓰이지 않은 자재 로트의 공급자를 시스템관리자가 사유와 함께 바로잡는다 (0135)';

revoke all on function force_correct_lot_supplier(uuid, uuid, text) from public;
grant execute on function force_correct_lot_supplier(uuid, uuid, text) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke all on function force_correct_lot_supplier(uuid, uuid, text) from app_readonly';
  end if;
end $$;
