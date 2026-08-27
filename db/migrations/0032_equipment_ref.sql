-- =============================================================================
-- 0032_equipment_ref.sql  ·  제조기록이 설비 대장을 참조한다
-- 근거: 사용자 지적 2026-08-27, CLAUDE.md §4.2 (shelf_life_ref + 고정 값)
-- =============================================================================
--
-- process_record.equipment_id 가 코드 문자열뿐이라 설비 대장과 끊겨 있었다.
-- 무결성이 없어 없는 코드도 들어가고, 코드를 바꾸면 지난 기록이 가리키는
-- 대상이 사라진다. 그래서 코드 수정을 막아야 했는데, 그건 증상을 막은 것이지
-- 원인을 고친 것이 아니다.
--
-- 참조와 스냅숏을 나눈다. 사양이 유효기한에서 이미 쓰는 방식이다 (§4.2):
--   "유효기한은 product_lot 생성 시점 값으로 고정한다. 참조한
--    shelf_life_history 행도 함께 저장해 근거를 남긴다"
--
--   equipment_ref  설비 대장을 가리키는 FK. 조회 · 계보 · 검토가 이걸로 돈다
--   equipment_id   그때 종이에 찍힌 코드. 사양 §4.6 의 text 그대로, 불변
--
-- 이러면 둘 다 얻는다. 대장 코드를 나중에 바꿔도 참조는 그대로라 설비 사용
-- 기록이 이어지고, 지난 기록의 코드는 그때 찍힌 값 그대로 남아 종이와 어긋나지
-- 않는다. 코드를 잠글 이유가 사라지므로 0031 의 잠금은 내린다.

alter table process_record
  add column if not exists equipment_ref uuid references equipment(id);

create index if not exists process_record_equipment_ref
  on process_record (equipment_ref);

-- ── 지난 기록은 소급해서 잇지 않는다 ──────────────────────────────────────
-- 처음에는 코드로 이어 주는 update 를 넣었는데 S04 가 막았다. 인쇄된 기록은
-- 수정할 수 없다 - 규칙이 제 할 일을 한 것이고, 우회할 생각을 하면 안 된다.
-- 트리거를 잠시 끄는 것도 §10 이 금지한 예외 경로다.
--
-- 그래서 지난 기록은 equipment_ref 가 빈 채로 둔다. 그 기록들이 참조 없이
-- 적혔다는 것도 사실이다. 조회는 참조를 먼저 보고 없으면 코드로 떨어진다
-- (아래 v_process_equipment). 새 기록부터 참조가 붙는다.

/* ---------------------------------------------------------------------------
   스냅숏 자동 기입

   응용은 설비를 하나로만 지목한다 (equipment_ref). 종이에 찍힐 코드는 그
   시점의 대장에서 여기서 떠 온다. 두 값을 응용이 각각 넣게 하면 언젠가
   어긋난다.

   이미 적힌 스냅숏은 건드리지 않는다. 그건 그때의 사실이다.
--------------------------------------------------------------------------- */
create or replace function trg_pr_equipment_snapshot()
returns trigger language plpgsql as $$
begin
  if new.equipment_ref is not null and new.equipment_id is null then
    select code into new.equipment_id from equipment where id = new.equipment_ref;
  end if;
  return new;
end $$;

drop trigger if exists process_record_equipment_snapshot on process_record;
create trigger process_record_equipment_snapshot before insert on process_record
  for each row execute function trg_pr_equipment_snapshot();

-- 0031 의 코드 잠금을 내린다. 참조가 신원을 들고 스냅숏이 역사를 들므로
-- 코드를 바꿔도 잃는 것이 없다
drop trigger if exists equipment_code_locked on equipment;
drop function if exists trg_equipment_code_locked();

/* ---------------------------------------------------------------------------
   공정에 걸린 설비 · 현장 타일이 참조를 보내도록 id 를 함께 준다
--------------------------------------------------------------------------- */
drop function if exists operation_equipment_list(uuid);
create function operation_equipment_list(p_op uuid)
returns table (id uuid, code text, name text, note text, valid_until date)
language sql stable as $$
  select e.id, e.code, e.name, e.note,
         (select max(ev.valid_until) from equipment_validation ev
           where ev.equipment_id = e.id)
    from operation_equipment oe
    join equipment e on e.id = oe.equipment_id
   where oe.operation_id = p_op and oe.is_active and e.is_active
   order by e.code
$$;
grant execute on function operation_equipment_list(uuid) to app_role;

/* ---------------------------------------------------------------------------
   기록 → 설비 잇기

   참조를 먼저 보고, 없으면 그때 찍힌 코드로 떨어진다. 이 규칙을 질의마다
   되풀이하면 어느 하나가 반드시 어긋나므로 한 곳에 둔다.
--------------------------------------------------------------------------- */
create or replace view v_process_equipment as
select pr.id as process_record_id,
       pr.equipment_id  as code_snapshot,
       coalesce(pr.equipment_ref, e2.id) as equipment_id
  from process_record pr
  left join equipment e2
    on pr.equipment_ref is null and e2.code = pr.equipment_id
 where pr.equipment_id is not null or pr.equipment_ref is not null;

grant select on v_process_equipment to app_role;
