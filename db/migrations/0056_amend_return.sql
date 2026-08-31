/* ---------------------------------------------------------------------------
   주석이 약속한 차단을 실제로 건다 (2차 검수 결함 5 · 6)

   두 함수의 주석이 단언한 것이 코드에 없거나 닿지 않는 자리에 있었다.
   설계가 틀린 것이 아니라 한 줄이 빠져 있었다. 문서를 읽고 안심한 사람이
   실물을 확인하지 않으면 그대로 통과한다.
--------------------------------------------------------------------------- */


/* === 1. 로트 교체 검사가 조기 반환보다 앞에 온다 (결함 5) =============== */
/*
 * trg_mi_amend 는 "로트를 바꿔 끼우지는 못한다" 고 적고 그 거부문을 두었는데,
 * "수량이 그대로면 그냥 통과" 라는 줄이 그보다 앞에 있었다. 수량을 손대지
 * 않은 채 로트만 바꾸면 함수가 먼저 나가 버려 검사에 닿지 않는다.
 *
 * 실제로 종이에 적힌 것과 다른 로트로 계보를 통째로 옮길 수 있었고, 그 사실이
 * 재고에도 정정 사유에도 남지 않았다. 동물유래물질 추적이 요구되는 품목이다.
 *
 * 순서만 바꾼다. 하던 일은 그대로다.
 */
create or replace function trg_mi_amend()
returns trigger language plpgsql as $fn$
declare v_left numeric; v_lot text; v_delta numeric;
begin
  /*
   * 이 검사가 맨 앞이다. 수량을 보기 전에 본다 - 수량이 그대로여도 로트가
   * 바뀌면 그건 다른 자재를 넣었다는 말이고, 정정이 아니라 다른 사건이다.
   */
  if new.material_lot_id is distinct from old.material_lot_id then
    raise exception '투입 로트는 바꿀 수 없습니다. 반납하고 다시 기록하십시오';
  end if;
  if new.process_record_id is distinct from old.process_record_id then
    raise exception '투입 기록을 다른 공정으로 옮길 수 없습니다';
  end if;

  if new.qty = old.qty then
    return new;
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

/* 위 트리거는 UPDATE OF qty 로 걸려 있었다. 로트만 바꾸면 아예 돌지 않았다 */
drop trigger if exists material_issue_amend on material_issue;
create trigger material_issue_amend before update on material_issue
  for each row execute function trg_mi_amend();


/* === 2. 반납은 투입한 만큼까지만 (결함 6) =============================== */
/*
 * 검사가 "이번 반납량 ≤ 투입 수량" 하나뿐이었다. 반납은 투입 줄을 건드리지
 * 않고 재고 증감에 행을 더할 뿐이라, 비교 대상이 몇 번을 불러도 그대로다.
 * 같은 호출을 반복하면 매번 통과하고 그때마다 잔여 수량이 올라갔다.
 * 투입 2개짜리 기록에서 8개가 돌아오는 것을 확인했다.
 *
 * 재고를 늘리는 방향이라 음수 방지 검사에도 걸리지 않는다. 현장에서 흔한
 * 두 번 누르기로도 같은 결과가 나온다.
 *
 * ── 어떻게 세는가 ─────────────────────────────────────────────────────────
 * stock_movement 에는 어느 투입 줄에서 나온 반납인지가 적혀 있지 않았다.
 * 컬럼을 하나 더한다. 없으면 "이 투입에 대해 얼마나 돌아왔는가" 를 물을 수
 * 없고, 물을 수 없으면 셀 수도 없다.
 *
 * ── 잠긴 뒤에는 반납도 막는다 ─────────────────────────────────────────────
 * 0041 은 정정과 반납을 함께 설명하며 "잠금은 이미 트리거가 막고 있으므로
 * 여기서 다시 만들지 않는다" 고 적었다. 그런데 S04 트리거는 process_record 와
 * material_issue 에만 걸려 있고 stock_movement 에는 없다. 그 진술이 반납에는
 * 성립하지 않았다.
 *
 * 손에 든 제조기록서에는 자재 2개 투입으로 찍혀 있는데 시스템 재고는 그 2개가
 * 돌아온 상태가 되면, 편철 표지와 일차 기록서가 서로 다른 이야기를 한다.
 */
alter table stock_movement
  add column if not exists material_issue_id uuid references material_issue(id);

comment on column stock_movement.material_issue_id is
  '반납이 어느 투입 줄에서 나왔는가. 누적 반납량을 세는 근거';

create index if not exists stock_movement_issue_idx
  on stock_movement (material_issue_id) where material_issue_id is not null;

create or replace function return_material_issue(p_mi uuid, p_qty numeric, p_reason text)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_worker uuid; v_me uuid; v_lot uuid; v_wo uuid;
  v_issued numeric; v_back numeric; v_day int; v_id uuid;
