-- ---------------------------------------------------------------------------
-- 계측기 교정을 밸리데이션과 갈라 담는다 (GMP 부합 점검 F4 · 2026-09-11)
--
-- `equipment_validation` 에 종류 칸이 없었다. 그래서 공정 밸리데이션과 계측기
-- 교정이 한 표에 섞이고, **"이 저울의 교정이 유효한가" 를 물을 수 없었다.**
--
-- WS-01 의 계량(292.2 g)과 WS-05 의 pH 측정은 계측기에 기댄다. 그 계측기가
-- 교정되어 있었는지를 DHR 이 답하지 못하면 13485 §7.6 을 못 짚는다.
--
-- ── 왜 표를 새로 만들지 않는가 ──────────────────────────────────────────
-- 담는 것이 같다 - 수행일 · 유효기한 · 보고서 번호. 표를 나누면 "이 설비가
-- 지금 유효한가" 를 묻는 자리마다 두 곳을 봐야 하고, 언젠가 한쪽만 고쳐진다.
-- 칸 하나를 더해 가른다.
--
-- ── 이미 있는 줄은 밸리데이션이다 ───────────────────────────────────────
-- 그때까지 이 표에 들어간 것은 전부 공정 밸리데이션이었다. 기본값으로 메우지
-- 않고 **있는 줄만** 채운다 (§10 - 이관이 where 없이 기준정보를 update 하지
-- 않는다).
--
-- ── 막지 않는다 ────────────────────────────────────────────────────────
-- 교정이 만료된 계측기로도 기록은 남는다. 차단은 S01~S05 뿐이다 (§1).
-- 대신 `review_flags` 가 밸리데이션과 같은 방식으로 짚는다 - 사용일에 유효한
-- 것이 없으면 검토 표시가 뜬다.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'equipment_check_kind') then
    create type equipment_check_kind as enum ('VALIDATION', 'CALIBRATION');
  end if;
end $$;

alter table equipment_validation
  add column if not exists kind equipment_check_kind;

comment on column equipment_validation.kind is
  '이 이력이 무엇인가. VALIDATION 공정 밸리데이션 · CALIBRATION 계측기 교정';

-- 그때까지 들어간 것은 전부 밸리데이션이었다. 빈 줄만 채운다
update equipment_validation set kind = 'VALIDATION' where kind is null;

alter table equipment_validation alter column kind set default 'VALIDATION';
alter table equipment_validation alter column kind set not null;


-- === 검토 표시가 교정도 본다 ===============================================
--
-- 0033 은 "사용일에 유효한 밸리데이션 없음" 만 짚었다. 교정이 갈라졌으므로
-- 같은 물음을 교정에도 던진다. 문구는 종류를 밝혀 적는다 - 무엇이 만료됐는지
-- 모르면 조작자가 무엇을 해야 할지 모른다.

create or replace function review_flags(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp as $$
  select r.kind, r.detail, r.day_no, r.ref
    from review_flags_base(p_wo) r

  union all

  select '기한 경과'::text,
         format('%s %s일차 설비 %s: 사용일 %s 에 유효한 %s 없음%s',
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
    /*
     * 종류마다 따로 묻는다. 다만 **그 종류의 이력이 한 줄이라도 있는 설비만**
     * 본다 - 교정 이력을 아예 안 만든 설비(예: 단순 용기)까지 "교정 없음" 이라고
     * 짚으면 그 표시가 늘 떠 있게 되고, 늘 떠 있는 표시는 아무도 안 본다.
     */
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

  order by 3 nulls last, 1, 2
$$;

grant execute on function review_flags(uuid) to app_role;


-- === 현장 타일의 만료도 종류마다 센다 =======================================
--
-- `operation_equipment_list` 가 `max(valid_until)` 을 종류 없이 잡고 있었다
-- (0024 → 0032). 그러면 **저울 교정 하나가 만료된 밸리데이션을 덮는다** -
-- 현장 타일에 "유효" 로 뜨는데 실제로는 그 공정의 밸리데이션이 지나 있다.
--
-- 종류마다 마지막 만료를 잡고 그중 **가장 이른 것**을 돌려준다. 하나라도
-- 지났으면 지난 것으로 보인다. 이력이 아예 없으면 null 이고, 화면이 그것을
-- "밸리데이션 기록 없음" 으로 짚는다.
--
-- 옛 이관은 고치지 않는다. 새 정의를 여기 둔다 (§4.10 과 같은 원칙 -
-- 지나간 것은 지나간 대로 둔다).

create or replace function operation_equipment_list(p_op uuid)
returns table (id uuid, code text, name text, note text, valid_until date)
language sql stable as $$
  select e.id, e.code, e.name, e.note,
         (select min(m.valid_until)
            from (select ev.kind, max(ev.valid_until) as valid_until
                    from equipment_validation ev
                   where ev.equipment_id = e.id
                   group by ev.kind) m)
    from operation_equipment oe
    join equipment e on e.id = oe.equipment_id
   where oe.operation_id = p_op and oe.is_active and e.is_active
   order by e.code
$$;
grant execute on function operation_equipment_list(uuid) to app_role;
