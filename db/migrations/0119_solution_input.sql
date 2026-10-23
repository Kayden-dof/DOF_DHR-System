/* ---------------------------------------------------------------------------
   원액 로트가 원료 로트에서 선다 - 원료 줄 · 원액 제조 함수
   (사용자 결정 2026-10-23 · 0117 · 0118 에서 이어짐)
   근거 CLAUDE.md §1 · §2 · §2.1 · §4.4 · §4.7 · §10

   ── 0118 이 남긴 것 ──────────────────────────────────────────────────
   0118 은 원액을 자재 로트 한 줄로 세우고 S02 를 두 갈래로 나눴다. 원액
   로트는 성적서 · 공급자 칸이 비고 제조일이 있다. 그 대신 **원료 로트
   없이는 원액 로트가 서지 않아야** 하는데, 원료 줄이 아직 없어서 그 검사는
   이 파일에서 건다.

   ── 원료 줄은 새 표가 아니다 ───────────────────────────────────────
   어느 원료 로트에서 얼마를 꺼내 어느 원액으로 갔는가는 stock_movement 의
   SOLUTION 줄이 이미 담고 있다. 차감(trg_sm_apply) · 감사추적 · 삭제 금지가
   그 표에 걸려 있고 재고 원장이 그 표를 센다. 같은 사실을 다른 표에 또
   적으면 갈라진다 (§10). 그래서 칸 하나만 더한다 - solution_lot_id.

   ── 무엇을 거부하는가 (판정이 아니다, §1) ─────────────────────────
   원액이 쓸 만한지, 처방이 맞는지는 묻지 않는다. 묻는 것은 **이어져 있는가**
   와 **이미 적힌 이음을 고쳐 쓰는가** 뿐이다.

     T1  원료 줄이 하나도 없는 원액 로트        커밋 때 (S02 의 원액 갈래)
     T3  원료 줄이 원액 로트를 안 가리킴 · 원액이 아닌 로트를 가리킴 ·
         다른 유형의 줄이 원액을 가리킴 · 되돌림이 그 원액에서 꺼낸 양을
         넘거나 꺼낸 적 없는 원료를 가리킴      줄을 넣을 때 (S01 의 짝)
     T5  원료 줄의 원료 로트 · 원액 로트 · 수량 · 유형 고쳐 쓰기
         원액 로트의 제조일 고쳐 쓰기          고칠 때 (§2.1 불변식)

   T1 은 로트를 먼저 넣고 줄을 나중에 넣는 순서를 허용해야 하므로 커밋 때
   도는 제약 트리거다. 문장 끝에서 묻으면 make_solution_lot 이 서지 못한다.
   표 안의 검사로는 다른 표를 못 보므로 전부 트리거다 - 복구 때 트리거는
   물러나므로(session_replication_role = replica) 옛 백업을 막지 않는다.

   ── 정정은 줄을 고치지 않고 더한다 ──────────────────────────────────
   틀리게 적었으면 같은 원액을 가리키는 반대 줄(RETURN, +)로 되돌리고 다시
   적는다. 두 줄이 다 남고, v_solution_input 은 원액 · 원료 로트별 순량(부호
   합)을 낸다. 되돌림은 그 원액에서 꺼낸 만큼까지만 한다 - 0056 이 투입
   줄의 반납에서 닫은 것과 같은 상한이다.

   stock_movement 의 다른 줄은 이번에 손대지 않는다 - 지금 UPDATE 가 열려
   있어 수량을 고치면 재고와 장부가 갈라지는 자리지만, 원료 줄 밖의 줄까지
   닫을지는 따로 묻는다.

   ── 위 검사만으로는 새는 두 곳을 함께 닫았다 ─────────────────────────
   (1) 이미 적힌 줄에 원액을 뒤늦게 연결하는 길. 한 번 적기 검사
       (trg_once_written)는 빈 값에서 값으로 가는 것을 보내 주므로, T5 만으로는
       원액에 닿지 않던 반납 줄에 나중에 원액을 붙여 그 순량을 깎을 수 있다.
       이음은 줄을 적을 때만 정한다.
   (2) 옛 줄. 옛 용액 제조가 남긴 SOLUTION 줄은 원액을 가리키지 않는다.
       검사가 아니라 트리거이므로 옛 줄을 다시 묻지 않는다 - 유형도 이음도
       안 바뀌는 고치기는 T3 가 묻지 않고 지나간다.

   ── 옛 make_solution 은 없앤다 ──────────────────────────────────────
   그 함수가 낸 줄은 원액을 가리키지 않으므로 T3 에 걸린다. 지금까지 남은
   SOLUTION 줄은 그대로 남는다. 이 파일 앞의 이관(0015 · 0017 · 0053 · 0104)은
   그 함수를 만들고 권한을 건다 - 이관은 배포마다 처음부터 다시 돌므로 매번
   만들었다가 여기서 내린다. 끝나는 모양은 같다.

   ── 이 파일이 최종 모양을 정하는 것 ─────────────────────────────────
   material_lot_coa_once 는 0056 이 만들고 0090 이 다시 걸었다. 배포마다 둘이
   앞서 다시 돌므로 made_on 을 더한 모양은 **마지막에 도는 이 파일**이 정한다.
   --------------------------------------------------------------------------- */


