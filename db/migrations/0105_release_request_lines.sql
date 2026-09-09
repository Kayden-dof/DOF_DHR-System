-- ---------------------------------------------------------------------------
-- 출하 승인 요청서에 무엇이 담겼는지 남긴다 (사용자 요청 2026-09-09)
--
-- 0103 이 나간 종이를 다시 볼 수 있게 열었는데, 일곱 양식 가운데 **출하 승인
-- 요청서만 펼치지 못했다.** 어느 제품 로트를 몇 개씩 올렸는지가 주소의 `sel`
-- 에만 있고 대장에는 남지 않아서다. 화면은 "되살릴 수 없다" 고 말하고 있었다.
--
-- 남지 않는다는 것은 열람만의 문제가 아니다. **그 종이가 무엇을 요청했는지
-- 시스템이 모른다.** 출고는 `shipment.release_request_no` 로 그 번호를
-- 가리키는데, 가리키는 쪽만 있고 가리켜지는 내용이 없었다.
--
-- ── 담는 모양 ───────────────────────────────────────────────────────────
-- `record_print` 에는 `product_lot_id` 가 하나뿐이다. 요청서 한 장은 여러
-- 로트를 담으므로 자식 표로 간다. `steril_batch_lot` 과 같은 모양이다 (§4.8).
--
-- ── 고쳐 쓰지 않는다 ────────────────────────────────────────────────────
-- 이미 나간 종이에 무엇이 담겼는지는 **적힌 사실**이다 (§1-5). 지우는 길도
-- 고쳐 쓰는 길도 내지 않는다 - 넣기와 읽기만 연다. `record_print` 의 자료
-- 식별자를 못 고치게 해 둔 것과 같은 이유다 (§2.1).
--
-- ── 회차가 재발행 회차가 아니다 ─────────────────────────────────────────
-- 여기서 하나가 더 걸렸다. 요청서 번호는 `RR-{배치번호}-{인쇄회차}` 이고
-- (app/print/release-request), **회차가 오른다는 것은 다른 요청서가 나갔다는
-- 뜻이지 앞 종이를 다시 뽑았다는 뜻이 아니다.**
--
-- 그런데 `v_print_lookup` 은 모든 양식을 같은 셈으로 보고 있었다. 그래서 인쇄물
-- 조회 화면이 `RR-B260714-01-01` 을 두고 "뒤에 4회 재출력" 이라고 말했다 -
-- 뒤의 넷은 각자 번호를 가진 **다른 종이**인데 앞 종이가 회수 대상으로 읽힌다.
-- 손에 든 종이가 최신인지 묻는 자리에서 그건 거짓말이다.
--
-- 가르는 기준은 자료 식별자다. 같은 자료 식별자로 다시 나갔으면 같은 내용을
-- 다시 뽑은 것이고, 다르면 다른 요청서다.
--
-- 다른 양식은 그대로 둔다. 제조기록서는 대상(배치·일차·작업자)이 **문서 하나**를
-- 가리키므로, 자료가 바뀌어 식별자가 달라져도 뒤에 나온 종이가 앞 종이를
-- 대신한다. 출하 승인 요청서만 대상 하나가 여러 문서를 담는다.
-- ---------------------------------------------------------------------------

create table if not exists record_print_lot (
  record_print_id uuid not null references record_print(id),
  product_lot_id  uuid not null references product_lot(id),
  qty             int  not null check (qty > 0),
  primary key (record_print_id, product_lot_id)
);

comment on table record_print_lot is
  '그 인쇄물 한 장에 담긴 제품 로트와 수량. 출하 승인 요청서가 쓴다 (0105)';

create index if not exists record_print_lot_lot
  on record_print_lot (product_lot_id);


-- ── 감사추적 · 삭제 차단 · TRUNCATE 차단 (0017 과 같은 세 가지) ─────────
do $$
begin
  execute 'drop trigger if exists record_print_lot_audit on record_print_lot';
  execute 'create trigger record_print_lot_audit after insert or update
             on record_print_lot for each row
             execute function trg_audit(''record_print_id'')';

  execute 'drop trigger if exists record_print_lot_no_delete on record_print_lot';
  execute 'create trigger record_print_lot_no_delete before delete
             on record_print_lot for each row execute function trg_block_delete()';

  execute 'drop trigger if exists record_print_lot_no_truncate on record_print_lot';
  execute 'create trigger record_print_lot_no_truncate before truncate
             on record_print_lot for each statement execute function trg_block_delete()';
