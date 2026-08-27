/* ---------------------------------------------------------------------------
   자재 투입 정정

   잘못 적은 투입을 고칠 길이 없었다. 지우는 것은 없고 (§1 "기록은 삭제되지
   않는다"), 그렇다고 틀린 채로 두면 재고도 기록도 어긋난 채 굳는다.

   종이에서 하는 것을 그대로 한다. 잘못 적은 줄은 지우지 않고 한 줄 긋고
   정정자와 사유를 적는다. 원래 값은 감사추적에 남고 종이에는 정정 사실이
   함께 찍힌다.

   두 가지 경우가 있고 다루는 방법이 다르다.

     수량이 틀림      그 줄의 수량을 고친다. 재고가 차액만큼 움직인다
     줄 자체가 잘못됨 원 로트로 반납한다 (§4.7). 줄은 남고 재고가 돌아온다

   수량을 0 으로 만들어 없앤 셈 치지 않는다. check (qty > 0) 이 막기도 하지만,
   0 인 투입 줄은 "안 넣었다"와 "넣었다가 물렀다"를 구분하지 못한다. 뒤엣것은
   반납으로 적어야 무슨 일이 있었는지 읽힌다.

   ── 언제까지 고칠 수 있나 ─────────────────────────────────────────────────
   인쇄해서 그 묶음이 잠기기 전까지다 (S04). 잠금은 이미 트리거가 막고 있으므로
   여기서 다시 만들지 않는다. 공정을 마감한 뒤라도 일차를 마감하기 전이면
   고칠 수 있다 - 자재를 더 넣는 것이 그때까지 되므로 고치는 것도 같아야 한다.
--------------------------------------------------------------------------- */

/* 왜 고쳤는지. 종이에 함께 찍힌다 */
alter table material_issue
  add column if not exists amend_reason text;

comment on column material_issue.amend_reason is
  '수량을 정정한 사유. 원래 값은 audit_log 에 남는다';

/* ---------------------------------------------------------------------------
   수량을 고치면 재고가 따라 움직인다

   0013 의 트리거는 insert 에만 걸려 있었다. 그대로 두고 수량만 고치면 재고가
   조용히 어긋난다. 응용에서 같이 고치게 두지 않고 DB 가 맡는다 - 응용 계층에서만
   맞춘 건 어느 경로로든 새면 끝이다 (§1).
--------------------------------------------------------------------------- */
create or replace function trg_mi_amend()
returns trigger language plpgsql as $fn$
declare v_left numeric; v_lot text; v_delta numeric;
begin
  if new.qty = old.qty then
    return new;
  end if;

  /* 로트를 바꿔 끼우지는 못한다. 그건 반납하고 다시 넣는 일이다 */
  if new.material_lot_id <> old.material_lot_id then
    raise exception '투입 로트는 바꿀 수 없습니다. 반납하고 다시 기록하십시오';
  end if;

  v_delta := new.qty - old.qty;          -- 늘면 양수, 줄면 음수

  select qty_available, lot_no into v_left, v_lot
    from material_lot where id = new.material_lot_id for update;

  if v_delta > 0 and v_left < v_delta then
    raise exception '로트 %의 잔여 수량(%)보다 많이 늘릴 수 없습니다 (추가 %)',
      v_lot, v_left, v_delta;
  end if;

  update material_lot
     set qty_available = qty_available - v_delta,
         status = case
           when qty_available - v_delta = 0 and status = 'AVAILABLE' then 'CONSUMED'
           when qty_available - v_delta > 0 and status = 'CONSUMED'  then 'AVAILABLE'
           else status end
   where id = new.material_lot_id;

  return new;
end $fn$;

drop trigger if exists material_issue_amend on material_issue;
create trigger material_issue_amend before update of qty, material_lot_id
  on material_issue for each row execute function trg_mi_amend();

/* ---------------------------------------------------------------------------
   정정과 반납

   현장에서 부른다. 사유를 반드시 받는다 - 사유 없는 정정은 나중에 읽는 사람이
   무슨 일이 있었는지 알 수 없다.

   누가 고칠 수 있는가는 그 기록을 적은 사람인지로 본다. 남의 기록을 대신 고치는
   길을 만들지 않는다. 역할은 빌려줄 수 있어도 기록은 못 빌린다.
--------------------------------------------------------------------------- */
create or replace function amend_material_issue(p_mi uuid, p_qty numeric, p_reason text)
returns void language plpgsql security definer as $$
declare v_worker uuid; v_me uuid;
begin
  v_me := current_user_id();
  if v_me is null then
    raise exception '로그인 정보가 없습니다';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '정정 사유를 입력해야 합니다';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception '수량은 0보다 커야 합니다. 투입을 무르려면 반납으로 기록하십시오';
  end if;

  select pr.worker_id into v_worker
    from material_issue mi join process_record pr on pr.id = mi.process_record_id
   where mi.id = p_mi;
  if v_worker is null then
    raise exception '투입 기록을 찾을 수 없습니다';
  end if;
  if v_worker <> v_me then
    raise exception '자기가 적은 투입만 정정할 수 있습니다';
  end if;

  update material_issue
     set qty = p_qty, amend_reason = btrim(p_reason)
   where id = p_mi;
end $$;

grant execute on function amend_material_issue(uuid, numeric, text) to app_role;

/*
 * 반납. 원 로트로 되돌린다 (§4.7 "반납은 원 로트로 복귀시킨다").
 * 투입 줄은 그대로 남고 그 옆에 반납이 붙는다.
 */
create or replace function return_material_issue(p_mi uuid, p_qty numeric, p_reason text)
returns uuid language plpgsql security definer as $$
declare v_worker uuid; v_me uuid; v_lot uuid; v_wo uuid; v_issued numeric; v_id uuid;
begin
  v_me := current_user_id();
  if v_me is null then
    raise exception '로그인 정보가 없습니다';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '반납 사유를 입력해야 합니다';
  end if;

  select pr.worker_id, mi.material_lot_id, pr.work_order_id, mi.qty
    into v_worker, v_lot, v_wo, v_issued
    from material_issue mi join process_record pr on pr.id = mi.process_record_id
   where mi.id = p_mi;
  if v_worker is null then
    raise exception '투입 기록을 찾을 수 없습니다';
  end if;
  if v_worker <> v_me then
    raise exception '자기가 적은 투입만 반납할 수 있습니다';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > v_issued then
    raise exception '반납 수량은 0보다 크고 투입 수량(%) 이하여야 합니다', v_issued;
  end if;

  insert into stock_movement
    (material_lot_id, type, qty, work_order_id, reason_code, reason_detail, registered_by)
  values
    (v_lot, 'RETURN', p_qty, v_wo, '계량오차', btrim(p_reason), v_me)
  returning id into v_id;

  return v_id;
end $$;

grant execute on function return_material_issue(uuid, numeric, text) to app_role;