/* === 1. 원료 줄이 원액 로트를 가리킨다 ================================= */
/*
 * 널 허용 · 기본값 없음. not null default 로 더한 칸은 그 칸을 모르던 옛
 * 백업을 통째로 들이지 못한다 (§10 · 0096). 원액을 가리키지 않는 줄이
 * 대부분이므로 어차피 비어 있는 것이 정상이다.
 */
alter table stock_movement
  add column if not exists solution_lot_id uuid references material_lot(id);

comment on column stock_movement.solution_lot_id is
  '원료 줄(SOLUTION)이 어느 원액 로트로 갔는가. 그 줄을 되돌리는 반납 줄(RETURN)도 같은 원액을 가리킨다. 다른 줄은 비어 있다 (0119)';

create index if not exists stock_movement_solution_idx
  on stock_movement (solution_lot_id) where solution_lot_id is not null;


/* === 2. T1 - 원료 줄 없는 원액 로트는 커밋되지 않는다 ================== */
/*
 * 원액의 근거는 원료 로트들의 성적서로 이어진다. 성적서 칸을 비운 대신 원료
 * 줄이 없으면 그 근거가 어디에도 없으므로 S02 의 원액 갈래가 성립하지 않는다.
 *
 * 로트가 먼저 들어오고 줄이 뒤따르므로 문장 끝이 아니라 **커밋 때** 묻는다.
 * 줄의 수량이나 원료의 종류는 묻지 않는다 - 하나라도 이어져 있는지만 본다.
 */
create or replace function trg_ml_made_inputs()
returns trigger language plpgsql as $fn$
begin
  if new.made_on is not null
     and not exists (select 1 from stock_movement
                      where solution_lot_id = new.id and type = 'SOLUTION') then
    raise exception 'S02: 원액 로트 %는 원료 로트 없이 만들 수 없습니다', new.lot_no;
  end if;
  return null;
end $fn$;

drop trigger if exists material_lot_made_inputs on material_lot;
create constraint trigger material_lot_made_inputs after insert
  on material_lot deferrable initially deferred
  for each row execute function trg_ml_made_inputs();

comment on trigger material_lot_made_inputs on material_lot is
  'S02 원액 갈래. 제조일이 있는 로트는 커밋 때 그것을 가리키는 원료 줄이 하나 이상 있어야 한다 (0119)';