end $$;


-- ── 고쳐 쓰는 길도 내지 않는다 ──────────────────────────────────────────
create or replace function trg_rpl_frozen()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
begin
  raise exception '이미 나간 종이에 담긴 내용은 고쳐 쓸 수 없습니다';
end $$;

drop trigger if exists record_print_lot_frozen on record_print_lot;
create trigger record_print_lot_frozen before update
  on record_print_lot for each row execute function trg_rpl_frozen();

grant select, insert on record_print_lot to app_role;
grant select on record_print_lot to app_readonly;
revoke delete, truncate, update on record_print_lot from app_role;


-- ── 그 종이에 무엇이 담겼는가 ───────────────────────────────────────────
--
-- 인쇄 화면이 발행 직후에 한 번 부른다. 같은 트랜잭션 안이라 종이 한 줄과
-- 그 내용이 함께 서거나 함께 물러난다.
create or replace function record_print_lots(
  p_print uuid, p_lots uuid[], p_qtys int[])
returns void language plpgsql
set search_path = public, pg_temp as $$
declare i int;
begin
  if p_lots is null or array_length(p_lots, 1) is null then return; end if;
  if array_length(p_lots, 1) <> array_length(p_qtys, 1) then
    raise exception '로트와 수량의 개수가 다릅니다';
  end if;

  for i in 1 .. array_length(p_lots, 1) loop
    insert into record_print_lot (record_print_id, product_lot_id, qty)
    values (p_print, p_lots[i], p_qtys[i])
    on conflict (record_print_id, product_lot_id) do nothing;
  end loop;
end $$;

comment on function record_print_lots(uuid, uuid[], int[]) is
  '인쇄물 한 장에 담긴 제품 로트를 적는다. 발행과 같은 트랜잭션에서 부른다 (0105)';

revoke all on function record_print_lots(uuid, uuid[], int[]) from public;
grant execute on function record_print_lots(uuid, uuid[], int[]) to app_role;


-- ── 회차가 아니라 자료로 센다 (출하 승인 요청서만) ──────────────────────
create or replace view v_print_lookup as
select rp.id,
       rp.kind::text                       as kind,
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
       (select count(*)::int from record_print n
         where n.kind = rp.kind
           and n.work_order_id   is not distinct from rp.work_order_id
           and n.product_lot_id  is not distinct from rp.product_lot_id
           and n.day_no          is not distinct from rp.day_no
           and n.worker_id       is not distinct from rp.worker_id
           and n.material_lot_id is not distinct from rp.material_lot_id
           and n.equipment_id    is not distinct from rp.equipment_id
           /* 요청서는 회차마다 다른 종이다. 같은 자료끼리만 센다 (0105) */
           and (rp.kind <> 'RELEASE_REQUEST' or n.data_hash = rp.data_hash)
           and n.seq > rp.seq)              as newer_count,
       (select max(n.seq) from record_print n
         where n.kind = rp.kind
           and n.work_order_id   is not distinct from rp.work_order_id
           and n.product_lot_id  is not distinct from rp.product_lot_id
           and n.day_no          is not distinct from rp.day_no
           and n.worker_id       is not distinct from rp.worker_id
           and n.material_lot_id is not distinct from rp.material_lot_id
           and n.equipment_id    is not distinct from rp.equipment_id
           and (rp.kind <> 'RELEASE_REQUEST' or n.data_hash = rp.data_hash)
        ) as latest_seq,
       rp.equipment_id,
       eq.code                             as equipment_code,
       eq.name                             as equipment_name,
       rp.worker_id
  from record_print rp
  join app_user u on u.id = rp.printed_by
  left join work_order wo   on wo.id = rp.work_order_id
  left join product_lot pl  on pl.id = rp.product_lot_id
  left join material_lot ml on ml.id = rp.material_lot_id
  left join app_user w      on w.id  = rp.worker_id
  left join equipment eq    on eq.id = rp.equipment_id;

grant select on v_print_lookup to app_role, app_readonly;

