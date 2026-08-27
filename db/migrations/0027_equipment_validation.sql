-- =============================================================================
-- 0027_equipment_validation.sql  ·  설비 밸리데이션 이력과 사용 기록
-- 근거: 사용자 지시 2026-08-27, CLAUDE.md §2 (경고만) · §8.5 (검토 지원)
-- =============================================================================
--
-- 설비는 정기 밸리데이션을 받는다. 수행일 · 만료일 · 서면 보고서 번호를 이력으로
-- 쌓고, 최신 만료일이 곧 지금 상태다. shelf_life_history 가 사용기간을 다루는
-- 것과 같은 방식이다 - 서면 보고서가 근거이고 시스템은 그 번호를 옮겨 적는다.
--
-- ── 기한이 지나도 차단하지 않는다 ──────────────────────────────────────────
-- 차단은 S01~S05 다섯 개뿐이다 (§2). 기한 경과 설비는
--   · 작업 지시서 발행 화면과 인쇄물에 미리 표시되고     (착수 전에 알린다)
--   · 현장 타일에 경고가 붙으며                          (그래도 기록은 진행된다)
--   · 검토 지원이 "사용일에 유효한 밸리데이션 없음"을 짚는다 (§8.5 · 산술)
--
-- 소급 판정이 가능한 이유: 이력에 수행일과 만료일이 있으므로 임의 사용일에
-- 유효한 밸리데이션이 있었는지가 산술로 정해진다.

create table if not exists equipment_validation (
  id            uuid primary key default gen_random_uuid(),
  equipment_id  uuid not null references equipment(id),
  performed_on  date not null,
  valid_until   date not null,
  report_no     text not null,              -- 서면 밸리데이션 보고서 번호
  note          text,
  registered_by uuid not null references app_user(id),
  registered_at timestamptz not null default now(),
  check (valid_until >= performed_on)
);
create index if not exists equipment_validation_eq
  on equipment_validation (equipment_id, valid_until desc);

/* --- S03 · 삭제 금지와 감사추적 -------------------------------------------- */
do $$
begin
  execute 'drop trigger if exists equipment_validation_audit on equipment_validation';
  execute $t$create trigger equipment_validation_audit after insert or update
    on equipment_validation for each row execute function trg_audit('id')$t$;
  execute 'drop trigger if exists equipment_validation_no_delete on equipment_validation';
  execute 'create trigger equipment_validation_no_delete before delete
    on equipment_validation for each row execute function trg_block_delete()';
  execute 'drop trigger if exists equipment_validation_no_truncate on equipment_validation';
  execute 'create trigger equipment_validation_no_truncate before truncate
    on equipment_validation for each statement execute function trg_block_delete()';
  execute 'revoke delete on equipment_validation from app_role';
  execute 'grant select, insert, update on equipment_validation to app_role';
end $$;

/* ---------------------------------------------------------------------------
   설비 현황. 최신 밸리데이션 하나를 붙인다
--------------------------------------------------------------------------- */
create or replace view v_equipment_status as
select e.id, e.code, e.name, e.note, e.is_active,
       v.performed_on, v.valid_until, v.report_no
  from equipment e
  left join lateral (
    select performed_on, valid_until, report_no
      from equipment_validation
     where equipment_id = e.id
     order by valid_until desc, performed_on desc
     limit 1
  ) v on true;
grant select on v_equipment_status to app_role;

/* ---------------------------------------------------------------------------
   공정에 걸린 설비 · 만료일 포함

   반환 열이 바뀌므로 drop 후 다시 만든다. 배포된 옛 코드는 열 이름으로
   고르므로 열이 하나 늘어도 그대로 돈다.
--------------------------------------------------------------------------- */
drop function if exists operation_equipment_list(uuid);
create function operation_equipment_list(p_op uuid)
returns table (code text, name text, note text, valid_until date)
language sql stable as $$
  select e.code, e.name, e.note,
         (select max(ev.valid_until) from equipment_validation ev
           where ev.equipment_id = e.id)
    from operation_equipment oe
    join equipment e on e.id = oe.equipment_id
   where oe.operation_id = p_op and oe.is_active and e.is_active
   order by e.code
$$;
grant execute on function operation_equipment_list(uuid) to app_role;

/* ---------------------------------------------------------------------------
   설비 사용 기록 인쇄

   record_print 가 설비를 가리킬 수 있어야 회차와 자료 식별자가 설비별로
   이어진다. 다른 양식과 같은 통제다 (§7).
--------------------------------------------------------------------------- */
alter type print_kind add value if not exists 'EQUIPMENT_LOG';

alter table record_print add column if not exists equipment_id uuid references equipment(id);

