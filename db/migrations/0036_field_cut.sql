/* ---------------------------------------------------------------------------
   재단을 현장에서 기록한다

   지금까지 제조번호 부여가 관리자 화면에만 있었다. 그런데 재단은 현장에서
   일어난다. 작업자가 잘라서 세고, 그 수를 관리자에게 말로 넘기면 관리자가
   책상에서 다시 두들겼다. 한 번 일어난 일을 두 사람이 두 번 적는 구조다
   (사용자 지적). 옮겨 적는 자리마다 틀릴 자리가 하나씩 생긴다.

   재단한 사람이 재단한 자리에서 적는다. 관리자 화면의 입력은 남겨 둔다 -
   현장에서 빠뜨린 형명을 나중에 채우는 길이 있어야 하고, 그것까지 없애면
   빠뜨린 순간 되돌릴 방법이 사라진다.

   ── 누가 적을 수 있나 ─────────────────────────────────────────────────────
   그 배치의 재단 공정을 지금 기록하고 있는 사람만 적을 수 있다. 재단하지 않은
   사람이 재단 결과를 적는 일을 구조로 막는다. 역할로 막지 않고 "그 사람이 그
   공정을 시작했는가"로 막는다 - 역할은 빌려줄 수 있지만 기록은 못 빌린다.

   이건 S01~S05 에 더하는 차단이 아니다. 그 다섯은 사후 복구가 불가능한
   항목이고, 이건 "누가 무엇을 적을 수 있는가"라는 권한 문제다.
--------------------------------------------------------------------------- */

/* --- 완제품검사 샘플 수량 -------------------------------------------------
   WS-07 에서 완제품검사 샘플을 뽑는다. 몇 개를 뽑는지는 검사 기준이 정하고,
   시스템은 그 값을 제품표준서에 받아 두었다가 현장에 그대로 보여 준다.
   시스템이 정하지 않는다 (§1). 비어 있으면 아무것도 안내하지 않는다.
-------------------------------------------------------------------------- */
alter table device_master
  add column if not exists sample_per_lot int check (sample_per_lot >= 0);

comment on column device_master.sample_per_lot is
  '완제품검사 샘플 수량 (제조번호 1건당). 검사 기준에서 옮겨 적는다';

/* --- 재단 공정 찾기 -------------------------------------------------------
   재단은 "재단 이전 공정 가운데 마지막"이다. 이름으로 찾지 않는다 - 품목이
   늘면 이름이 달라진다. 재단 이후 공정이 하나도 없는 품목이면 분기 자체가
   없으므로 재단 공정도 없다 (§12).
-------------------------------------------------------------------------- */
create or replace function cut_operation_id(p_dm uuid)
returns uuid language sql stable as $$
  select o.id
    from dmr_operation o
   where o.device_master_id = p_dm
     and not o.after_cutting
     and exists (select 1 from dmr_operation a
                  where a.device_master_id = p_dm and a.after_cutting)
   order by o.seq desc
   limit 1
$$;

grant execute on function cut_operation_id(uuid) to app_role;

/* --- 현장 재단 기록 -------------------------------------------------------
   기존 cut_product_lot() 을 그대로 쓰되, 부르기 전에 "이 사람이 이 배치의
   재단 공정을 기록하고 있는가"를 본다. 채번도 유효기한 고정도 아래가 한다.
-------------------------------------------------------------------------- */
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
    raise exception '재단 공정을 시작한 뒤에 재단 결과를 적을 수 있습니다';
  end if;

  return cut_product_lot(p_wo, p_item, p_produced, p_sample, p_made_on);
end $$;

grant execute on function cut_product_lot_field(uuid, uuid, int, int, date) to app_role;
