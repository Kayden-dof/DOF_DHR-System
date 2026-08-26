-- =============================================================================
-- 0021_print_control.sql · 인쇄물 통제
--
-- 종이가 정본이다. 그래서 이 시스템에서 가장 위험한 상태는 "같은 기록의 종이가
-- 두 장 돌아다니는 것"이다. 재발행하면 앞서 뽑은 종이가 현장에 그대로 남고,
-- 둘 중 어느 것이 최신인지 종이만 봐서는 알 수 없다.
--
-- 세 가지를 더한다.
--   1. 회수 기록   앞 회차를 거둬들였다는 사실을 남긴다. 한 번 적으면 못 바꾼다.
--   2. 최신 여부   어떤 자료 식별자가 최신 회차인지 조회로 답한다.
--   3. 식별자 조회 종이에 찍힌 식별자로 그 종이가 무엇인지 되짚는다.
--
-- 판정하지 않는다. "이 종이는 무효" 같은 말을 하지 않는다. 언제 뽑혔고,
-- 뒤에 몇 회차가 더 나왔고, 회수 기록이 있는지 없는지를 사실로만 답한다.
-- 무엇을 할지는 그걸 보는 사람이 정한다 (§8.5).
-- =============================================================================

/* ---------------------------------------------------------------------------
   회수 기록

   되돌릴 수 없다. 이미 회수로 적힌 것을 안 한 것으로 만들 수 없고, 사유를
   나중에 고쳐 쓸 수도 없다. 잘못 적었으면 그 사실이 그대로 남는다.
--------------------------------------------------------------------------- */
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
    raise exception '회수 사유를 적어야 합니다';
  end if;

  select * into v_row from record_print where id = p_print for update;
  if not found then
    raise exception '인쇄 기록을 찾을 수 없습니다';
  end if;
  if v_row.retrieved_at is not null then
    raise exception '이미 회수로 기록된 인쇄물입니다 (%). 기록은 고치지 않습니다',
      to_char(timezone('Asia/Seoul', v_row.retrieved_at), 'YYYY-MM-DD HH24:MI');
  end if;

  update record_print
     set retrieved_at = now(), retrieve_reason = btrim(p_reason)
   where id = p_print
   returning * into v_row;

  return v_row;
end $fn$;

grant execute on function retrieve_print(uuid, text) to app_role;

/* ---------------------------------------------------------------------------
   인쇄물 조회

   종이에 찍힌 자료 식별자(앞 12자리)로 되짚는다. 같은 묶음에서 뒤에 몇 회차가
   더 나왔는지, 회수 기록이 있는지를 함께 돌려준다.

   자료 식별자는 그 시점 자료의 해시다. 같은 값이 나왔다면 같은 자료를 뽑은
   것이고, 다르면 자료가 바뀐 뒤에 뽑은 것이다. 종이 위조를 막지는 못한다 -
   그건 종이의 몫이다. 다만 손에 든 종이가 시스템의 무엇과 짝인지는 말해 준다.
--------------------------------------------------------------------------- */
create or replace view v_print_lookup as
select rp.id,
       rp.kind::text                       as kind,
       -- 대소문자를 섞어 저장한 자료가 있을 수 있다. 조회는 늘 소문자로 맞춘다.
       lower(left(rp.data_hash, 12))       as short_hash,
       rp.data_hash,
       rp.seq,
       rp.pages,
       rp.printed_at,
       rp.retrieved_at,
       rp.retrieve_reason,
       u.full_name                         as printed_by_name,
       rp.work_order_id,
       wo.batch_no,
       wo.wo_no,
       rp.day_no,
       w.full_name                         as worker_name,
       rp.product_lot_id,
       pl.lot_no                           as product_lot_no,
       rp.material_lot_id,
       ml.lot_no                           as material_lot_no,
       -- 같은 묶음에서 이 회차 뒤에 나온 인쇄 횟수
       (select count(*)::int from record_print n
         where n.kind = rp.kind
           and n.work_order_id  is not distinct from rp.work_order_id
           and n.product_lot_id is not distinct from rp.product_lot_id
           and n.day_no         is not distinct from rp.day_no
           and n.worker_id      is not distinct from rp.worker_id
           and n.material_lot_id is not distinct from rp.material_lot_id
           and n.seq > rp.seq)              as newer_count,
       (select max(n.seq) from record_print n
         where n.kind = rp.kind
           and n.work_order_id  is not distinct from rp.work_order_id
           and n.product_lot_id is not distinct from rp.product_lot_id
           and n.day_no         is not distinct from rp.day_no
           and n.worker_id      is not distinct from rp.worker_id
           and n.material_lot_id is not distinct from rp.material_lot_id) as latest_seq
  from record_print rp
  join app_user u on u.id = rp.printed_by
  left join work_order wo   on wo.id = rp.work_order_id
  left join app_user w      on w.id  = rp.worker_id
  left join product_lot pl  on pl.id = rp.product_lot_id
  left join material_lot ml on ml.id = rp.material_lot_id;

grant select on v_print_lookup to app_role;

create index if not exists record_print_hash_idx
  on record_print (lower(left(data_hash, 12)));
