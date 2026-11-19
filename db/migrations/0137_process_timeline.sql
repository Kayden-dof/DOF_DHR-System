/* ===========================================================================
   0137 · 공정 시간표 · 배치 일정 · 제품표준서 판에 묶인 기록서 양식
         (사용자 2026-11-19)

   «DX2401 공정 타임라인» 아티팩트의 기능을 DHR 에 넣고, 작업표준서 · 제조기록서
   개정안(Rev.01)을 그 판의 제품표준서에 묶는다.

   ── 무엇을 담는가 ─────────────────────────────────────────────────────────
     dmr_timeline   제품표준서 판마다 공정 시간표 한 벌. 공정(01~09) 아래 작업
                    여럿 - 구분(작업 · 대기 · 병행 준비 · 외부), 1일차 0시부터의
                    시작(분), 소요(분), 허용 최소 · 최대(분), 앞 작업, 메모
     work_calendar  회사 근무 달력 한 벌. 근무 요일 · 근무 시각 · 점심 · 공휴일
     batch_plan     배치 계획. 예정 배치번호 · 제품표준서 판 · 시작일 · 시각.
                    작업 지시를 내면 그 지시와 잇는다
     mfg_doc.device_master_id
                    이 문서가 어느 판의 제품표준서에 딸리는가. 비어 있으면 지금처럼
                    현행(is_current) 문서가 모든 지시에 쓰인다

   ── 시간표는 계획이다 ──────────────────────────────────────────────────────
   서면 대조 항목(공정 · 자재 · 구간 · 설비)이 아니다. 고쳐도 대조 확인이 풀리지
   않고, 지시가 나간 판에서도 고칠 수 있다. 기록이 아니므로 일정표 인쇄도 대장에
   남지 않고 아무것도 잠그지 않는다. 고친 것은 감사추적에 남는다.

   ── 작업 하나의 모양 (steps 배열의 원소) ──────────────────────────────────
     id  글자. 시간표 안에서 겹치지 않는다 (앞 작업이 이 이름으로 가리킨다)
     p   공정 차례 두 자리 ('01') - 그 판의 dmr_operation.seq
     n   작업 이름
     k   work 작업 · wait 대기 · prep 병행 준비 · ext 외부
     s   시작 (분, 1일차 0시 = 0)
     d   소요 (분, 1 이상)
     mn · mx  허용 최소 · 최대 (분, 없으면 null)
     a   앞 작업 id 목록
     m   메모 (작업표준서 조항)
   모양은 여기서 막고, p 가 그 판의 공정인지는 저장하는 화면이 본다.

   ── 기록서 양식의 판 ──────────────────────────────────────────────────────
   개정안 양식은 아직 시행 전이라 현행(is_current)이 아니다. 그래도 그 판의
   제품표준서로 낸 지시는 개정안 양식으로 적고 찍어야 한다. 그래서 문서를 판에
   묶는다 - 한 판에 묶인 기록서 양식이 하나라도 있으면 그 판의 지시는 묶인 양식만
   쓰고, 없으면 지금처럼 현행 양식을 쓴다 (lib/br-sheet.ts). 이미 나간 Rev.00 지시의
   종이 모양은 그대로다.
=========================================================================== */

/* === 1. 공정 시간표 ======================================================= */

