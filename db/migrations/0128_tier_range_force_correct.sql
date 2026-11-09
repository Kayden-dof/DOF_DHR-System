/* ---------------------------------------------------------------------------
   구성표 양의 범위 · 잠긴 기록의 강제 정정 (사용자 2026-11-10)

   ── 1. 장입 구간의 양을 범위로 ─────────────────────────────────────────
   작업표준서는 시약 양을 범위로 준다 - NaCl 처리의 염화나트륨은 "10장 이하
   292 ~ 293 g, 10장 초과 584 ~ 586 g" 이다. 구성표 구간은 값 하나(qty)만
   가져서, 범위 안의 293 g 을 적은 기록이 검토에 "구간 이탈" 로 떴다
   (B261109-01, 종이 기록 293 g).

   qty 는 그대로 하한이자 지시서에 찍히는 값이고, qty_max 를 더한다. 비어
   있으면 지금과 같이 qty 하나와 견준다. 범위를 판정에 쓰는 곳은 검토 표시
   하나다 - 막는 것이 아니라 어긋난 두 값을 나란히 적는 자리다 (§8.5).

   ── 2. 잠긴 기록의 강제 정정 ──────────────────────────────────────────
   일차 마감(S04) 뒤에는 기록을 고칠 길이 없다 (§10 은 잠금 해제를 금지한다).
   종이 기록서를 옮겨 적다 잘못 들어간 것까지 영구히 굳는다. 사용자는
   "강제 정정이 좀 필요하겠네" 라고 정했다.

   잠금을 풀지 않는다. 시스템관리자가 사유를 적고 **한 기록의 한 칸**만
   고친다. 무엇을 무엇으로 왜 고쳤는지 record_correction 에 한 줄 남고,
   감사추적에도 남는다. 지금 열린 칸은 자재 미사용 사유 하나다 - 필요한
   칸이 생기면 이 함수에 갈래를 더한다.
--------------------------------------------------------------------------- */

/* === 1. 구간 양의 상한 ================================================== */
alter table dmr_bom_tier add column if not exists qty_max numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dmr_bom_tier_qty_max') then
    alter table dmr_bom_tier add constraint dmr_bom_tier_qty_max
      check (qty_max is null or qty_max >= qty);
  end if;
end $$;

comment on column dmr_bom_tier.qty_max is
  '그 구간 소요량의 상한. 비어 있으면 qty 하나다. 작업표준서가 범위로 준 양 (0128)';

create or replace function required_qty_max(p_op uuid, p_item uuid, p_sheets int)
returns numeric language sql stable as $fn$
  select coalesce(t.qty_max, t.qty)
    from dmr_bom b
    join dmr_bom_tier t on t.dmr_bom_id = b.id
   where b.operation_id = p_op and b.component_item_id = p_item
     and b.basis = 'SHEET_TIER'
     and p_sheets >= t.min_sheets
     and (t.max_sheets is null or p_sheets <= t.max_sheets)
$fn$;

comment on function required_qty_max(uuid, uuid, int) is
  '장입 구간 소요량의 상한. 상한이 없으면 소요량 그대로 (0128)';

grant execute on function required_qty_max(uuid, uuid, int) to app_role;


/* === 2. 검토 표시: 범위 안이면 구간 이탈이 아니다 =========================
 * 0040 의 정의를 파일에서 그대로 옮기고 구간 이탈 갈래만 고쳤다
 * (need_max · 범위 비교 · 문구의 "292~293").
 */