begin
  v_me := current_user_id();
  if v_me is null then
    raise exception '로그인 정보가 없습니다';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '반납 사유를 입력해야 합니다';
  end if;

  select pr.worker_id, mi.material_lot_id, pr.work_order_id, mi.qty, pr.day_no
    into v_worker, v_lot, v_wo, v_issued, v_day
    from material_issue mi join process_record pr on pr.id = mi.process_record_id
   where mi.id = p_mi;
  if v_worker is null then
    raise exception '투입 기록을 찾을 수 없습니다';
  end if;
  if v_worker <> v_me then
    raise exception '자기가 적은 투입만 반납할 수 있습니다';
  end if;

  /* 인쇄해서 잠긴 묶음은 정정도 반납도 하지 않는다 (§5 "잠금 해제 함수는 없다") */
  if is_locked(v_wo, v_day, v_worker) then
    raise exception
      'S04: 인쇄 완료된 기록은 수정할 수 없습니다. 다음 일차에 정정 기록으로 남기십시오';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception '반납 수량은 0보다 커야 합니다';
  end if;

  /* 이 투입 줄에서 이미 돌아간 양. 이것을 세지 않아 재고가 부풀었다 */
  select coalesce(sum(qty), 0) into v_back
    from stock_movement
   where material_issue_id = p_mi and type = 'RETURN';

  if v_back + p_qty > v_issued then
    raise exception
      '투입 수량(%)보다 많이 반납할 수 없습니다. 이미 반납한 양 %, 이번 요청 %',
      v_issued, v_back, p_qty;
  end if;

  insert into stock_movement
    (material_lot_id, type, qty, work_order_id, material_issue_id,
     reason_code, reason_detail, registered_by)
  values
    (v_lot, 'RETURN', p_qty, v_wo, p_mi, '계량오차', btrim(p_reason), v_me)
  returning id into v_id;

  return v_id;
end $fn$;

revoke execute on function return_material_issue(uuid, numeric, text) from public;
revoke execute on function return_material_issue(uuid, numeric, text) from app_readonly;
grant  execute on function return_material_issue(uuid, numeric, text) to app_role;


/* === 3. 서명이 들어간 값은 한 번만 적는다 (결함 5) ====================== */
/*
 * 0052 는 막아야 할 것을 "이미 발행되어 서명까지 들어간 종이가 가리키는 값"
 * 으로 정의해 놓고, 그 정의에 가장 정확히 들어맞는 것들을 목록에서 뺐다.
 *
 *   release_approved_by · release_approved_on  품질책임자 서면 승인
 *   steril_batch.cert_no                       멸균 성적서 번호
 *   material_lot.coa_no · supplier_lot_no      S02 가 필수로 받은 값
 *
 * 출고까지 끝난 로트의 승인자와 승인 일자를 다른 이름 · 다른 날짜로 바꿀 수
 * 있었다. 실사에서 종이와 화면이 어긋나면 왜 달라졌는지 설명할 수 없다.
 *
 * 빈 값에서 값으로 가는 것만 허용한다. 승인은 한 번 일어나는 일이고, 오기가
 * 있으면 그 로트를 승인하지 않은 것으로 두고 다시 승인받는 것이 맞다.
 */
create or replace function trg_once_written()
returns trigger language plpgsql as $fn$
declare col text; oldv text; newv text;
begin
  foreach col in array tg_argv loop
    oldv := to_jsonb(old) ->> col;
    newv := to_jsonb(new) ->> col;
    if oldv is not null and newv is distinct from oldv then
      raise exception '%(은)는 한 번 적으면 고칠 수 없습니다 (전 값 %)', col, oldv;
    end if;
  end loop;
  return new;
end $fn$;

drop trigger if exists product_lot_release_once on product_lot;
create trigger product_lot_release_once before update on product_lot
  for each row execute function trg_once_written('release_approved_by', 'release_approved_on');

drop trigger if exists steril_batch_cert_once on steril_batch;
create trigger steril_batch_cert_once before update on steril_batch
  for each row execute function trg_once_written('cert_no', 'request_no', 'batch_no');

drop trigger if exists material_lot_coa_once on material_lot;
create trigger material_lot_coa_once before update on material_lot
  for each row execute function trg_once_written(
    'lot_no', 'coa_no', 'coa_date', 'supplier_lot_no', 'supplier_id',
    'item_id', 'qty_received', 'thickness_band');


/* === 4. 회수 기록은 되돌리지 않는다 (결함 5) ============================ */
/*
 * 0021 은 회수를 "되돌릴 수 없다" 고 단정했는데, 0052 의 불변 트리거가
 * retrieved_at 과 retrieve_reason 을 검사에서 명시적으로 뺐다. 회수를 위한
 * 자리를 열어 둔 것인데, 열어 둔 김에 지우는 것도 열려 있었다.
 *
 * 회수한 종이가 회수되지 않은 것으로 되돌아가면 인쇄물 조회가 검토자에게
 * 사실과 다르게 답한다.
 */
create or replace function trg_print_immutable()
returns trigger language plpgsql as $fn$
begin
  if new.data_hash   is distinct from old.data_hash
  or new.printed_by  is distinct from old.printed_by
  or new.printed_at  is distinct from old.printed_at
  or new.seq         is distinct from old.seq
  or new.kind        is distinct from old.kind
  or new.pages       is distinct from old.pages then
    raise exception '인쇄 기록은 고칠 수 없습니다. 회수 사유만 남길 수 있습니다';
  end if;

  /* 회수는 한 방향이다. 적을 수는 있고 지울 수는 없다 */
  if old.retrieved_at is not null
     and (new.retrieved_at is null or new.retrieved_at <> old.retrieved_at) then
    raise exception '회수 기록은 되돌릴 수 없습니다 (회수 %)',
      to_char(timezone('Asia/Seoul', old.retrieved_at), 'YYYY-MM-DD HH24:MI');
  end if;

  return new;
end $fn$;
