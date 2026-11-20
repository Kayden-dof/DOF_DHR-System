/* ===========================================================================
   0155 · 관리자 기록서 정정 · «-» 사용 안 함은 기입 누락이 아니다 (사용자 2026-11-20)

   "관리자는 수정할수 있게 열어줘 기능을..;; 틀린걸 알려주는건 좋은데 관리자는 수정 기록할수있게 열어줘.."
   "이부분은 내가 - 사용안함으로 기록한건데 기록누락이라고 말하면 어떻게 하니?"

   ── 1. 관리자 기록서 정정 ─────────────────────────────────────────────────
   일차를 마감(인쇄)하면 그 기록서 칸은 S04 가 막는다. 확인해 볼 항목이 틀린 칸을 짚어도 고칠 길이
   없었다. force_br_entry(기록, 양식, 칸, 값, 사유[, 칸 이름]) - 생산관리자 · 시스템관리자, 사유 필수.
   잠긴 일차여도 그 칸 하나만 연다 (app.force_br 는 security definer 안에서만 믿는다 - 0128 과 같은 길).
     br_entry.forced  관리자 정정 줄. 칸 값은 이것이 이기되, 기록서가 그 줄의 작업(검사)자 · 일자를
                      정정한 사람으로 바꾸지 않는다 (lib/br-form rowEntered)
     record_correction 'br_entry' 줄 (칸 이름 · 이전 값 → 새 값 · 사유 · 고친 사람), 감사추적에 사유.
   서명 칸의 종류(sign)는 그대로 둔다 (0140).

   ── 2. 기입 누락 ─────────────────────────────────────────────────────────
   기록서 자재 칸에 «-»(사용 안 함)로 적고 마감하면 사유가 «사용 안 함 · …» 로 남는다. 그것은 적지 않은
   것이 아니라 쓰지 않았다고 적은 것이다 - 확인해 볼 항목의 «자재를 기록하지 않고 마감함» 에서 뺀다.
   review_flags_base 는 0154 그대로이고 그 한 조건만 늘었다.
=========================================================================== */

/* === 1. 관리자 기록서 정정 ============================================== */
alter table br_entry add column if not exists forced boolean not null default false;
comment on column br_entry.forced is
  '관리자 정정 줄 (0155). 칸 값은 이것이 이기되, 그 줄의 작업(검사)자 · 일자는 바꾸지 않는다';

alter table record_correction drop constraint if exists record_correction_field_check;
alter table record_correction add constraint record_correction_field_check
  check (field in ('no_material_reason', 'day_no', 'work_date', 'started_at', 'ended_at', 'br_entry'));

create or replace function trg_s04_locked()
returns trigger language plpgsql as $fn$
declare wo uuid; d int; w uuid; bn text;
begin
  if tg_table_name = 'process_record' then
    wo := coalesce(new.work_order_id, old.work_order_id);
    d  := coalesce(new.day_no, old.day_no);
    w  := coalesce(new.worker_id, old.worker_id);
  else
    select pr.work_order_id, pr.day_no, pr.worker_id into wo, d, w
      from process_record pr
     where pr.id = coalesce(new.process_record_id, old.process_record_id);
  end if;

  if is_locked(wo, d, w) then
    /*
     * 강제 정정 (0128). force_correct_reason 이 그 기록 하나에 대해서만 연다.
     * 표시(app.force_correct)는 누구나 걸 수 있으므로, 실행 주체가 app_role ·
     * app_readonly 가 아닐 때 - 곧 security definer 함수 안일 때 - 만 믿는다.
     * 화면 코드가 표시를 걸고 직접 고치는 길은 그래서 열리지 않는다.
     */
    if tg_table_name = 'process_record'
       and current_setting('app.force_correct', true) = new.id::text
       and current_user not in ('app_role', 'app_readonly') then
      return new;
    end if;
    /* 관리자 기록서 정정 (0155). force_br_entry 가 그 기록 하나의 칸에 대해서만 연다 */
    /* process_record 에는 process_record_id 가 없다 - 표를 먼저 갈라야 NEW 의 열을 읽는다 */
    if tg_table_name = 'br_entry' then
      if current_setting('app.force_br', true) = new.process_record_id::text
         and current_user not in ('app_role', 'app_readonly') then
        return new;
      end if;
    end if;
    select batch_no into bn from work_order where id = wo;
    raise exception 'S04: 인쇄 완료된 기록은 수정할 수 없습니다 (배치 %, %일차)',
      coalesce(bn, wo::text), d;
  end if;
  return new;
end $fn$;