-- ── 시연 자료 비우기가 새 표를 알아야 한다 ──────────────────────────────
--
-- `record_print_lot` 이 `record_print` 를 가리키므로, 비우는 차례에 넣지 않으면
-- 외래키에 걸려 **비우기 전체가 막힌다.** `npm test` 의 PRG-06 이 그것을 짚었다.
--
-- 표를 하나 더할 때마다 여기를 함께 봐야 한다는 뜻이다. 08_purge 가 그 자리를
-- 지킨다 - 새 표가 이 함수를 막으면 그 시험이 실패한다.
--
-- 살아 있는 정의를 그대로 떠 와 **한 줄만** 끼웠다. 파일에서 옮겨 적으면 그
-- 사이에 다른 이관이 고쳐 둔 것을 되돌린다 (실제로 그런 적이 있다 - 0097 의
-- trg_rule_immutable).

CREATE OR REPLACE FUNCTION public.purge_demo_data()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_me uuid; v_seeded timestamptz; v_after bigint; v_counts jsonb;
begin
  v_me := current_user_id();
  if v_me is null then
    raise exception '로그인 정보가 없습니다';
  end if;

  if not exists (select 1 from user_role
                  where user_id = v_me and role = 'SYS_ADMIN') then
    raise exception '시스템관리자만 시연 자료를 비울 수 있습니다';
  end if;

  select seeded_at into v_seeded from demo_marker limit 1;
  if v_seeded is null then
    raise exception '시연 자료 표시가 없습니다. 비울 것이 없거나 이미 비웠습니다';
  end if;

  /*
   * 표시를 남긴 뒤에 한 줄이라도 움직였으면 거부한다.
   *
   * audit_log 는 모든 입력과 변경을 남기므로, 그 뒤에 행이 있다는 것은 지어낸
   * 자료와 실제 작업이 섞였다는 뜻이다. 섞인 뒤에는 갈라낼 방법이 없고,
   * 갈라내지 못하면 지워서는 안 된다.
   */
  select count(*) into v_after from audit_log where acted_at > v_seeded;
  if v_after > 0 then
    raise exception
      '시연 자료를 넣은 뒤에 기록이 %건 더 쌓였습니다. 지어낸 자료와 실제 기록을 '
      '갈라낼 수 없으므로 비우지 않습니다', v_after;
  end if;

  if not only_demo_data() then
    raise exception '시연 자료 표시 앞에 다른 기록이 있거나 기준선이 없습니다. '
      '이 DB 는 시연 전용이라고 증명되지 않습니다';
  end if;

  select jsonb_build_object(
      '작업지시', (select count(*) from work_order),
      '제품로트', (select count(*) from product_lot),
      '공정기록', (select count(*) from process_record),
      '자재로트', (select count(*) from material_lot),
      '출고',     (select count(*) from shipment))
    into v_counts;

  /* 배치에서 갈라져 나온 것부터. 참조가 걸린 순서를 거슬러 올라간다 */
  delete from shipment;
  delete from steril_batch_lot;
  delete from steril_batch;
  delete from product_nonconformity;
  delete from wip_nonconformity;
  delete from stock_movement;      -- material_issue 를 가리킨다 (0056). 먼저 지운다
  delete from material_issue;
  delete from day_lock;
  /* 인쇄물에 담긴 제품 로트. record_print 를 가리키므로 먼저 지운다 (0105) */
  delete from record_print_lot;
  delete from record_print;
  delete from process_record;
  delete from product_lot;
  delete from work_order_plan;
  delete from work_order;

  /*
   * 자재 로트도 지운다. 남겨 두면 잔여 수량이 지어낸 불출만큼 깎인 채로 남아,
   * 실물과 맞지 않는 재고가 첫날부터 서 있게 된다. 실 운영은 실제 성적서 번호로
   * 다시 입고하면서 시작하는 것이 맞다.
   *
   * material_lot 이 purchase_order 를 가리키므로 로트를 먼저 지운다.
   */
  delete from material_lot;
  delete from purchase_order;

  delete from demo_marker;

  /* 지운 사실은 남긴다. 지우는 것과 지웠다는 사실을 지우는 것은 다르다 */
  insert into audit_log (table_name, record_id, action, actor_id, old_value, new_value)
  values ('demo_marker', gen_random_uuid(), 'PURGE', v_me, v_counts,
          jsonb_build_object('purged_at', now(), 'seeded_at', v_seeded));

  return format('시연 자료를 비웠습니다. 작업지시 %s · 제품로트 %s · 공정기록 %s · 자재로트 %s',
                v_counts->>'작업지시', v_counts->>'제품로트',
                v_counts->>'공정기록', v_counts->>'자재로트');
end $function$;
