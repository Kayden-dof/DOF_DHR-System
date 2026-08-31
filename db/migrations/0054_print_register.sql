/* ---------------------------------------------------------------------------
   인쇄 대장은 실제 종이 한 장에 한 줄이다 (2차 검수 결함 3)

   현장의 "일차 마감" 단추가 종이를 한 장도 만들지 않으면서 인쇄 대장에 1회차
   행을 심고 있었다. 실제 종이는 그 뒤 "기록서 다시 보기" 로 나왔고 그것이
   2회차가 되었다. 인쇄 양식은 회차가 2 이상이면 종이 한가운데를 가로지르는
   재발행 워터마크를 찍는다.

   그래서 실제로 프린터에서 나오는 모든 제조기록서 첫 장에 "재발행 2회차" 가
   찍혔다. 그 표시는 같은 기록의 종이가 두 장 도는 위험을 알리라고 만든
   것인데, 100% 뜨는 순간 신호로서 죽는다. 검토자는 존재한 적 없는 1회차
   원본을 찾게 된다.

   ── 마감과 인쇄를 가른다 ──────────────────────────────────────────────────
   두 가지는 다른 일이다.

     마감  "나는 이 일차에 더 적을 것이 없다" 는 선언. 묶음이 잠긴다 (S04).
     인쇄  종이가 한 장 나온다. 대장에 한 줄이 남고 회차가 오른다.

   전에는 마감이 둘 다 했다. 이제 마감은 잠그기만 하고, 대장 행은 실제로
   종이를 그리는 화면에서만 생긴다. 화면은 마감 직후 그 인쇄 화면으로
   넘어가므로 사람이 하는 조작은 그대로다.

   잠금은 그대로 되돌릴 수 없다. 마감했는데 인쇄하지 않고 나가면 그 일차는
   잠긴 채로 종이가 없는 상태가 되는데, 그것이 사실이므로 그대로 둔다.
   인쇄 화면은 언제든 다시 열 수 있고 그때 1회차가 발행된다.

   ── 회차가 겹치지 않게 한다 ───────────────────────────────────────────────
   회차 배정이 §4.10 이 금지한 "조회 후 증가" 방식이었고 유일 제약도 없었다.
   실제로 같은 대상에 1회차가 두 줄 있는 것을 확인했다.

   조회 후 증가 자체는 그대로 둔다 - 대상 조합이 일곱 컬럼이라 채번 카운터로
   옮기기에는 키가 너무 넓다. 대신 유일 인덱스를 걸어 겹치면 터지게 한다.
   3인 현장에서 같은 종이를 동시에 두 번 뽑는 일은 드물고, 드물게 부딪히면
   다시 누르면 된다. 조용히 겹치는 것보다 낫다.

   NULLS NOT DISTINCT 를 쓴다. 일곱 컬럼 중 대부분이 비어 있어서, 이것이
   없으면 인덱스가 아무것도 막지 못한다 (결함 7 과 같은 함정).
--------------------------------------------------------------------------- */


/* === 1. 잠그기만 하는 함수 ============================================== */
/*
 * print_day_record 에서 대장에 남기는 부분을 뺀 것이다. 신원 확인은 같다 -
 * 남의 일차를 잠그는 것이 남의 일차를 인쇄하는 것보다 덜 위험하지 않다
 * (0053 과 같은 판단).
 */
create or replace function lock_day(p_work_order uuid, p_day_no int, p_worker uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_actor uuid := current_user_id();
begin
  if v_actor is null then
    raise exception '로그인 정보가 없습니다';
  end if;

  if v_actor <> p_worker
     and not exists (select 1 from user_role
                      where user_id = v_actor and role in ('PROD_MGR', 'SYS_ADMIN')) then
    raise exception '다른 사람의 기록은 마감할 수 없습니다. 본인 또는 생산관리자가 마감합니다';
  end if;

  if not exists (select 1 from process_record
                  where work_order_id = p_work_order
                    and day_no = p_day_no and worker_id = p_worker) then
    raise exception '마감할 기록이 없습니다';
  end if;

  insert into day_lock (work_order_id, day_no, worker_id, locked_by)
  values (p_work_order, p_day_no, p_worker, v_actor)
  on conflict (work_order_id, day_no, worker_id) do nothing;
end $fn$;

revoke execute on function lock_day(uuid, int, uuid) from public;
revoke execute on function lock_day(uuid, int, uuid) from app_readonly;
grant  execute on function lock_day(uuid, int, uuid) to app_role;


/* === 2. 같은 종이에 같은 회차가 두 줄 생기지 않게 한다 ================== */
/*
 * 이미 겹쳐 있는 행이 있으면 인덱스를 만들 수 없다. 과거 시연 자료에서
 * 실제로 겹친 것이 확인되었으므로, 겹친 쪽의 회차를 뒤로 밀어 자리를 만든다.
 * 인쇄 시각 순서를 지켜 미루므로 먼저 뽑은 종이가 낮은 회차를 갖는다.
 *
 * record_print 는 0052 가 seq 를 불변으로 만들었다. 여기서는 그 트리거를
 * 잠시 물러나게 하고 고친다 - 이관은 응용이 아니고, 고치는 목적이 대장을
 * 실제 종이와 맞추는 것이다.
 */
do $$
declare n int;
begin
  set local session_replication_role = 'replica';

  with ranked as (
    select id, row_number() over (
             partition by kind, work_order_id, product_lot_id, day_no,
                          worker_id, material_lot_id, equipment_id
             order by printed_at, id) as rn,
           seq
      from record_print)
  update record_print rp
     set seq = r.rn
    from ranked r
   where rp.id = r.id and rp.seq <> r.rn;

  get diagnostics n = row_count;
  if n > 0 then
    raise notice '겹치거나 어긋난 인쇄 회차 %건을 인쇄 시각 순서로 다시 매겼습니다', n;
  end if;

  set local session_replication_role = 'origin';
end $$;

create unique index if not exists record_print_target_seq
  on record_print (kind, work_order_id, product_lot_id, day_no,
                   worker_id, material_lot_id, equipment_id, seq)
  nulls not distinct;


/* === 3. 자료 식별자는 한 가지 방식으로만 만든다 ========================= */
/*
 * 한 컬럼에 12 · 32 · 64 자가 공존했다. 마감이 SQL 안에서 만든 열쇠 없는
 * 값과, lib/print.ts 가 만드는 열쇠 있는 값이 섞였기 때문이다.
 *
 * 앞으로는 64자 16진수만 받는다. 다른 경로가 다시 생기면 여기서 터진다.
 * 과거 행은 고칠 수 없으므로 NOT VALID 로 둔다 - 지난 종이에 이미 찍혀
 * 나간 값이고, 바꾸면 그 종이를 되짚을 수 없게 된다.
 */
alter table record_print drop constraint if exists record_print_hash_form;
alter table record_print
  add constraint record_print_hash_form
  check (data_hash ~ '^[0-9a-f]{64}$') not valid;