/* === 3. T3 - 원료 줄은 원액을 가리키고, 다른 줄은 가리키지 않는다 ======= */
/*
 * 가리킬 수 있는 줄은 둘뿐이다.
 *
 *   SOLUTION  원료 줄. 반드시 원액 로트를 가리킨다
 *   RETURN    그 줄을 되돌리는 정정 줄. 가리키려면 원액 로트여야 하고, 그
 *             원액에서 실제로 꺼낸 원료 로트를 **꺼낸 만큼까지만** 되돌린다.
 *             원액을 안 가리키는 반납은 전과 같다 (공정에서 남은 자재)
 *
 * 되돌림 줄은 "꺼낸 양 - 이미 되돌린 양" 을 넘지 못한다. 0056 이 투입 줄의
 * 반납에서 같은 일을 닫았다 - 상한이 없으면 꺼낸 적 없는 양이 재고로 돌아오고
 * (trg_sm_apply 는 부호만 본다), 순량이 0 이 된 원료는 v_solution_input 에서
 * 사라져 원액이 무엇으로 만들어졌는지 보이지 않는다. 그 원액에 들어간 적 없는
 * 원료 로트를 가리키는 되돌림도 같은 이유로 거부한다. 되돌릴 줄을 찾고 세는
 * 동안 같은 원료 로트의 다른 되돌림이 끼어들지 못하게 그 로트를 잡는다.
 *
 * 폐기 · 조정 · 배치 장입이 원액 로트를 가리키는 일은 없다. 가리키면 원료
 * 줄의 순량이 그 줄들로 오염되어 v_solution_input 이 거짓을 말한다.
 *
 * 없는 로트를 가리키는 것은 여기서 판단하지 않는다 - 외래키가 거부한다.
 * 트리거가 먼저 돌아 그 오류를 가리지 않게 한다 (0118 의 T2 와 같다).
 */
create or replace function trg_sm_solution_link()
returns trigger language plpgsql as $fn$
declare
  v_ok    boolean;
  v_no    text;
  v_raw   text;
  v_lines int;
  v_drawn numeric;
begin
  if tg_op = 'UPDATE' then
    /* 유형도 이음도 안 바뀌면 묻지 않는다. 옛 용액 제조가 남긴 줄이 그렇다 */
    if new.type is not distinct from old.type
       and new.solution_lot_id is not distinct from old.solution_lot_id then
      return new;
    end if;
    /* 이음은 줄을 적을 때만 정한다. 적힌 줄에 뒤늦게 붙이지 않는다 */
    if old.solution_lot_id is null and new.solution_lot_id is not null then
      raise exception 'S01: 이미 적힌 줄에는 원액 로트를 뒤늦게 연결할 수 없습니다';
    end if;
  end if;

  if new.solution_lot_id is null then
    if new.type = 'SOLUTION' then
      raise exception 'S01: 원료 줄은 어느 원액 로트로 갔는지 가리켜야 합니다';
    end if;
    return new;
  end if;

  if new.type not in ('SOLUTION', 'RETURN') then
    raise exception
      'S01: 원액 로트를 가리킬 수 있는 줄은 원료 줄과 그것을 되돌리는 반납 줄뿐입니다 (유형 %)',
      new.type;
  end if;

  select (made_on is not null), lot_no into v_ok, v_no
    from material_lot where id = new.solution_lot_id;
  if v_ok is false then
    raise exception 'S01: 원액이 아닌 로트를 원액 로트로 가리킬 수 없습니다 (로트 %)', v_no;
  end if;

  /* 되돌림 줄은 그 원액에서 꺼낸 만큼까지만. 이 줄 자신은 세지 않는다 */
  if new.type = 'RETURN' then
    perform 1 from material_lot where id = new.material_lot_id for update;

    select count(*) filter (where type = 'SOLUTION'), coalesce(-sum(qty), 0)
      into v_lines, v_drawn
      from stock_movement
     where solution_lot_id = new.solution_lot_id
       and material_lot_id = new.material_lot_id
       and type in ('SOLUTION', 'RETURN')
       and id <> new.id;

    select lot_no into v_raw from material_lot where id = new.material_lot_id;

    if v_lines = 0 then
      raise exception
        'S01: 원액 로트 %에 들어간 적 없는 원료 로트 %는 되돌릴 수 없습니다', v_no, v_raw;
    end if;
    if new.qty > v_drawn then
      raise exception
        'S01: 원액 로트 %에서 원료 로트 %는 꺼낸 만큼까지만 되돌릴 수 있습니다 (아직 꺼낸 양 %, 이번 요청 %)',
        v_no, v_raw,
        trim(to_char(v_drawn, 'FM999999990.###')),
        trim(to_char(new.qty, 'FM999999990.###'));
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists stock_movement_solution_link on stock_movement;
create trigger stock_movement_solution_link before insert or update
  on stock_movement for each row execute function trg_sm_solution_link();

