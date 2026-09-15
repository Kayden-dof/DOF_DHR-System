-- ---------------------------------------------------------------------------
-- 출하 승인 요청서 번호를 대장에 남기고, 출고가 그 번호의 실재를 묻는다
-- 근거 GMP 부합 점검 D5 · 사용자 결정 2026-09-15 (§12 를 먼저 물었다)
--
-- ── 무엇이 비어 있었나 ──────────────────────────────────────────────────
-- 0026 이 "출하 승인서 번호 없이는 출고를 기록할 수 없다" 를 세웠다. 그런데
-- 그 트리거는 **칸이 비었는지만** 묻는다. 적힌 번호가 실제로 발행된 요청서를
-- 가리키는지는 아무도 묻지 않았다. 지어낸 번호가 그대로 적힌다.
--
-- ── 이것은 판정이 아니다 (§1 · §12) ────────────────────────────────────
-- 적합인지 부적합인지 묻지 않는다. 출하 승인을 시스템이 하는 것도 아니다 -
-- 그 판정은 여전히 종이 위에서 품질책임자가 한다 (D4 · release_approved_by 가
-- FK 가 아닌 이유). 여기서 묻는 것은 하나다 - **가리키는 종이가 실재하는가.**
-- S01 이 자재 로트를 FK 로 묻는 것과 같은 종류이고, 0052 가 불변식을 더할 때
-- 쓴 기준("이미 적힌 사실을 없던 일로 만드는가")의 짝이다.
--
-- ── 형식이 네 곳에서 각자 조립되고 있었다 ──────────────────────────────
-- `RR-{배치번호}-{인쇄회차 2자리}` 가 요청서 인쇄 페이지 · 편철 표지 · 출고
-- 화면 · 시드 네 곳에 흩어져 있었다. 규격 표기가 두 곳으로 갈려 라벨 업체가
-- 보는 종이에 10배 작은 치수가 나갔던 것과 같은 모양이다 (§10 "복제는
-- 갈라진다"). 트리거까지 그 형식을 다시 적으면 다섯 번째가 된다.
--
-- 그래서 **번호를 만드는 자리를 하나로 모은다** - 발행하는 순간 종이에 찍히는
-- 그 값을 대장에 그대로 남기고(`record_print.doc_no`), 나머지는 전부 그것을
-- 읽는다. 대장에는 실제 종이만 남는다는 규율과 같은 방향이다 (§7.1).
--
-- ── 채번 규칙이 아니다 ─────────────────────────────────────────────────
-- `next_number()` 를 거치지 않는다. 이 번호는 세는 것이 아니라 **인쇄 회차에서
-- 나오는 것**이기 때문이다 - 회차가 오른다는 것이 곧 다른 요청서가 나갔다는
-- 뜻이다 (0105). 따로 세면 두 수가 갈라진다.
--
-- ── 소급하지 않는다 ────────────────────────────────────────────────────
-- 지난 출고 기록은 그대로 둔다. 0026 이 그랬듯 새로 적히는 것부터 묻고,
-- 기존 행의 다른 값 수정은 번호를 건드리지 않는 한 지나간다.
-- ---------------------------------------------------------------------------

alter table record_print add column if not exists doc_no text;

comment on column record_print.doc_no is
  '그 종이에 찍힌 문서번호. 지금은 출하 승인 요청서만 쓴다 (RR-배치번호-회차 · 0111)';

create index if not exists record_print_doc_no on record_print (doc_no)
  where doc_no is not null;


-- === 지난 종이의 번호를 되살린다 ==========================================
--
-- 이 UPDATE 는 형식의 두 번째 출처가 아니라 **지난 일의 복원**이다. 그때 그
-- 종이에 찍혀 나간 값이 무엇이었는지는 이미 정해져 있고, 여기서 그것을 대장에
-- 옮겨 적을 뿐이다. 앞으로 나가는 종이의 번호는 아래 record_print_log 가 만든다.
--
-- 채울 것이 있을 때만 쓴다 (§10). 값이 같아도 트리거는 UPDATE 를 잡으므로,
-- where 없이 돌리면 배포마다 "이관 계정이 그것을 바꿨다" 가 감사추적에 쌓인다.

update record_print rp
   set doc_no = 'RR-' || wo.batch_no || '-' || lpad(rp.seq::text, 2, '0')
  from work_order wo
 where wo.id = rp.work_order_id
   and rp.kind = 'RELEASE_REQUEST'
   and rp.doc_no is null;


-- === 발행하는 순간 번호가 정해지고, 그 값이 대장에 남는다 ==================
--
-- 서명은 그대로다. 이 함수는 `record_print` 행 자체를 돌려주므로 열이 하나
-- 늘어도 인자와 반환형이 바뀌지 않는다 - 새 함수 객체가 생기지 않으니 0043 의
-- `alter default privileges` 가 열람 역할에 새로 열어 줄 자리도 없다 (0104).

create or replace function record_print_log(
  p_kind          print_kind,
  p_data_hash     text,
  p_work_order    uuid default null,
  p_product_lot   uuid default null,
  p_day_no        int  default null,
  p_worker        uuid default null,
  p_material_lot  uuid default null,
  p_pages         int  default 1,
  p_equipment     uuid default null
) returns record_print
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare v_seq int; v_row record_print; v_doc text; v_actor uuid := current_user_id();
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from record_print
   where kind = p_kind
     and work_order_id is not distinct from p_work_order
     and product_lot_id is not distinct from p_product_lot
     and day_no is not distinct from p_day_no
     and worker_id is not distinct from p_worker
     and material_lot_id is not distinct from p_material_lot
     and equipment_id is not distinct from p_equipment;

  /*
   * 문서번호. 지금은 출하 승인 요청서만 제 번호를 들고 나간다 - 그 번호를
   * 출고 기록이 가리키기 때문이다. 다른 양식은 대상과 회차로 충분하다.
   */
  if p_kind = 'RELEASE_REQUEST' and p_work_order is not null then
    select 'RR-' || wo.batch_no || '-' || lpad(v_seq::text, 2, '0')
      into v_doc
      from work_order wo where wo.id = p_work_order;
  end if;

  insert into record_print (kind, work_order_id, product_lot_id, day_no, worker_id,
                            material_lot_id, equipment_id, seq, data_hash, printed_by,
                            pages, doc_no)
  values (p_kind, p_work_order, p_product_lot, p_day_no, p_worker,
          p_material_lot, p_equipment, v_seq, p_data_hash, v_actor,
          greatest(coalesce(p_pages, 1), 1), v_doc)
  returning * into v_row;

  return v_row;
end $fn$;


-- === 한 번 적힌 번호는 바뀌지 않는다 (§2.1) ================================
--
-- 종이에 찍혀 나간 값이다. 시스템에서 바뀌면 손에 든 종이와 갈라지고, 갈라진
-- 것을 아무도 눈치채지 못한다 - 자료 식별자 · 회차 · 인쇄자와 같은 자리다.
--
-- 비어 있던 것을 채우는 길은 열어 둔다. 위의 복원이 그 길로 지나간다.
--
-- **0056 의 회수 규칙을 함께 들고 온다.** 이 함수는 0052 가 세우고 0056 이
-- 회수 한 방향을 더했다. 여기서 doc_no 만 생각하고 다시 쓰면 그 규칙이 조용히
-- 사라진다 - 실제로 그렇게 썼다가 시험이 잡았다 ("회수 기록은 되돌릴 수 없다"
-- 가 통과해 버렸다). 함수를 통째로 다시 쓰는 이관은 앞서 무엇이 들어왔는지
-- 먼저 본다.

create or replace function trg_print_immutable()
returns trigger language plpgsql as $fn$
begin
  if new.data_hash   is distinct from old.data_hash
  or new.printed_by  is distinct from old.printed_by
  or new.printed_at  is distinct from old.printed_at
  or new.seq         is distinct from old.seq
  or new.kind        is distinct from old.kind
  or new.pages       is distinct from old.pages
  or (old.doc_no is not null and new.doc_no is distinct from old.doc_no) then
    raise exception '인쇄 기록은 고칠 수 없습니다. 회수 사유만 남길 수 있습니다';
  end if;

  /* 회수는 한 방향이다. 적을 수는 있고 지울 수는 없다 (0056) */
  if old.retrieved_at is not null
     and (new.retrieved_at is null or new.retrieved_at <> old.retrieved_at) then
    raise exception '회수 기록은 되돌릴 수 없습니다 (회수 %)',
      to_char(timezone('Asia/Seoul', old.retrieved_at), 'YYYY-MM-DD HH24:MI');
  end if;

  return new;
end $fn$;


-- === 출고가 가리키는 요청서가 실재해야 한다 (D5) ===========================

create or replace function trg_shipment_request_no()
returns trigger language plpgsql as $fn$
begin
  -- 기존 행의 다른 값 수정은 막지 않는다. 번호를 건드리지 않으면 지나간다
  if tg_op = 'UPDATE'
     and new.release_request_no is not distinct from old.release_request_no then
    return new;
  end if;

  if new.release_request_no is null or btrim(new.release_request_no) = '' then
    raise exception '출하 승인서 번호가 없습니다. 서면 승인된 요청서의 번호를 적어야 출고를 기록할 수 있습니다';
  end if;

  /*
   * 그 번호로 나간 종이가 대장에 있는가.
   *
   * 형식을 여기서 뜯지 않는다. 발행할 때 적힌 값과 글자 그대로 견준다 - 형식이
   * 바뀌어도 이 자리는 고칠 것이 없다.
   */
  if not exists (
    select 1 from record_print rp
     where rp.kind = 'RELEASE_REQUEST'
       and rp.doc_no = btrim(new.release_request_no)) then
    raise exception
      '출하 승인 요청서 %(이)가 발행된 적이 없습니다. 요청서를 먼저 발행하고 그 종이에 찍힌 번호를 적으십시오',
      btrim(new.release_request_no);
  end if;

  return new;
end $fn$;

drop trigger if exists shipment_request_no on shipment;
create trigger shipment_request_no before insert or update
  on shipment for each row execute function trg_shipment_request_no();