-- 회차 판정에 설비가 들어가도록 다시 만든다.
--
-- 8인자 옛 서명은 지운다. 새 함수의 아홉째 인자에 기본값이 있어 배포되어 돌고
-- 있는 옛 코드의 8인자 호출도 그대로 여기에 붙는다. 둘을 같이 두면 오히려
-- 8인자 호출이 어느 쪽인지 모호해진다 - 0020 에서 겪은 함정이다.
drop function if exists record_print_log(print_kind, text, uuid, uuid, int, uuid, uuid, int);
-- 재실행 안전. 이 파일이 다시 돌 때는 9인자가 이미 있다
drop function if exists record_print_log(print_kind, text, uuid, uuid, int, uuid, uuid, int, uuid);

create function record_print_log(
  p_kind          print_kind,
  p_data_hash     text,
  p_work_order    uuid default null,
  p_product_lot   uuid default null,
  p_day_no        int  default null,
  p_worker        uuid default null,
  p_material_lot  uuid default null,
  p_pages         int  default 1,
  p_equipment     uuid default null
) returns record_print
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_seq int; v_row record_print; v_actor uuid := current_user_id();
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from record_print
   where kind = p_kind
     and work_order_id is not distinct from p_work_order
     and product_lot_id is not distinct from p_product_lot
     and day_no is not distinct from p_day_no
     and worker_id is not distinct from p_worker
     and material_lot_id is not distinct from p_material_lot
     and equipment_id is not distinct from p_equipment;

  insert into record_print (kind, work_order_id, product_lot_id, day_no, worker_id,
                            material_lot_id, equipment_id, seq, data_hash, printed_by, pages)
  values (p_kind, p_work_order, p_product_lot, p_day_no, p_worker,
          p_material_lot, p_equipment, v_seq, p_data_hash, v_actor,
          greatest(coalesce(p_pages, 1), 1))
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function record_print_log(print_kind, text, uuid, uuid, int, uuid, uuid, int, uuid)
  to app_role;

