-- ---------------------------------------------------------------------------
-- 작업자 자격 (GMP 부합 점검 G3 · 2026-09-11)
--
-- `process_record.worker_id` 는 "이 사람이 눌렀다" 만 말한다. **그 사람이 그
-- 공정을 해도 되는지는 시스템이 모른다.** 13485 §6.2 가 요구하고, DHR 심사는
-- 기록 위의 이름에 자격을 묻는다.
--
-- ── 막지 않는다 ────────────────────────────────────────────────────────
-- 차단은 S01~S05 뿐이다 (§1). 자격이 없어도 기록은 남는다 - 사람이 이미 한
-- 작업을 시스템이 없던 일로 만들 수는 없다. 대신 `review_flags` 가 짚고,
-- 현장 화면이 그 자리에서 알려 준다.
--
-- 목표는 사람 실수를 줄이는 것이지 사람을 막는 것이 아니다 (사용자 2026-09-11).
--
-- ── 왜 공정 코드로 가리키는가 ──────────────────────────────────────────
-- `dmr_operation.id` 는 제품표준서 개정마다 새로 생긴다. 그것으로 묶으면
-- **개정이 한 번 날 때마다 모든 사람의 자격이 끊긴다.** 설비가 코드로 기록에
-- 남는 것과 같은 이유로(0031) 공정 코드로 가리킨다.
--
-- ── 판정하지 않는다 ────────────────────────────────────────────────────
-- 무엇이 자격인지 시스템이 정하지 않는다. 서면 교육 기록의 번호를 옮겨 적을
-- 뿐이다 - 특채 기록지 번호나 성적서 번호와 같은 자리다 (§1).
-- ---------------------------------------------------------------------------

create table if not exists worker_qualification (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references app_user(id),
  operation_code  text not null,
  valid_from      date not null,
  -- 비우면 기한 없음. 교육에 유효기간이 없는 경우가 있다
  valid_until     date,
  -- 서면 교육 기록의 문서번호. 이것이 근거이고 시스템은 가리킬 뿐이다
  training_doc_no text not null,
  note            text,
  registered_by   uuid not null references app_user(id),
  registered_at   timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);

comment on table worker_qualification is
  '사람 × 공정 자격. 서면 교육 기록의 번호를 옮겨 적는다. 막지 않고 짚는다 (0108)';

create index if not exists worker_qualification_user
  on worker_qualification (user_id);
create index if not exists worker_qualification_op
  on worker_qualification (operation_code);


-- ── 감사추적 · 삭제 차단 · TRUNCATE 차단 (0017 과 같은 세 가지) ─────────
do $$
begin
  execute 'drop trigger if exists worker_qualification_audit on worker_qualification';
  execute 'create trigger worker_qualification_audit after insert or update
             on worker_qualification for each row execute function trg_audit()';

  execute 'drop trigger if exists worker_qualification_no_delete on worker_qualification';
  execute 'create trigger worker_qualification_no_delete before delete
             on worker_qualification for each row execute function trg_block_delete()';

  execute 'drop trigger if exists worker_qualification_no_truncate on worker_qualification';
  execute 'create trigger worker_qualification_no_truncate before truncate
             on worker_qualification for each statement execute function trg_block_delete()';
end $$;

grant select, insert on worker_qualification to app_role;
grant select on worker_qualification to app_readonly;
revoke delete, truncate on worker_qualification from app_role;


-- === 그 날 그 사람이 자격이 있었는가 =======================================
--
-- 작업일 기준으로 묻는다. 오늘 유효한지가 아니라 **그 기록을 남긴 날**에
-- 유효했는지가 기록의 물음이다.

create or replace function worker_qualified(p_user uuid, p_op_code text, p_on date)
returns boolean
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp as $$
  select exists (
    select 1 from worker_qualification q
     where q.user_id = p_user
       and q.operation_code = p_op_code
       and q.valid_from <= p_on
       and (q.valid_until is null or q.valid_until >= p_on))
$$;

grant execute on function worker_qualified(uuid, text, date) to app_role, app_readonly;


-- === 검토 표시가 자격을 짚는다 =============================================
--
-- **자격 줄이 한 줄도 없는 공정은 짚지 않는다.** 자격 관리를 아직 시작하지
-- 않은 공정까지 전부 짚으면 그 표시가 늘 떠 있게 되고, 늘 떠 있는 표시는
-- 아무도 안 본다 (0107 에서 교정에 같은 판단을 했다).

create or replace function review_flags(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp as $$
  select r.kind, r.detail, r.day_no, r.ref
    from review_flags_base(p_wo) r

  union all

  /* 설비: 사용일에 유효한 밸리데이션 · 교정이 있었는가 (0107) */
  select '기한 경과'::text,
         format('%s %s일차 설비 %s: 사용일 %s - 유효한 %s 없음%s',
                o.code, pr.day_no, coalesce(e.code, pr.equipment_id),
                to_char(pr.work_date, 'YYYY-MM-DD'),
                case k.kind when 'VALIDATION' then '밸리데이션' else '교정' end,
                coalesce(' (최근 만료 ' || to_char(
                  (select max(ev.valid_until) from equipment_validation ev
                    where ev.equipment_id = e.id and ev.kind = k.kind),
                  'YYYY-MM-DD') || ')', '')),
         pr.day_no, coalesce(e.code, pr.equipment_id)
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join v_process_equipment ve on ve.process_record_id = pr.id
    left join equipment e on e.id = ve.equipment_id
    join lateral (
      select distinct ev.kind
        from equipment_validation ev
       where ev.equipment_id = ve.equipment_id
    ) k on true
   where pr.work_order_id = p_wo
     and ve.equipment_id is not null
     and not exists (
       select 1 from equipment_validation ev
        where ev.equipment_id = ve.equipment_id
          and ev.kind = k.kind
          and ev.performed_on <= pr.work_date
          and ev.valid_until  >= pr.work_date)

  union all

  /* 사람: 작업일에 그 공정 자격이 있었는가 (0108) */
  select '자격 없음'::text,
         format('%s %s일차 %s: 작업일 %s - 이 공정의 유효한 자격 없음',
                o.code, pr.day_no, u.full_name,
                to_char(pr.work_date, 'YYYY-MM-DD')),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join app_user u on u.id = pr.worker_id
   where pr.work_order_id = p_wo
     /* 이 공정에 자격 줄이 하나라도 있을 때만 묻는다 */
     and exists (select 1 from worker_qualification q
                  where q.operation_code = o.code)
     and not worker_qualified(pr.worker_id, o.code, pr.work_date)

  order by 3 nulls last, 1, 2
$$;

grant execute on function review_flags(uuid) to app_role;
