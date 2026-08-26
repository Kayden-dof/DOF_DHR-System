-- =============================================================================
-- 0017_grants_audit.sql  ·  M1~M4 표의 감사추적 · 삭제 차단 · 권한
-- 근거: CLAUDE.md §5 (S03 REVOKE DELETE 목록), §1
-- 범위: M1~M4
-- =============================================================================
--
-- §5의 REVOKE DELETE 목록을 그대로 옮긴다. 표마다 세 가지를 건다.
--   1) after insert or update  감사추적 (§5)
--   2) before delete           삭제 차단. 소유자·슈퍼유저도 막는다
--   3) before truncate         TRUNCATE는 DELETE 권한과 무관하고 행 트리거도
--                              타지 않는다. 문장 트리거로 따로 막는다
--
-- 표를 하나씩 나열하는 대신 목록을 돌린다. 새 표를 추가할 때 목록에만 넣으면
-- 세 가지가 함께 붙는다. 빠뜨려서 감사만 없는 표가 생기는 것을 막는다.

do $$
declare
  -- 표 이름 -> 감사 식별자 컬럼. id가 없는 표만 적는다.
  key_of jsonb := jsonb_build_object(
    'item_supplier',    'item_id',
    'steril_batch_lot', 'product_lot_id',
    'day_lock',         'work_order_id'
  );
  t       text;
  keycol  text;
  tables  text[] := array[
    'item','supplier','item_supplier','price_history','shelf_life_history',
    'device_master','dmr_operation','dmr_bom','dmr_bom_tier',
    'purchase_order','material_lot','material_issue','stock_movement',
    'work_order','product_lot','process_record',
    'steril_batch','steril_batch_lot','shipment',
    'record_print','day_lock'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise exception '표가 없습니다: %', t;
    end if;

    keycol := coalesce(key_of ->> t, 'id');

    -- 1) 감사추적
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update on %I
         for each row execute function trg_audit(%L)',
      t || '_audit', t, keycol);

    -- 2) 삭제 차단
    execute format('drop trigger if exists %I on %I', t || '_no_delete', t);
    execute format(
      'create trigger %I before delete on %I
         for each row execute function trg_block_delete()',
      t || '_no_delete', t);

    -- 3) TRUNCATE 차단
    execute format('drop trigger if exists %I on %I', t || '_no_truncate', t);
    execute format(
      'create trigger %I before truncate on %I
         for each statement execute function trg_block_delete()',
      t || '_no_truncate', t);

    -- 권한. 삭제는 주지 않는다.
    execute format('grant select, insert, update on %I to app_role', t);
    execute format('revoke delete, truncate on %I from app_role', t);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 함수 실행 권한
-- security definer 함수는 PUBLIC 기본 EXECUTE를 회수하고 명시적으로 준다.
-- -----------------------------------------------------------------------------
do $$
declare
  f text;
  definer_fns text[] := array[
    'cut_product_lot(uuid,uuid,int,int,date)',
    'complete_process(uuid)',
    'record_print_log(print_kind,text,uuid,uuid,int,uuid,uuid)',
    'print_day_record(uuid,int,uuid,text)',
    'make_solution(uuid[],numeric[],text,text)',
    'expire_material_lots()',
    'suggest_min_stock(int)',
    'generate_finished_items(text[],text[],text[],text,int)'
  ];
  plain_fns text[] := array[
    'required_qty(uuid,uuid,int,int)',
    'operation_requirements(uuid,int,int)',
    'shelf_life_at(uuid,date)',
    'supplier_is_approved(uuid,date)',
    'work_order_warnings(uuid,int)',
    'is_locked(uuid,int,uuid)',
    'mm_label(text)'
  ];
begin
  foreach f in array definer_fns loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to app_role', f);
  end loop;
  foreach f in array plain_fns loop
    execute format('grant execute on function %s to app_role', f);
  end loop;
end $$;

-- 뷰. 읽기만 준다.
do $$
declare v text;
  views text[] := array[
    'v_lot_genealogy','v_batch_material','v_reorder_alert','v_material_stock',
    'v_finished_stock','v_batch_cost','v_product_lot_cost','v_material_spend'
  ];
begin
  foreach v in array views loop
    execute format('grant select on %I to app_role', v);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- Supabase API 노출 재차단
--
-- 0006이 기본 권한을 내려 두었지만, 그 뒤에 만들어진 표에 대해 한 번 더 확인
-- 사살한다. 마이그레이션 순서가 바뀌거나 누군가 grant를 되살렸을 때를 위한 것이다.
-- -----------------------------------------------------------------------------
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables    in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('revoke all on all routines  in schema public from %I', r);
    end if;
  end loop;
end $$;