comment on trigger stock_movement_solution_link on stock_movement is
  '원료 줄은 원액 로트를 가리키고, 원액을 가리킬 수 있는 줄은 원료 줄과 그 되돌림 줄뿐이다. 되돌림은 꺼낸 만큼까지만 하고, 이음은 줄을 적을 때만 정한다 (0119)';


/* === 4. 고쳐 쓰기 차단 - 제조일 · 원료 줄 (§2.1) ======================== */
/*
 * made_on 은 번호의 날짜이고 유효기간의 출발점이다. 입고 로트와 원액 로트가
 * 서로 바뀌면 그 로트를 쓴 배치의 계보가 통째로 뒤집히므로 item_id 와 같은
 * 자리에서 잠근다. 0090 이 오기 정정이 정상 작업인 칸(성적서 번호 · 공급자
 * 로트 · 두께 구간)을 열어 둔 것은 그대로다.
 *
 * 입고 로트의 made_on 은 비어 있어 한 번 적기 검사가 지나친다. 그 칸에 값을
 * 넣는 길은 표 안의 검사(material_lot_source)와 T2 가 닫는다.
 */
drop trigger if exists material_lot_coa_once on material_lot;
create trigger material_lot_coa_once before update
  on material_lot for each row
  execute function trg_once_written('lot_no', 'item_id', 'supplier_id', 'qty_received', 'made_on');

comment on trigger material_lot_coa_once on material_lot is
  '고쳐 쓰면 계보가 뒤집히는 다섯만 잠근다. 성적서 번호 · 공급자 로트번호 · '
  '두께 구간은 오기 정정이 정상 작업이다 (5차 감사 A1 · 0119 가 제조일을 더함)';

/*
 * 원료 줄은 계보의 실체다. 어느 로트에서 얼마를 꺼내 어느 원액으로 갔는가를
 * 한 번 적으면 고치지 않는다. 지금 stock_movement 는 UPDATE 가 열려 있고
 * 차감은 INSERT 때만 반영되므로, 수량을 고치면 재고와 장부가 갈라진다.
 *
 * 걸리는 줄은 원료 줄과 원액을 가리키는 줄(되돌림)이다. 그 밖의 줄은 이번에
 * 손대지 않는다. 상세 문구 같은 다른 칸은 고칠 수 있다.
 */
drop trigger if exists stock_movement_solution_once on stock_movement;
create trigger stock_movement_solution_once before update
  on stock_movement for each row
  when (old.type = 'SOLUTION' or old.solution_lot_id is not null)
  execute function trg_once_written('material_lot_id', 'type', 'qty', 'solution_lot_id');

comment on trigger stock_movement_solution_once on stock_movement is
  '원료 줄과 원액을 가리키는 줄의 원료 로트 · 유형 · 수량 · 원액 로트는 한 번 적으면 고치지 않는다. 정정은 반대 줄을 더한다 (0119)';


