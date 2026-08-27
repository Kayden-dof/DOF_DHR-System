/* ---------------------------------------------------------------------------
   특채는 기록지 문서 코드가 있어야 특채다

   0045 는 특채에 승인자 이름과 승인일만 받았다. 그런데 특채는 품질팀이 발행한
   특채 기록지가 정본이고, 시스템에 적히는 것은 그 종이를 가리키는 표지일
   뿐이다. 종이를 가리키는 값이 없으면 나중에 무엇을 근거로 내보냈는지 확인할
   길이 없다 (사용자 기준).

   이름만으로는 부족하다. 이름은 누가 정했는지는 말해 주지만 어느 종이인지는
   말해 주지 않는다. 같은 사람이 여러 건을 승인하고, 심사에서 묻는 것은 늘
   "그 종이를 보여 달라" 이다.

   ── S02 와 같은 모양이다 ──────────────────────────────────────────────────
   자재 등록에 성적서 번호를 필수로 두는 것과 같은 규칙이다 (§2 S02). 서면과
   시스템을 잇는 고리를 NOT NULL 로 강제한다. 응용에서 빈 값을 걸러 내는 것과
   행 자체가 들어가지 않는 것은 다르고, 여기서는 뒤엣것이 필요하다.

   ── 왜 새 차단이 아닌가 ───────────────────────────────────────────────────
   S01~S05 에 여섯째를 더하는 것이 아니다. 이건 "특채라는 기록이 성립하려면
   무엇이 있어야 하는가"이지 정상 작업을 막는 규칙이 아니다. 문서 코드가 없는
   특채는 애초에 특채가 아니므로 적을 것도 없다.

   ── 지난 기록은 고쳐 쓰지 않는다 ──────────────────────────────────────────
   NOT VALID 로 붙인다. 이미 들어간 행은 그때의 규칙으로 적힌 기록이므로 지금
   잣대로 되돌려 고치지 않는다 (§10). 새로 들어오거나 고쳐지는 행부터 지킨다.

   운영에는 아직 특채 기록이 없어 실질적으로 전부에 걸린다. 그래도 NOT VALID
   로 두는 이유는, 이 사슬이 언제 어떤 자료 위에서 다시 흐를지 모르기 때문이다.
--------------------------------------------------------------------------- */

alter table product_nonconformity
  add column if not exists concession_doc_no text;

comment on column product_nonconformity.concession_doc_no is
  '특채 기록지 문서 코드. 이 값이 없으면 특채로 잡지 않는다';

alter table product_nonconformity
  drop constraint if exists product_nonconformity_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'nc_concession_doc') then
    alter table product_nonconformity add constraint nc_concession_doc check (
      outcome <> 'CONCESSION'
      or (approved_by is not null
          and approved_on is not null
          and btrim(coalesce(concession_doc_no, '')) <> '')
    ) not valid;
  end if;
end $$;

/* 특채가 아닌 줄에 문서 코드가 붙어 있으면 나중에 읽는 사람이 헷갈린다 */
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'nc_doc_only_concession') then
    alter table product_nonconformity add constraint nc_doc_only_concession check (
      outcome = 'CONCESSION' or concession_doc_no is null
    ) not valid;
  end if;
end $$;

/* ---------------------------------------------------------------------------
   편철에 들어갈 서류가 하나 늘었다

   특채가 있으면 그 기록지도 배치 묶음에 함께 철해야 한다. 편철 표지가 그
   사실을 알려 주도록 배치별 특채 문서 목록을 뽑아 둔다.
--------------------------------------------------------------------------- */
create or replace view v_batch_concession as
select wo.id as work_order_id,
       n.concession_doc_no,
       sum(n.qty)::int as qty,
       min(n.approved_on) as approved_on,
       min(n.approved_by) as approved_by
  from product_nonconformity n
  join product_lot pl on pl.id = n.product_lot_id
  join work_order wo  on wo.id = pl.work_order_id
 where n.outcome = 'CONCESSION'
 group by wo.id, n.concession_doc_no;

grant select on v_batch_concession to app_role, app_readonly;