create or replace function review_flags_base(p_wo uuid)
returns table (kind text, detail text, day_no int, ref text)
language sql stable as $$

  select distinct '시각 모순'::text,
         format('%s(%s) %s일차 %s: 시작 %s, 종료 %s - 시각이 역전되어 있음',
                o.name, o.code, pr.day_no, u.full_name,
                to_char(timezone('Asia/Seoul', pr.started_at), 'HH24:MI'),
                to_char(timezone('Asia/Seoul', pr.ended_at),   'HH24:MI')),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join app_user u on u.id = pr.worker_id
   where pr.work_order_id = p_wo
     and pr.started_at is not null and pr.ended_at is not null
     and pr.ended_at < pr.started_at

  union all

  select distinct '시각 모순'::text,
         format('%s%s(%s) 종료 %s 보다 %s(%s) 시작 %s 가 빠름',
                coalesce(pl.lot_no || ' ', ''),
                a.name, a.code, to_char(timezone('Asia/Seoul', pa.ended_at),  'MM-DD HH24:MI'),
                b.name, b.code, to_char(timezone('Asia/Seoul', pb.started_at),'MM-DD HH24:MI')),
         pb.day_no, b.code
    from process_record pa
    join dmr_operation a on a.id = pa.operation_id
    join process_record pb on pb.work_order_id = pa.work_order_id
    join dmr_operation b on b.id = pb.operation_id
    left join product_lot pl on pl.id = pb.product_lot_id
   where pa.work_order_id = p_wo
     and b.seq = a.seq + 1
     and pa.ended_at is not null and pb.started_at is not null
     and pb.started_at < pa.ended_at
     and pa.product_lot_id is not distinct from pb.product_lot_id

  union all

  select '수량 불일치'::text,
         format('%s %s: 불출 %s, 반납 %s - 반납이 더 큼',
                i.name, ml.lot_no,
                trim(to_char(x.issued, 'FM999999990.###')),
                trim(to_char(x.returned, 'FM999999990.###'))),
         null::int, ml.lot_no
    from (
      select mi.material_lot_id,
             sum(mi.qty) as issued,
             coalesce((select sum(sm.qty) from stock_movement sm
                        where sm.work_order_id = p_wo
                          and sm.type = 'RETURN'
                          and sm.material_lot_id = mi.material_lot_id), 0) as returned
        from material_issue mi
        join process_record pr on pr.id = mi.process_record_id
       where pr.work_order_id = p_wo
       group by mi.material_lot_id
    ) x
    join material_lot ml on ml.id = x.material_lot_id
    join item i on i.id = ml.item_id
   where x.returned > x.issued

  union all

  select '구간 이탈'::text,
         format('%s(%s) %s: 장입 %s장 기준 %s %s 인데 %s %s 기입',
                o.name, o.code, i.name, wo.sheet_count,
                trim(to_char(x.need, 'FM999999990.###'))
                  || case when x.need_max > x.need
                          then '~' || trim(to_char(x.need_max, 'FM999999990.###')) else '' end,
                i.usage_uom,
                trim(to_char(x.put,  'FM999999990.###')), i.usage_uom),
         pr.day_no, o.code
    from (
      select pr2.id as pr_id, ml2.item_id, sum(mi2.qty) as put,
             required_qty(pr2.operation_id, ml2.item_id, wo2.sheet_count, 0) as need,
             required_qty_max(pr2.operation_id, ml2.item_id, wo2.sheet_count) as need_max
        from material_issue mi2
        join process_record pr2 on pr2.id = mi2.process_record_id
        join work_order wo2 on wo2.id = pr2.work_order_id
        join material_lot ml2 on ml2.id = mi2.material_lot_id
       where pr2.work_order_id = p_wo
       group by pr2.id, ml2.item_id, pr2.operation_id, wo2.sheet_count
    ) x
    join process_record pr on pr.id = x.pr_id
    join dmr_operation o on o.id = pr.operation_id
    join work_order wo on wo.id = pr.work_order_id
    join item i on i.id = x.item_id
    join dmr_bom b on b.operation_id = pr.operation_id and b.component_item_id = x.item_id
   where b.basis = 'SHEET_TIER'
     and x.need is not null
     and (x.put < x.need or x.put > coalesce(x.need_max, x.need))

  union all

  select '기입 누락'::text,
         format('%s(%s) %s일차: 자재를 기록하지 않고 마감함 - 사유 "%s"',
                o.name, o.code, pr.day_no, pr.no_material_reason),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
   where pr.work_order_id = p_wo
     and pr.no_material_reason is not null
     and exists (select 1 from dmr_bom b where b.operation_id = pr.operation_id)

  union all

  select '기입 누락'::text,
         format('%s(%s) %s일차 %s: 종료 시각이 빈 채로 기록서가 발행됨',
                o.name, o.code, pr.day_no, u.full_name),
         pr.day_no, o.code
    from process_record pr
    join dmr_operation o on o.id = pr.operation_id
    join app_user u on u.id = pr.worker_id
   where pr.work_order_id = p_wo
     and pr.ended_at is null
     and exists (select 1 from day_lock dl
                  where dl.work_order_id = pr.work_order_id
                    and dl.day_no = pr.day_no
                    and dl.worker_id = pr.worker_id)

  union all

  select '참조 불일치'::text,
         format('지정 원재료는 %s 인데 %s 가 투입됨 (%s · %s)',
                spec.lot_no, ml.lot_no, o.name, o.code),
         pr.day_no, ml.lot_no
    from material_issue mi
    join process_record pr on pr.id = mi.process_record_id
    join dmr_operation o on o.id = pr.operation_id
    join material_lot ml on ml.id = mi.material_lot_id
    join item i on i.id = ml.item_id
    join work_order wo on wo.id = pr.work_order_id
    join material_lot spec on spec.id = wo.material_lot_id
   where pr.work_order_id = p_wo
     and i.type = 'RAW'
     and ml.id <> wo.material_lot_id

  union all

  /* --- 8. 예정 개수와 재단 개수가 다름 (형명별이 아니라 총량) ------------- */
  select '수량 불일치'::text,
         format('예정 %s개, 재단 %s개', wo.planned_units, x.made),
         null::int, wo.batch_no
    from work_order wo
    join (
      select work_order_id, sum(qty_produced)::int as made
        from product_lot where work_order_id = p_wo group by work_order_id
    ) x on x.work_order_id = wo.id
   where wo.id = p_wo
     and wo.planned_units is not null
     and x.made <> wo.planned_units