/* === 5. 원액 로트 → 원료 로트 · 꺼낸 순량 =============================== */
/*
 * 원료 줄(SOLUTION, -)과 그것을 되돌리는 줄(RETURN, +)의 부호 합을 뒤집어
 * **꺼낸 순량**을 낸다. 양수만 낸다 - 순량이 0 이면 그 원료는 원액에 들어가지
 * 않은 것이라 정추적(원료 로트 → 원액 → 배치)에 올리면 거짓이 된다. 줄은
 * stock_movement 에 그대로 남아 있다.
 *
 * 판정하지 않는다. 더하고 뒤집을 뿐이다.
 */
create or replace view v_solution_input as
select sm.solution_lot_id,
       sl.lot_no   as solution_lot_no,
       sm.material_lot_id,
       ml.lot_no   as material_lot_no,
       i.code      as item_code,
       i.name      as item_name,
       i.usage_uom,
       -sum(sm.qty) as qty
  from stock_movement sm
  join material_lot sl on sl.id = sm.solution_lot_id
  join material_lot ml on ml.id = sm.material_lot_id
  join item i on i.id = ml.item_id
 where sm.solution_lot_id is not null
   and sm.type in ('SOLUTION', 'RETURN')
 group by sm.solution_lot_id, sl.lot_no, sm.material_lot_id, ml.lot_no,
          i.code, i.name, i.usage_uom
having sum(sm.qty) < 0;

comment on view v_solution_input is
  '원액 로트가 어느 원료 로트에서 얼마(꺼낸 순량, 양수)로 만들어졌는가. 원료 줄과 그 반납 줄의 부호 합을 뒤집어 낸다 (0119)';

grant select on v_solution_input to app_role, app_readonly;


/* === 6. 원액 제조 =====================================================
 *
 * 원료 여러 종이 한 번에 차감되고 원액 로트 한 줄이 선다. 한 번의 제조가
 * 한 묶음으로 남아야 나중에 "그 원액이 무엇으로 만들어졌는가"를 설명할 수 있다.
 *
 *   번호      next_number('MATERIAL_LOT', 품목, 제조일). 번호의 날짜는 제조일이다
 *   유효기간  제조일 + 품목 사용기간을 **만들 때 고정**한다. 품목의 사용기간을
 *             나중에 바꿔도 이미 만든 원액은 그대로다 (제품 로트와 같은 원칙,
 *             §4.2). 사용기간이 비어 있으면 비워 둔다 - 막지 않는다
 *   단가      Σ(원료 수량 x 원료 단가) / 제조량. 단가 없는 원료가 하나라도
 *             섞이면 비운다 - 0 으로 지어내지 않는다
 *
 * 차감은 기존 트리거(trg_sm_apply)가 한다. 잔여를 넘는 차감은 거기서 거부된다.
 * 커밋 때 T1 이 원료 줄을 확인한다.
 *
 * 부르는 길은 사람이다 - 세션 사용자가 있어야 한다. 권한은 지금 용액 제조와
 * 같다 (화면이 생산관리자 · 시스템관리자만 연다).
 */
drop function if exists make_solution(uuid[], numeric[], text, text);

