/* ===========================================================================
   0165 · 관리자 강제 투입 (사용자 2026-11-25)

   "PBS 제조기록서 작성해서 채웠고 첫 배치에서 일부 사용했는데 아직도 왜 잔여가 5L 임?"
   "알칼리 처리에서 0.8L 처리한 기록 있고 세척에서 0.8L 처리한 기록 있잖아. 연결이 되어야 할거 같다"
   "강제로 투입을 더하는 형태로 수정해줘. 그리고 실제로 0.8L 선택하면 재고에서 줄어드는지도 확인이 필요함."

   종이 스캔본을 옮겨 적을 때 기록서 칸에만 «L261105-01 · 0.8 L» 이 들어가고 투입(material_issue)이
   없으면 원액 잔여가 줄지 않는다. 그 일차가 이미 인쇄되었으면 S04 가 투입을 막는다.

     force_material_issue(기록, 자재 로트, 수량, 사유)  생산관리자 · 시스템관리자, 사유 필수.
       잠긴 일차여도 투입 한 줄만 연다 (app.force_issue 는 security definer 안에서만 믿는다 - 0128 · 0155 와 같은 길).
       재고 차감 · 유효기한 등 다른 장치는 그대로 돈다. 막는 것은 S04 하나만 연다.
     material_issue.forced   강제 투입 줄. 인쇄 자료(lib/print-payload)에는 넣지 않는다 -
                             이미 나간 종이의 자료 식별자가 그대로여야 한다.
     record_correction 'material_issue' 줄 (이전 «(없음)» → 품목코드 로트번호 수량 사용단위 · 사유 · 고친 사람)
=========================================================================== */

alter table material_issue add column if not exists forced boolean not null default false;
comment on column material_issue.forced is
  '관리자 강제 투입 (0165). 인쇄된 종이의 자료 식별자에는 넣지 않는다';

alter table record_correction drop constraint if exists record_correction_field_check;
alter table record_correction add constraint record_correction_field_check
  check (field in ('no_material_reason', 'day_no', 'work_date', 'started_at', 'ended_at', 'br_entry',
                   'material_issue'));

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
    /* 관리자 강제 투입 (0165). force_material_issue 가 그 기록 하나에 투입 한 줄을 넣을 때만 (insert 만) */
    if tg_table_name = 'material_issue' and tg_op = 'INSERT' then
      if current_setting('app.force_issue', true) = new.process_record_id::text
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

create or replace function force_material_issue(p_pr uuid, p_lot uuid, p_qty numeric, p_why text)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  v_why   text := btrim(coalesce(p_why, ''));
  v_id    uuid;
  v_item  uuid;
  v_label text;
  r       record;
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if not exists (select 1 from user_role
                  where user_id = v_actor and role in ('PROD_MGR', 'SYS_ADMIN')) then
    raise exception '투입 정정은 생산관리자 또는 시스템관리자가 합니다';
  end if;
  if v_why = '' then
    raise exception '왜 더하는지 적으십시오';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception '수량은 0 보다 커야 합니다';
  end if;
  select work_order_id, day_no, worker_id, operation_id into r
    from process_record where id = p_pr;
  if not found then
    raise exception '공정 기록을 찾을 수 없습니다';
  end if;
  select ml.item_id, i.code || ' ' || ml.lot_no || ' '
         || rtrim(to_char(p_qty, 'FM999999990.999'), '.') || ' ' || i.usage_uom
    into v_item, v_label
    from material_lot ml join item i on i.id = ml.item_id
   where ml.id = p_lot;
  if v_item is null then
    raise exception '자재 로트를 찾을 수 없습니다';
  end if;
  if not exists (select 1 from dmr_bom b
                  where b.operation_id = r.operation_id and b.component_item_id = v_item) then
    raise exception '이 공정의 자재 구성표에 없는 자재입니다';
  end if;

  perform set_config('app.change_reason', '투입 정정 · ' || v_why, true);
  perform set_config('app.force_issue', p_pr::text, true);
  insert into material_issue (process_record_id, material_lot_id, qty, issued_by, forced)
  values (p_pr, p_lot, p_qty, v_actor, true)
  returning id into v_id;
  perform set_config('app.force_issue', '', true);

  insert into record_correction (process_record_id, field, old_value, new_value, why, corrected_by, before_close)
  values (p_pr, 'material_issue', '(없음)', v_label, v_why, v_actor,
          not is_locked(r.work_order_id, r.day_no, r.worker_id));
  return v_id;
end $fn$;
comment on function force_material_issue(uuid, uuid, numeric, text) is
  '생산관리자 · 시스템관리자가 투입 한 줄을 사유와 함께 더한다. 잠긴 일차여도 (0165)';

revoke all on function force_material_issue(uuid, uuid, numeric, text) from public;
grant execute on function force_material_issue(uuid, uuid, numeric, text) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke execute on function force_material_issue(uuid, uuid, numeric, text) from app_readonly';
  end if;
end $$;