$$;

grant execute on function review_flags_base(uuid) to app_role;


/* === 3. 강제 정정 ======================================================= */
create table if not exists record_correction (
  id                uuid primary key default gen_random_uuid(),
  process_record_id uuid not null references process_record(id),
  field             text not null check (field in ('no_material_reason')),
  old_value         text,
  new_value         text,
  why               text not null check (btrim(why) <> ''),
  corrected_by      uuid not null references app_user(id),
  corrected_at      timestamptz not null default now()
);

comment on table record_correction is
  '잠긴 공정 기록을 시스템관리자가 사유와 함께 고친 내역. 한 줄이 한 칸이다 (0128)';

create index if not exists record_correction_pr_idx on record_correction (process_record_id);

drop trigger if exists record_correction_audit on record_correction;
create trigger record_correction_audit after insert or update or delete
  on record_correction for each row execute function trg_audit('id');

drop trigger if exists record_correction_no_truncate on record_correction;
create trigger record_correction_no_truncate before truncate
  on record_correction for each statement execute function trg_block_delete();

/* 쓰기는 아래 함수로만 한다. 보기만 연다 */
revoke all on record_correction from app_role;
grant select on record_correction to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke all on record_correction from app_readonly';
    execute 'grant select on record_correction to app_readonly';
  end if;
end $$;

/* S04 트리거: 강제 정정이 연 그 기록 하나만 지나간다. 0014 정의에서 갈래 하나를 더했다 */
create or replace function trg_s04_locked()
returns trigger language plpgsql as $fn$
declare wo uuid; d int; w uuid; bn text;
begin
  if tg_table_name = 'process_record' then
    wo := coalesce(new.work_order_id, old.work_order_id);
    d  := coalesce(new.day_no, old.day_no);
    w  := coalesce(new.worker_id, old.worker_id);
  else
    select pr.work_order_id, pr.day_no, pr.worker_id into wo, d, w
      from process_record pr
     where pr.id = coalesce(new.process_record_id, old.process_record_id);
  end if;

  if is_locked(wo, d, w) then
    /*
     * 강제 정정 (0128). force_correct_reason 이 그 기록 하나에 대해서만 연다.
     * 표시(app.force_correct)는 누구나 걸 수 있으므로, 실행 주체가 app_role ·
     * app_readonly 가 아닐 때 - 곧 security definer 함수 안일 때 - 만 믿는다.
     * 화면 코드가 표시를 걸고 직접 고치는 길은 그래서 열리지 않는다.
     */
    if tg_table_name = 'process_record'
       and current_setting('app.force_correct', true) = new.id::text
       and current_user not in ('app_role', 'app_readonly') then
      return new;
    end if;
    select batch_no into bn from work_order where id = wo;
    raise exception 'S04: 인쇄 완료된 기록은 수정할 수 없습니다 (배치 %, %일차)',
      coalesce(bn, wo::text), d;
  end if;
  return new;
end $fn$;

