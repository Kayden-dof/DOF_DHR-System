/* ===========================================================================
   0133 · 공정 기록 한 줄에 설비 여럿 (사용자 2026-11-11)

   "설비 여러개 선택하게도 안돼어있네" · "이부분에 설비 여러개를 한번에 쓰는 경우가
   있을거 같은데" - 동결건조는 동결건조기와 캘리퍼스를, 세척은 정제수 장치와 초음파
   세척기를 함께 쓴다. 그런데 공정 기록에는 설비가 하나만 들어갔고(equipment_ref ·
   0032), 제조기록서 양식의 둘째 설비 줄은 늘 비어 나갔다.

   ── 첫 설비는 그 자리에 둔다 ──────────────────────────────────────────
   equipment_ref · equipment_id 는 그대로 «첫 설비» 다. 둘째부터를 새 칸에 담는다.
   그 두 칸을 읽는 화면 · 종이 · 검토는 깨지지 않고, 여럿을 알아야 하는 자리만
   새 칸을 함께 읽는다.

     extra_equipment_refs  설비 대장을 가리키는 참조 (둘째부터)
     extra_equipment_ids   그때 종이에 찍힌 코드 (0032 의 스냅숏과 같은 뜻)

   배열에는 외래키가 걸리지 않는다. 그래서 넣을 때 트리거가 대장에 있는지 본다.
   같은 설비가 두 번 오거나 첫 설비와 겹치면 한 번만 남긴다.

   ── 시작한 뒤에 설비를 고친다 ─────────────────────────────────────────
   현장 화면이 제조기록서의 기기번호 칸에서 설비를 고른다 (기록서 중심 화면).
   그래서 시작 뒤에도 설비 칸이 바뀐다. 참조가 바뀌면 코드 스냅숏도 그 자리에서
   다시 떠 온다 - 둘이 어긋나면 종이와 대장이 갈라진다. 잠긴 기록(S04)은
   trg_s04_locked 가, 남의 기록은 trg_record_own 이 그대로 막는다. 감사추적은
   같은 줄의 고침으로 남는다.

   ── 한 곳에서 펼친다 ───────────────────────────────────────────────
   기록 → 설비 잇기는 v_process_equipment 한 곳이다 (0032). 그 뷰가 둘째부터도
   펼치므로 검토 지원(사용일 밸리데이션 · 교정), 설비 사용 기록, 설비별 사용 수가
   따로 고치지 않아도 모든 설비를 본다. 원가(v_process_cost)는 설비 시간당 단가를
   모두 더한다 - 하나라도 단가가 없으면 지금처럼 «단가 없음»(null)이다.
=========================================================================== */

alter table process_record add column if not exists extra_equipment_refs uuid[];
alter table process_record add column if not exists extra_equipment_ids  text[];

comment on column process_record.extra_equipment_refs is
  '둘째부터의 설비 (설비 대장 참조). 첫 설비는 equipment_ref (0133)';
comment on column process_record.extra_equipment_ids is
  '둘째부터의 설비 코드 스냅숏. 넣을 때 · 참조가 바뀔 때 대장에서 떠 온다 (0133)';


/* --- 스냅숏 · 대장 확인 (0032 의 정의에 둘째부터와 고침을 더한다) ---------- */
create or replace function trg_pr_equipment_snapshot()
returns trigger language plpgsql as $$
declare v_missing int;
begin
  /* 첫 설비. 넣을 때는 비어 있으면, 고칠 때는 참조가 바뀌면 다시 떠 온다 */
  if tg_op = 'INSERT' then
    if new.equipment_ref is not null and new.equipment_id is null then
      select code into new.equipment_id from equipment where id = new.equipment_ref;
    end if;
  elsif new.equipment_ref is distinct from old.equipment_ref then
    new.equipment_id := null;
    if new.equipment_ref is not null then
      select code into new.equipment_id from equipment where id = new.equipment_ref;
    end if;
  end if;

  /* 둘째부터. 참조가 그대로면 이미 찍힌 코드를 건드리지 않는다 */
  if tg_op = 'UPDATE'
     and new.extra_equipment_refs is not distinct from old.extra_equipment_refs
     and new.equipment_ref is not distinct from old.equipment_ref then
    return new;
  end if;

  if new.extra_equipment_refs is not null then
    /* 빈 값 · 첫 설비와 겹치는 것 · 두 번 온 것을 걷는다. 고른 차례는 지킨다 */
    select array_agg(r order by ord) into new.extra_equipment_refs
      from (select distinct on (u.r) u.r, u.ord
              from unnest(new.extra_equipment_refs) with ordinality as u(r, ord)
             where u.r is not null and u.r is distinct from new.equipment_ref
             order by u.r, u.ord) q;
  end if;

  if new.extra_equipment_refs is not null then
    select count(*) into v_missing
      from unnest(new.extra_equipment_refs) as r
     where not exists (select 1 from equipment e where e.id = r);
    if v_missing > 0 then
      raise exception '설비 대장에 없는 설비가 있습니다 (%건)', v_missing;
    end if;
    select array_agg(e.code order by u.ord) into new.extra_equipment_ids
      from unnest(new.extra_equipment_refs) with ordinality as u(r, ord)
      join equipment e on e.id = u.r;
  else
    new.extra_equipment_ids := null;
  end if;

  return new;
end $$;

drop trigger if exists process_record_equipment_snapshot on process_record;
create trigger process_record_equipment_snapshot
  before insert or update of equipment_ref, extra_equipment_refs on process_record
  for each row execute function trg_pr_equipment_snapshot();


/* --- 기록 → 설비 잇기: 둘째부터도 펼친다 ---------------------------------- */
create or replace view v_process_equipment as
select pr.id as process_record_id,
       pr.equipment_id  as code_snapshot,
       coalesce(pr.equipment_ref, e2.id) as equipment_id
  from process_record pr
  left join equipment e2
    on pr.equipment_ref is null and e2.code = pr.equipment_id
 where pr.equipment_id is not null or pr.equipment_ref is not null
union all
select pr.id, x.code, x.ref
  from process_record pr
  cross join lateral unnest(pr.extra_equipment_refs, pr.extra_equipment_ids) as x(ref, code)
 where pr.extra_equipment_refs is not null;

grant select on v_process_equipment to app_role;


/* --- 원가: 설비 시간당 단가를 모두 더한다 (0076 의 정의에서 equip_rate 만) -- */
create or replace view v_process_cost as
select pr.id as process_record_id,
       pr.work_order_id,
       pr.product_lot_id,
       pr.worker_id,
       pr.equipment_id,
       pr.work_date,
       (pr.started_at is not null and pr.ended_at is not null)          as timed,
       coalesce(round(extract(epoch from pr.ended_at - pr.started_at)
                      / 3600.0, 4), 0)                                  as hours,
       (select max(labour_rate_at(ur.role, pr.work_date))
          from user_role ur where ur.user_id = pr.worker_id)            as labour_rate,
       case
         when pr.extra_equipment_ids is null then equipment_hourly_cost(pr.equipment_id)
         else (select case when bool_or(q.c is null) then null else sum(q.c) end
                 from (select equipment_hourly_cost(x) as c
                         from unnest(array[pr.equipment_id] || pr.extra_equipment_ids) as x
                        where x is not null) q)
       end                                                              as equip_rate
  from process_record pr;

grant select on v_process_cost to app_role, app_readonly;
