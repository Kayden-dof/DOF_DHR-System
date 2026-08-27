/* ---------------------------------------------------------------------------
   문구를 전문 용어로 맞춘다

   DB 가 올리는 예외 문구는 화면에 그대로 나간다 (§1 - 응용 계층이 다시 쓰지
   않고 받은 문장을 그대로 보인다). 그래서 이 문장들도 화면 문구이며, 화면과
   같은 어투를 써야 한다.

   고치는 것은 어투뿐이다. 조건도, 막는 대상도, 앞머리 표시(S05 등)도 그대로
   둔다. 시험이 앞머리로 짝을 맞추므로 그 부분을 건드리면 OQ 각본이 흔들린다.

     "입력하세요"        → "입력하십시오"     화면은 전부 하십시오체다
     "적어야 합니다"     → "입력해야 합니다"
     "고치지 않습니다"   → "수정하지 않습니다"
     "적을 수 있습니다"  → "기록할 수 있습니다"
     "넣을 수 있습니다"  → "지정할 수 있습니다"

   함수 본문은 바꾸지 않고 통째로 다시 선언한다. 한 줄만 고치는 방법이 없다.
--------------------------------------------------------------------------- */

/* --- S05 · 자재 미기록 시 마감 불가 (0014) -------------------------------- */
create or replace function complete_process(p_pr uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_wo uuid; v_op uuid; v_reason text; missing text;
begin
  select work_order_id, operation_id, no_material_reason
    into v_wo, v_op, v_reason
    from process_record where id = p_pr for update;

  if not found then
    raise exception '공정 기록을 찾을 수 없습니다';
  end if;

  if v_reason is null then
    select string_agg(i.name, ', ') into missing
      from dmr_bom b join item i on i.id = b.component_item_id
     where b.operation_id = v_op
       and not exists (
         select 1 from material_issue mi
           join material_lot ml on ml.id = mi.material_lot_id
          where mi.process_record_id = p_pr
            and ml.item_id = b.component_item_id);

    if missing is not null then
      raise exception 'S05: 자재가 기록되지 않았습니다 (%). 기록하거나 해당없음 사유를 입력하십시오', missing;
    end if;
  end if;

  update process_record set ended_at = coalesce(ended_at, now()) where id = p_pr;

  update work_order set status = 'IN_PROCESS'
   where id = v_wo and status = 'ISSUED';
end $fn$;

grant execute on function complete_process(uuid) to app_role;

/* --- 예정 형명은 완제품만 (0019) ------------------------------------------ */
create or replace function trg_wo_plan_fin()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from item i where i.id = new.item_id and i.type = 'FIN') then
    raise exception '예정 형명에는 완제품만 지정할 수 있습니다';
  end if;
  return new;
end $$;

/* --- 현장 재단 기록 (0036) ------------------------------------------------ */
create or replace function cut_product_lot_field(
  p_wo uuid, p_item uuid, p_produced int, p_sample int, p_made_on date
) returns uuid language plpgsql security definer as $$
declare v_op uuid; v_dm uuid; v_me uuid;
begin
  v_me := current_user_id();
  if v_me is null then
    raise exception '로그인 정보가 없습니다';
  end if;

  select device_master_id into v_dm from work_order where id = p_wo;
  if v_dm is null then
    raise exception '작업 지시를 찾을 수 없습니다';
  end if;

  v_op := cut_operation_id(v_dm);
  if v_op is null then
    raise exception '이 제품에는 재단 공정이 없습니다';
  end if;

  if not exists (
    select 1 from process_record pr
     where pr.work_order_id = p_wo
       and pr.operation_id = v_op
       and pr.worker_id = v_me
  ) then
    raise exception '재단 공정을 시작한 뒤에 재단 결과를 기록할 수 있습니다';
  end if;

  return cut_product_lot(p_wo, p_item, p_produced, p_sample, p_made_on);
end $$;

grant execute on function cut_product_lot_field(uuid, uuid, int, int, date) to app_role;

/* --- 인쇄물 회수 (0021) --------------------------------------------------- */
create or replace function retrieve_print(p_print uuid, p_reason text)
returns record_print
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_row record_print;
begin
  if current_user_id() is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '회수 사유를 입력해야 합니다';
  end if;

  select * into v_row from record_print where id = p_print for update;
  if not found then
    raise exception '인쇄 기록을 찾을 수 없습니다';
  end if;
  if v_row.retrieved_at is not null then
    raise exception '이미 회수로 기록된 인쇄물입니다 (%). 기록은 수정하지 않습니다',
      to_char(timezone('Asia/Seoul', v_row.retrieved_at), 'YYYY-MM-DD HH24:MI');
  end if;

  update record_print
     set retrieved_at = now(), retrieve_reason = btrim(p_reason)
   where id = p_print
   returning * into v_row;

  return v_row;
end $fn$;

grant execute on function retrieve_print(uuid, text) to app_role;
