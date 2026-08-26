-- =============================================================================
-- 0024_equipment.sql  ·  설비 기준정보
-- 근거: CLAUDE.md §4.6 (process_record.equipment_id), §7 (제조기록서)
-- =============================================================================
--
-- process_record.equipment_id 가 스키마에 있고 제조기록서에도 인쇄되는데, 현장
-- 화면에 넣을 칸이 없어서 늘 비어 있는 칸이 찍혀 나갔다. 빈 칸이 찍힌 GMP
-- 기록지는 넣는 것보다도 빼는 것보다도 나쁘다.
--
-- 현장은 키보드를 쓰지 않으므로 타일로 고른다. 그러려면 고를 목록이 있어야 하고,
-- 목록이 곧 이 표다.
--
-- ── 왜 FK 로 묶지 않는가 ────────────────────────────────────────────────────
-- 사양 §4.6 이 equipment_id 를 text 로 정해 두었다. 그 컬럼에 설비 코드를 그대로
-- 적는다. release_approved_by 가 품질책임자 이름을 text 로 적는 것과 같은 방식이다.
--
-- 기록은 지울 수 없고 고칠 수도 없다 (S03 · S04). 나중에 설비가 바뀌거나 목록에서
-- 내려가도 그때 적힌 코드는 그대로 남아야 한다. FK 로 묶으면 그 설비를 지울 수
-- 없게 만드는 것까지는 좋은데, 이 시스템은 애초에 아무것도 지우지 않으므로
-- 얻는 것이 없고 대신 사양과 어긋난다.
--
-- ── 왜 공정에 매다는가 ──────────────────────────────────────────────────────
-- 설비를 전부 한 줄로 늘어놓으면 장갑 낀 손이 긴 목록에서 하나를 찾아야 한다.
-- 어느 공정에 어느 설비가 쓰이는지는 정해져 있으므로 그 관계를 적어 두고,
-- 현장에서는 그 공정에 걸린 것만 보여 준다.
--
-- ── 강제하지 않는다 ────────────────────────────────────────────────────────
-- 설비를 고르지 않아도 공정은 시작된다. 차단은 S01~S05 다섯 개뿐이고 (§2),
-- 설비 미기록은 그중에 없다. 공정에 걸린 설비가 없으면 화면에 칸 자체가
-- 나오지 않는다.
-- =============================================================================

create table if not exists equipment (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,        -- 기록에 적히는 값. 예 'FD-01'
  name      text not null,               -- 화면 타일에 함께 보이는 이름
  note      text,
  is_active boolean not null default true
);

-- 어느 공정에 어느 설비가 쓰이는가. 한 설비가 여러 공정에 걸릴 수 있다.
--
-- 뗄 때도 지우지 않는다. §10 이 "DELETE FROM - 어떤 표에도" 라고 못 박았고,
-- 예외를 하나 만들면 그다음부터는 어느 표가 지워도 되는 표인지 매번 판단해야
-- 한다. 뗀 것은 is_active = false 로 남고 감사추적에 그 변경이 적힌다.
create table if not exists operation_equipment (
  operation_id uuid not null references dmr_operation(id),
  equipment_id uuid not null references equipment(id),
  is_active    boolean not null default true,
  primary key (operation_id, equipment_id)
);
create index if not exists operation_equipment_eq
  on operation_equipment (equipment_id);

/* --- S03 · 삭제 금지와 감사추적 -------------------------------------------- */

do $$
declare
  t text;
  keycol text;
begin
  foreach t in array array['equipment', 'operation_equipment'] loop
    keycol := case t when 'operation_equipment' then 'operation_id' else 'id' end;

    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update on %I
         for each row execute function trg_audit(%L)', t || '_audit', t, keycol);

    execute format('drop trigger if exists %I on %I', t || '_no_delete', t);
    execute format(
      'create trigger %I before delete on %I
         for each row execute function trg_block_delete()', t || '_no_delete', t);

    execute format('drop trigger if exists %I on %I', t || '_no_truncate', t);
    execute format(
      'create trigger %I before truncate on %I
         for each statement execute function trg_block_delete()', t || '_no_truncate', t);

    execute format('revoke delete on %I from app_role', t);
    execute format('grant select, insert, update on %I to app_role', t);
  end loop;
end $$;

/* ---------------------------------------------------------------------------
   공정에 걸린 설비

   현장 화면이 타일로 그릴 목록이다. 내려간 설비는 빼되, 이미 기록에 적힌
   코드는 건드리지 않는다 - 그 기록은 그때 그 설비로 작업한 사실이다.
--------------------------------------------------------------------------- */
create or replace function operation_equipment_list(p_op uuid)
returns table (code text, name text, note text)
language sql stable as $$
  select e.code, e.name, e.note
    from operation_equipment oe
    join equipment e on e.id = oe.equipment_id
   where oe.operation_id = p_op and oe.is_active and e.is_active
   order by e.code
$$;

grant execute on function operation_equipment_list(uuid) to app_role;