/* ---------------------------------------------------------------------------
   검토 지원 (§8.5) · 아홉째 항목

   설비를 적은 기록의 사용일에 유효한 밸리데이션이 있었는지는 산술로 정해진다.
   설비를 적지 않은 기록은 여기서 다루지 않는다 - 그건 다른 문제다.
   전체 함수를 다시 쓴다 (0023 본문 + 9번 가지).
--------------------------------------------------------------------------- */
create or replace function review_flags(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable as $$

  select distinct '시각 모순'::text,
         format('%s %s일차 %s: 시작 %s, 종료 %s - 시각이 역전되어 있음',
                o.code, pr.day_no, u.full_name,
                to_char(timezone('Asia/Seoul', pr.started_at), 'HH24:MI'),
                to_char(timezone('Asia/Seoul', pr.ended_at),   'HH24:MI')),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join app_user u on u.id = pr.worker_id
   where pr.work_order_id = p_wo
     and pr.started_at is not null and pr.ended_at is not null
     and pr.ended_at < pr.started_at

  union all

  select distinct '시각 모순'::text,
         format('%s%s 종료 %s 보다 %s 시작 %s 가 빠름',
                coalesce(pl.lot_no || ' ', ''),
                a.code, to_char(timezone('Asia/Seoul', pa.ended_at),  'MM-DD HH24:MI'),
                b.code, to_char(timezone('Asia/Seoul', pb.started_at),'MM-DD HH24:MI')),
         pb.day_no, b.code
    from process_record pa
    join dmr_operation a on a.id = pa.operation_id
    join process_record pb on pb.work_order_id = pa.work_order_id
    join dmr_operation b on b.id = pb.operation_id
    left join product_lot pl on pl.id = pb.product_lot_id
   where pa.work_order_id = p_wo
     and b.seq = a.seq + 1
     and pa.ended_at is not null and pb.started_at is not null
     and pb.started_at < pa.ended_at
     and pa.product_lot_id is not distinct from pb.product_lot_id

  union all

  select '수량 불일치'::text,
         format('%s %s: 불출 %s, 반납 %s - 반납이 더 큼',
                i.name, ml.lot_no,
                trim(to_char(x.issued, 'FM999999990.###')),
                trim(to_char(x.returned, 'FM999999990.###'))),
         null::int, ml.lot_no
    from (
      select mi.material_lot_id,
             sum(mi.qty) as issued,
             coalesce((select sum(sm.qty) from stock_movement sm
                        where sm.work_order_id = p_wo
                          and sm.type = 'RETURN'
                          and sm.material_lot_id = mi.material_lot_id), 0) as returned
        from material_issue mi
        join process_record pr on pr.id = mi.process_record_id
       where pr.work_order_id = p_wo
       group by mi.material_lot_id
    ) x
    join material_lot ml on ml.id = x.material_lot_id
    join item i on i.id = ml.item_id
   where x.returned > x.issued

  union all

  select '구간 이탈'::text,
         format('%s %s: 장입 %s장 기준 %s %s 인데 %s %s 기입',
                o.code, i.name, wo.sheet_count,
                trim(to_char(x.need, 'FM999999990.###')), i.usage_uom,
                trim(to_char(x.put,  'FM999999990.###')), i.usage_uom),
         pr.day_no, o.code
    from (
      select pr2.id as pr_id, ml2.item_id, sum(mi2.qty) as put,
             required_qty(pr2.operation_id, ml2.item_id, wo2.sheet_count, 0) as need
        from material_issue mi2
        join process_record pr2 on pr2.id = mi2.process_record_id
        join work_order wo2 on wo2.id = pr2.work_order_id
        join material_lot ml2 on ml2.id = mi2.material_lot_id
       where pr2.work_order_id = p_wo
       group by pr2.id, ml2.item_id, pr2.operation_id, wo2.sheet_count
    ) x
    join process_record pr on pr.id = x.pr_id
    join dmr_operation o on o.id = pr.operation_id
    join work_order wo on wo.id = pr.work_order_id
    join item i on i.id = x.item_id
    join dmr_bom b on b.operation_id = pr.operation_id and b.component_item_id = x.item_id
   where b.basis = 'SHEET_TIER'
     and x.need is not null
     and x.put <> x.need

  union all

  select '기입 누락'::text,
         format('%s %s일차: 자재를 기록하지 않고 마감함 - 사유 "%s"',
                o.code, pr.day_no, pr.no_material_reason),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
   where pr.work_order_id = p_wo
     and pr.no_material_reason is not null
     and exists (select 1 from dmr_bom b where b.operation_id = pr.operation_id)

  union all

  select '기입 누락'::text,
         format('%s %s일차 %s: 종료 시각이 빈 채로 기록서가 발행됨',
                o.code, pr.day_no, u.full_name),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join app_user u on u.id = pr.worker_id
   where pr.work_order_id = p_wo
     and pr.ended_at is null
     and exists (select 1 from day_lock dl
                  where dl.work_order_id = pr.work_order_id
                    and dl.day_no = pr.day_no
                    and dl.worker_id = pr.worker_id)

  union all

  select '참조 불일치'::text,
         format('지정 원재료는 %s 인데 %s 가 투입됨 (%s)',
                spec.lot_no, ml.lot_no, o.code),
         pr.day_no, ml.lot_no
    from material_issue mi
    join process_record pr on pr.id = mi.process_record_id
    join dmr_operation o on o.id = pr.operation_id
    join material_lot ml on ml.id = mi.material_lot_id
    join item i on i.id = ml.item_id
    join work_order wo on wo.id = pr.work_order_id
    join material_lot spec on spec.id = wo.material_lot_id
   where pr.work_order_id = p_wo
     and i.type = 'RAW'
     and ml.id <> wo.material_lot_id

  union all

  select '수량 불일치'::text,
         format('%s: 예정 %s개, 재단 %s개',
                i.code, p.planned_qty, coalesce(x.made, 0)),
         null::int, i.code
    from work_order_plan p
    join item i on i.id = p.item_id
    left join (
      select pl.item_id, sum(pl.qty_produced)::int as made
        from product_lot pl where pl.work_order_id = p_wo group by pl.item_id
    ) x on x.item_id = p.item_id
   where p.work_order_id = p_wo
     and p.planned_qty is not null
     and exists (select 1 from product_lot pl where pl.work_order_id = p_wo)
     and coalesce(x.made, 0) <> p.planned_qty

  union all

  /* --- 9. 설비 사용일에 유효한 밸리데이션 없음 ---------------------------- */
  select '기한 경과'::text,
         format('%s %s일차 설비 %s: 사용일 %s 에 유효한 밸리데이션 없음%s',
                o.code, pr.day_no, pr.equipment_id,
                to_char(pr.work_date, 'YYYY-MM-DD'),
                coalesce(' (최근 만료 ' || to_char(v.last_until, 'YYYY-MM-DD') || ')', '')),
         pr.day_no, pr.equipment_id
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    left join lateral (
      select max(ev.valid_until) as last_until
        from equipment_validation ev
        join equipment e on e.id = ev.equipment_id
       where e.code = pr.equipment_id
    ) v on true
   where pr.work_order_id = p_wo
     and pr.equipment_id is not null
     and not exists (
       select 1 from equipment_validation ev
         join equipment e on e.id = ev.equipment_id
        where e.code = pr.equipment_id
          and ev.performed_on <= pr.work_date
          and ev.valid_until  >= pr.work_date)

  order by 3 nulls last, 1, 2
$$;

grant execute on function review_flags(uuid) to app_role;