create or replace function timeline_steps_ok(p jsonb)
returns boolean language plpgsql immutable
set search_path = pg_catalog, public, pg_temp as $$
declare e jsonb; ids text[] := '{}'; a jsonb; v text;
begin
  if jsonb_typeof(p) <> 'array' then return false; end if;
  for e in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    v := e ->> 'id';
    if v is null or btrim(v) = '' or v = any(ids) then return false; end if;
    ids := ids || v;
    if coalesce(e ->> 'p', '') !~ '^[0-9]{2}$' then return false; end if;
    if btrim(coalesce(e ->> 'n', '')) = '' then return false; end if;
    if coalesce(e ->> 'k', '') not in ('work', 'wait', 'prep', 'ext') then return false; end if;
    if jsonb_typeof(e -> 's') is distinct from 'number' or (e ->> 's')::numeric < 0
       or (e ->> 's')::numeric <> trunc((e ->> 's')::numeric) then return false; end if;
    if jsonb_typeof(e -> 'd') is distinct from 'number' or (e ->> 'd')::numeric < 1
       or (e ->> 'd')::numeric <> trunc((e ->> 'd')::numeric) then return false; end if;
    if coalesce(jsonb_typeof(e -> 'mn'), 'null') not in ('null', 'number')
       or coalesce(jsonb_typeof(e -> 'mx'), 'null') not in ('null', 'number') then return false; end if;
    if (e ->> 'mn')::numeric < 0 or (e ->> 'mx')::numeric < 0 then return false; end if;
    if (e ->> 'mn')::numeric > (e ->> 'mx')::numeric then return false; end if;
    if coalesce(jsonb_typeof(e -> 'a'), 'array') <> 'array' then return false; end if;
    if coalesce(jsonb_typeof(e -> 'm'), 'string') not in ('string', 'null') then return false; end if;
  end loop;
  /* 앞 작업은 같은 시간표 안의 작업이어야 하고 자기 자신이면 안 된다 */
  for e in select * from jsonb_array_elements(p) loop
    for a in select * from jsonb_array_elements(coalesce(e -> 'a', '[]'::jsonb)) loop
      if jsonb_typeof(a) <> 'string' or not ((a #>> '{}') = any(ids))
         or (a #>> '{}') = e ->> 'id' then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create table if not exists dmr_timeline (
  device_master_id uuid primary key references device_master(id) on delete cascade,
  steps      jsonb not null default '[]'::jsonb,
  basis      text not null default '',            -- 근거 문서 (예: 작업표준서 개정안 v5)
  updated_by uuid not null references app_user(id),
  updated_at timestamptz not null default now(),
  constraint dmr_timeline_steps check (timeline_steps_ok(steps))
);
comment on table dmr_timeline is
  '제품표준서 판마다 공정 시간표 한 벌. 계획이라 서면 대조 확인과 무관하다 (0137)';

drop trigger if exists dmr_timeline_audit on dmr_timeline;
create trigger dmr_timeline_audit after insert or update or delete on dmr_timeline
  for each row execute function trg_audit('device_master_id');
drop trigger if exists dmr_timeline_no_truncate on dmr_timeline;
create trigger dmr_timeline_no_truncate before truncate on dmr_timeline
  for each statement execute function trg_block_delete();
grant select, insert, update, delete on dmr_timeline to app_role;
grant select on dmr_timeline to app_readonly;
revoke truncate on dmr_timeline from app_role;

/* === 2. 근무 달력 (회사 한 벌) ============================================ */

create table if not exists work_calendar (
  id         uuid primary key default gen_random_uuid(),
  one        boolean not null default true unique check (one),   -- 한 줄뿐
  workdays   int[] not null default '{1,2,3,4,5}'                -- 0 일 · 1 월 … 6 토
             check (workdays <@ array[0,1,2,3,4,5,6]),
  day_start  int not null default 480 check (day_start between 0 and 1439),
  day_end    int not null default 1020 check (day_end between 1 and 1440),
  lunch      boolean not null default true,                      -- 12~13시
  skip_off   boolean not null default true,     -- 손작업이 휴무일에 걸리면 다음 근무일로
  holidays   date[] not null default '{}',
  updated_by uuid references app_user(id),
  updated_at timestamptz not null default now(),
  check (day_end > day_start)
);
comment on table work_calendar is
  '회사 근무 달력 한 줄. 배치 일정이 날짜에 얹힐 때 쓴다 (0137)';
insert into work_calendar (one) values (true) on conflict (one) do nothing;

drop trigger if exists work_calendar_audit on work_calendar;
create trigger work_calendar_audit after insert or update or delete on work_calendar
  for each row execute function trg_audit('id');
drop trigger if exists work_calendar_no_truncate on work_calendar;
create trigger work_calendar_no_truncate before truncate on work_calendar
  for each statement execute function trg_block_delete();
grant select, update on work_calendar to app_role;
grant select on work_calendar to app_readonly;

/* === 3. 배치 계획 ========================================================= */

create table if not exists batch_plan (
  id               uuid primary key default gen_random_uuid(),
  label            text not null check (btrim(label) <> ''),       -- 예정 배치번호
  device_master_id uuid not null references device_master(id) on delete cascade,
  start_on         date not null,
  start_min        int  not null default 480 check (start_min between 0 and 1439),
  work_order_id    uuid unique references work_order(id) on delete set null,   -- 계획이라 지시가 지워지면 이음만 풀린다
  note             text not null default '',
  created_by       uuid not null references app_user(id),
  created_at       timestamptz not null default now()
);
comment on table batch_plan is
  '배치 계획. 시간표를 날짜에 얹는 시작점. 계획이라 기록이 아니다 (0137)';
create index if not exists batch_plan_start on batch_plan (start_on);

/* 이은 지시는 같은 판의 제품표준서로 나간 것이어야 한다 - 다른 판의 시간표로
   일정을 짜면 종이와 일정이 다른 공정을 말한다 */
create or replace function trg_batch_plan_wo()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp as $$
declare v_dm uuid;
begin
  if new.work_order_id is null then return new; end if;
  select device_master_id into v_dm from work_order where id = new.work_order_id;
  if v_dm is distinct from new.device_master_id then
    raise exception '이은 작업 지시의 제품표준서 판이 이 계획의 판과 다릅니다';
  end if;
  return new;
end $$;
drop trigger if exists batch_plan_wo on batch_plan;
create trigger batch_plan_wo before insert or update on batch_plan
  for each row execute function trg_batch_plan_wo();

drop trigger if exists batch_plan_audit on batch_plan;
create trigger batch_plan_audit after insert or update or delete on batch_plan
  for each row execute function trg_audit('id');
drop trigger if exists batch_plan_no_truncate on batch_plan;
create trigger batch_plan_no_truncate before truncate on batch_plan
  for each statement execute function trg_block_delete();
grant select, insert, update, delete on batch_plan to app_role;
grant select on batch_plan to app_readonly;
revoke truncate on batch_plan from app_role;

/* === 4. 문서를 제품표준서 판에 묶는다 ===================================== */

alter table mfg_doc add column if not exists device_master_id uuid references device_master(id) on delete set null;
comment on column mfg_doc.device_master_id is
  '이 문서가 딸린 제품표준서 판 (0137). 비면 현행 문서가 모든 지시에 쓰인다';
create index if not exists mfg_doc_dm on mfg_doc (device_master_id) where device_master_id is not null;

/* 이 판의 지시가 쓰는 기록서 양식인가. 판에 묶인 기록서 양식이 하나라도 있으면
   묶인 것만, 없으면 묶이지 않은 현행 양식. 현장 화면 · 기록서 · 인쇄가 이 하나를 쓴다 */
create or replace function br_form_in_scope(p_doc_dm uuid, p_current boolean, p_dm uuid)
returns boolean language sql stable
set search_path = pg_catalog, public, pg_temp as $$
  select case
           when exists (select 1 from mfg_doc x
                         where x.kind = 'BR' and x.form is not null and x.device_master_id = p_dm)
             then p_doc_dm is not distinct from p_dm
           else p_current and p_doc_dm is null
         end
$$;
grant execute on function br_form_in_scope(uuid, boolean, uuid) to app_role, app_readonly;

/* === 5. 개정본 복사가 시간표도 옮긴다 ===================================== *
 * 0129 의 정의에 시간표 한 벌을 더했다. 판에 묶인 문서는 옮기지 않는다 -
 * 새 판이 어느 양식을 쓰는지는 새 판의 일이다.
 */
create or replace function copy_dmr_structure(p_src uuid, p_dst uuid)
returns int language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare n int := 0; r record; new_op uuid; b record; new_bom uuid;
begin
  if p_src = p_dst then
    raise exception '같은 제품표준서로는 복사할 수 없습니다';
  end if;
  if not exists (select 1 from device_master where id = p_src) then
    raise exception '가져올 제품표준서를 찾을 수 없습니다';
  end if;
  if not exists (select 1 from device_master where id = p_dst) then
    raise exception '옮겨 넣을 제품표준서를 찾을 수 없습니다';
  end if;
  if exists (select 1 from dmr_operation where device_master_id = p_dst) then
    raise exception '받을 제품표준서에 이미 공정이 있습니다. 비어 있는 표준서에만 복사할 수 있습니다';
  end if;

  for r in
    select * from dmr_operation where device_master_id = p_src order by seq
  loop
    insert into dmr_operation
      (device_master_id, seq, code, name, after_cutting, typical_day, takes_rework)
    values
      (p_dst, r.seq, r.code, r.name, r.after_cutting, r.typical_day, r.takes_rework)
    returning id into new_op;
    n := n + 1;

    for b in select * from dmr_bom where operation_id = r.id loop
      insert into dmr_bom (operation_id, component_item_id, basis, qty_per_unit)
      values (new_op, b.component_item_id, b.basis, b.qty_per_unit)
      returning id into new_bom;

      insert into dmr_bom_tier (dmr_bom_id, min_sheets, max_sheets, qty, qty_max)
      select new_bom, t.min_sheets, t.max_sheets, t.qty, t.qty_max
        from dmr_bom_tier t where t.dmr_bom_id = b.id;
    end loop;

    /* 걸린 설비도 함께 온다. 살아 있는 연결만 */
    insert into operation_equipment (operation_id, equipment_id, is_active)
    select new_op, oe.equipment_id, true
      from operation_equipment oe
     where oe.operation_id = r.id and oe.is_active;
  end loop;

  /* 공정 시간표 한 벌 (0137). 받는 쪽에 이미 있으면 두지 않는다 */
  insert into dmr_timeline (device_master_id, steps, basis, updated_by)
  select p_dst, t.steps, t.basis,
         coalesce(nullif(current_setting('app.user_id', true), '')::uuid, t.updated_by)
    from dmr_timeline t
   where t.device_master_id = p_src
  on conflict (device_master_id) do nothing;

  return n;
end $$;

grant execute on function copy_dmr_structure(uuid, uuid) to app_role;
grant execute on function timeline_steps_ok(jsonb) to app_role, app_readonly;