create or replace function force_br_entry(
  p_pr uuid, p_doc uuid, p_field text, p_value text, p_why text, p_label text default null)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  v_why   text := btrim(coalesce(p_why, ''));
  v_val   text := coalesce(p_value, '');
  v_old   text;
  r       record;
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if not exists (select 1 from user_role
                  where user_id = v_actor and role in ('PROD_MGR', 'SYS_ADMIN')) then
    raise exception '기록서 정정은 생산관리자 또는 시스템관리자가 합니다';
  end if;
  if v_why = '' then
    raise exception '왜 고치는지 적으십시오';
  end if;
  if coalesce(p_field, '') !~ '^p[0-9]+t[0-9]+r[0-9]+c[0-9]+$' then
    raise exception '칸 자리가 올바르지 않습니다';
  end if;
  select work_order_id, day_no, worker_id into r from process_record where id = p_pr;
  if not found then
    raise exception '공정 기록을 찾을 수 없습니다';
  end if;
  if not exists (select 1 from mfg_doc where id = p_doc and kind = 'BR') then
    raise exception '제조기록서 양식을 찾을 수 없습니다';
  end if;
  select value into v_old from br_entry
   where process_record_id = p_pr and doc_id = p_doc and field = p_field;
  if coalesce(v_old, '') = v_val then
    raise exception '지금 값과 같습니다';
  end if;

  perform set_config('app.change_reason', '기록서 정정 · ' || v_why, true);
  perform set_config('app.force_br', p_pr::text, true);
  insert into br_entry (process_record_id, doc_id, field, value, entered_by, why, forced)
  values (p_pr, p_doc, p_field, v_val, v_actor, v_why, true)
  on conflict (process_record_id, doc_id, field)
    do update set value = excluded.value, why = excluded.why, forced = true;
  perform set_config('app.force_br', '', true);

  insert into record_correction (process_record_id, field, old_value, new_value, why, corrected_by, before_close)
  values (p_pr, 'br_entry',
          coalesce(nullif(btrim(coalesce(p_label, '')), ''), p_field) || ' · ' || coalesce(nullif(v_old, ''), '(빈 칸)'),
          coalesce(nullif(v_val, ''), '(빈 칸)'),
          v_why, v_actor, not is_locked(r.work_order_id, r.day_no, r.worker_id));
end $fn$;
comment on function force_br_entry(uuid, uuid, text, text, text, text) is
  '생산관리자 · 시스템관리자가 기록서 칸 하나를 사유와 함께 고친다. 잠긴 일차여도 (0155)';

revoke all on function force_br_entry(uuid, uuid, text, text, text, text) from public;
grant execute on function force_br_entry(uuid, uuid, text, text, text, text) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke execute on function force_br_entry(uuid, uuid, text, text, text, text) from app_readonly';
  end if;
end $$;


/* === 2. «-» 사용 안 함은 기입 누락이 아니다 ============================== */
create or replace function review_flags_base(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable as $$

  select distinct '시각 모순'::text,
         format('%s(%s) %s일차 %s: 시작 %s, 종료 %s - 시각이 역전되어 있음',
                o.name, o.code, pr.day_no, u.full_name,
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
         format('%s%s(%s) 종료 %s 보다 %s(%s) 시작 %s 가 빠름',
                coalesce(pl.lot_no || ' ', ''),
                a.name, a.code, to_char(timezone('Asia/Seoul', pa.ended_at),  'MM-DD HH24:MI'),
                b.name, b.code, to_char(timezone('Asia/Seoul', pb.started_at),'MM-DD HH24:MI')),
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
         format('%s(%s) %s: 장입 %s장 기준 %s %s 인데 %s %s 기입',
                o.name, o.code, i.name, wo.sheet_count,
                trim(to_char(x.need, 'FM999999990.###'))
                  || case when x.need_max > x.need
                          then '~' || trim(to_char(x.need_max, 'FM999999990.###')) else '' end,
                i.usage_uom,
                trim(to_char(x.put,  'FM999999990.###')), i.usage_uom),
         pr.day_no, o.code
    from (
      /* 투입 - 반납 (0154). 반납은 stock_movement 의 RETURN 줄이다 (0041 · 0056) */
      select pr2.id as pr_id, ml2.item_id,
             sum(mi2.qty - coalesce((select sum(sm.qty) from stock_movement sm
                                      where sm.material_issue_id = mi2.id and sm.type = 'RETURN'), 0)) as put,
             required_qty(pr2.operation_id, ml2.item_id, wo2.sheet_count, 0) as need,
             required_qty_max(pr2.operation_id, ml2.item_id, wo2.sheet_count) as need_max
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
     and (x.put < x.need or x.put > coalesce(x.need_max, x.need))

  union all

  select '기입 누락'::text,
         format('%s(%s) %s일차: 자재를 기록하지 않고 마감함 - 사유 "%s"',
                o.name, o.code, pr.day_no, pr.no_material_reason),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
   where pr.work_order_id = p_wo
     and pr.no_material_reason is not null
     /* 기록서에 «-»(사용 안 함)로 적은 자재는 적지 않은 것이 아니다 (0155) */
     and pr.no_material_reason not like '사용 안 함 · %'
     /* 로트 없이 쓰는 소모품만 걸린 공정은 적을 자재가 없다 (0129) */
     and exists (select 1 from dmr_bom b join item bi on bi.id = b.component_item_id
                  where b.operation_id = pr.operation_id and bi.lot_tracked)

  union all

  select '기입 누락'::text,
         format('%s(%s) %s일차 %s: 종료 시각이 빈 채로 기록서가 발행됨',
                o.name, o.code, pr.day_no, u.full_name),
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
         format('지정 원재료는 %s 인데 %s 가 투입됨 (%s · %s)',
                spec.lot_no, ml.lot_no, o.name, o.code),
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

  /* --- 8. 예정 개수와 재단 개수가 다름 (형명별이 아니라 총량) ------------- */
  select '수량 불일치'::text,
         format('예정 %s개, 재단 %s개', wo.planned_units, x.made),
         null::int, wo.batch_no
    from work_order wo
    join (
      select work_order_id, sum(qty_produced)::int as made
        from product_lot where work_order_id = p_wo group by work_order_id
    ) x on x.work_order_id = wo.id
   where wo.id = p_wo
     and wo.planned_units is not null
     and x.made <> wo.planned_units
$$;

grant execute on function review_flags_base(uuid) to app_role;

grant execute on function review_flags_base(uuid) to app_role;