create or replace function force_correct_reason(p_pr uuid, p_reason text, p_why text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  v_actor uuid := current_user_id();
  r       record;
begin
  if v_actor is null then
    raise exception '세션 사용자가 설정되지 않았습니다 (app.user_id)';
  end if;
  if not has_role('SYS_ADMIN') then
    raise exception '강제 정정은 시스템관리자만 할 수 있습니다';
  end if;
  if p_why is null or btrim(p_why) = '' then
    raise exception '강제 정정 사유를 적으십시오';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '자재 미사용 사유를 적으십시오';
  end if;

  select id, work_order_id, day_no, worker_id, no_material_reason
    into r from process_record where id = p_pr for update;
  if not found then
    raise exception '공정 기록을 찾을 수 없습니다';
  end if;
  if not is_locked(r.work_order_id, r.day_no, r.worker_id) then
    raise exception '잠기지 않은 기록입니다. 현장 화면에서 고치십시오';
  end if;
  if r.no_material_reason is null then
    raise exception '자재 미사용 사유로 마감한 기록이 아닙니다';
  end if;
  if r.no_material_reason = btrim(p_reason) then
    raise exception '지금 값과 같습니다';
  end if;

  perform set_config('app.force_correct', p_pr::text, true);
  update process_record set no_material_reason = btrim(p_reason) where id = p_pr;
  perform set_config('app.force_correct', '', true);

  insert into record_correction (process_record_id, field, old_value, new_value, why, corrected_by)
  values (p_pr, 'no_material_reason', r.no_material_reason, btrim(p_reason), btrim(p_why), v_actor);
end $fn$;

comment on function force_correct_reason(uuid, text, text) is
  '잠긴 공정 기록의 자재 미사용 사유를 시스템관리자가 사유와 함께 고친다. 잠금은 풀지 않는다 (0128)';

revoke all on function force_correct_reason(uuid, text, text) from public;
grant execute on function force_correct_reason(uuid, text, text) to app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_readonly') then
    execute 'revoke all on function force_correct_reason(uuid, text, text) from app_readonly';
  end if;
end $$;

/* === 4. 시연 자료 비우기가 새 표를 안다 ===================================
 * record_correction 이 process_record 를 가리키므로 비우는 차례에 넣는다
 * (0105 와 같은 까닭, PRG-06 이 짚는다). 0105 의 정의를 떠 와 한 줄만 끼웠다.
 */
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
  delete from record_correction;   -- process_record 를 가리킨다 (0128)
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


/* === 5. 발행 뒤 구성표 잠금: 비어 있던 상한 채우기만 연다 =================
 * 0089 의 정의를 떠 와 갈래 하나를 더했다. 운영의 DX2401 Rev.00 은 이미
 * 지시가 나가 있어, 이것이 없으면 292 ~ 293 g 을 적을 길이 개정본뿐이다.
 */
create or replace function trg_dmr_part_frozen()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_dm uuid; n int; what text;
begin
  /* 어느 제품표준서에 딸린 줄인가. 표마다 닿는 길이 다르다 */
  if tg_table_name = 'dmr_operation' then
    v_dm := old.device_master_id;
    what := '공정';
  elsif tg_table_name = 'dmr_bom' then
    select o.device_master_id into v_dm
      from dmr_operation o where o.id = old.operation_id;
    what := '자재 구성표';
  else
    select o.device_master_id into v_dm
      from dmr_bom b join dmr_operation o on o.id = b.operation_id
     where b.id = old.dmr_bom_id;
    what := '장입 구간';
  end if;

  if v_dm is null then
    return new;
  end if;

  /*
   * 작업표준서가 이미 범위로 준 양의 상한을 뒤늦게 적는 것은 연다 (0128).
   * 비어 있던 상한을 한 번 채우는 것만이다 - 구간 · 소요량은 그대로여야 하고,
   * 한 번 적은 상한을 바꾸는 것은 여느 고쳐 쓰기처럼 막힌다. 지시서에 찍히는
   * 값은 소요량(qty)이므로 이미 나간 종이는 달라지지 않는다.
   */
  /* 한 함수가 세 표에 걸리므로 칸을 이름으로 짚지 않고 jsonb 로 견준다 -
     공정 줄에는 qty_max 칸이 없어 old.qty_max 가 오류를 낸다 */
  if tg_table_name = 'dmr_bom_tier'
     and to_jsonb(old) ->> 'qty_max' is null
     and to_jsonb(new) ->> 'qty_max' is not null
     and (to_jsonb(new) - 'qty_max') = (to_jsonb(old) - 'qty_max') then
    return new;
  end if;

  select count(*) into n from work_order where device_master_id = v_dm;
  if n = 0 then
    return new;                      -- 아직 아무 지시도 안 나갔다
  end if;

  raise exception
    '작업 지시가 나간 제품표준서의 %은(는) 고칠 수 없습니다 (지시 %건). '
    '같은 개정번호로 다른 종이가 나갑니다. 개정본을 새로 만드십시오', what, n;
end $$;