create or replace function make_solution_lot(
  p_item    uuid,
  p_made_on date,
  p_qty     numeric,
  p_lots    uuid[],
  p_qtys    numeric[],
  p_note    text default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor    uuid := current_user_id();
  v_type     item_type;
  v_months   int;
  v_n        int;
  v_i        int;
  v_no       text;
  v_expiry   date;
  v_one      numeric;
  v_sum      numeric := 0;
  v_unpriced boolean := false;
  v_price    numeric;
  v_id       uuid;
begin
  /* 1. 사람이 부른 것인가, 원액 품목인가 */
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;

  select type, shelf_life_months into v_type, v_months from item where id = p_item;
  if not found then
    raise exception '품목을 찾을 수 없습니다';
  end if;
  if v_type <> 'SOLUTION' then
    raise exception '원액 유형의 품목이 아닙니다 (유형 %)', v_type;
  end if;

  /* 2. 제조일 · 제조량 · 원료 줄 수 */
  if p_made_on is null then
    raise exception '제조일을 입력하십시오';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception '제조량은 0보다 커야 합니다';
  end if;

  v_n := coalesce(array_length(p_lots, 1), 0);
  if v_n = 0 then
    raise exception '원료 로트를 한 줄 이상 적으십시오';
  end if;
  if v_n <> coalesce(array_length(p_qtys, 1), 0) then
    raise exception '원료 로트 수와 수량 수가 맞지 않습니다';
  end if;

  /* 원료마다 수량이 양수인지, 단가가 있는지. 번호를 쓰기 전에 거른다 */
  for v_i in 1 .. v_n loop
    if p_lots[v_i] is null or p_qtys[v_i] is null or p_qtys[v_i] <= 0 then
      raise exception '원료 로트와 수량(0보다 큼)을 모두 적으십시오 (%번째 줄)', v_i;
    end if;

    select unit_price into v_one from material_lot where id = p_lots[v_i];
    if not found then
      raise exception '원료 로트를 찾을 수 없습니다 (%번째 줄)', v_i;
    end if;
    if v_one is null then
      v_unpriced := true;
    else
      v_sum := v_sum + p_qtys[v_i] * v_one;
    end if;
  end loop;

  v_price := case when v_unpriced then null else round(v_sum / p_qty, 4) end;
  v_expiry := case when v_months is null then null
                   else (p_made_on + make_interval(months => v_months))::date end;

  /* 3. 번호. 날짜는 제조일이다 (0097) */
  v_no := next_number('MATERIAL_LOT', p_item, p_made_on);

  /* 4. 원액 로트 한 줄. 성적서 · 공급자 칸은 비운다 (S02 의 원액 갈래) */
  insert into material_lot (item_id, lot_no, made_on, received_at, registered_by,
                            qty_received, qty_available, unit_price, expiry_date)
  values (p_item, v_no, p_made_on, now(), v_actor,
          p_qty, p_qty, v_price, v_expiry)
  returning id into v_id;

  /* 5. 원료마다 원료 줄. 차감은 trg_sm_apply 가 한다 */
  for v_i in 1 .. v_n loop
    insert into stock_movement (material_lot_id, type, qty, solution_lot_id,
                                reason_code, reason_detail, registered_by)
    values (p_lots[v_i], 'SOLUTION', -p_qtys[v_i], v_id, '용액제조',
            v_no || coalesce(' / ' || nullif(btrim(p_note), ''), ''), v_actor);
  end loop;

  /* 6. 커밋 때 T1 이 원료 줄을 확인한다 */
  return v_id;
end $fn$;

comment on function make_solution_lot(uuid, date, numeric, uuid[], numeric[], text) is
  '원료 여러 종을 한 번에 차감하고 원액 로트를 세운다. 번호 · 유효기간(제조일 + 사용기간) · 단가를 정한다. 새 원액 로트 id 를 돌려준다 (0119)';

/*
 * 쓰는 함수는 열람 역할에 열어 두지 않는다 (§10 · 0104). 서명이 아니라 이름으로
 * 훑어 그 이름의 모든 갈래에서 걷는다 - 인자가 늘어도 이 이관이 다시 돌면서
 * 새 갈래까지 덮는다. 0043 의 alter default privileges 가 새로 만든 함수를
 * 열람 역할에 열어 주므로 이름을 적지 않으면 열려 있다 (IQ-14 가 지킨다).
 */
revoke all on function make_solution_lot(uuid, date, numeric, uuid[], numeric[], text) from public;
grant execute on function make_solution_lot(uuid, date, numeric, uuid[], numeric[], text)
  to app_role;

do $$
declare
  r record;
  names text[] := array['make_solution_lot'];
begin
  if not exists (select 1 from pg_roles where rolname = 'app_readonly') then
    return;
  end if;

  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any(names)
  loop
    execute format('revoke execute on function %s from app_readonly', r.sig);
    execute format('revoke execute on function %s from public', r.sig);
  end loop;
end $$;
