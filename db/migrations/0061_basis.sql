/* ---------------------------------------------------------------------------
   기준값에 근거를 붙인다 (3차 검수 결함 5 · 7)

   두 가지가 통제 없이 쓰이고 있었다.

     사용기간      §4.2 는 연장을 shelf_life_history 에 담고 안정성 시험
                   보고서 번호를 필수로 걸어 두었다. 그런데 shelf_life_at() 이
                   item.shelf_life_months 로 떨어지고, 그 컬럼은 품목 화면의
                   자유 입력 숫자칸이다. 근거 없이 12 를 24 로 바꾸면 이후
                   만드는 모든 제품 로트의 유효기한이 1년 늘고, 그 값은 로트에
                   박혀 잠긴다 (0052).

     제품표준서    발행이 보는 것은 verified_at 하나뿐이고 그것도 응용 계층에
                   있다. status='DRAFT' 이고 effective_from 이 2099년인
                   표준서로도 작업 지시가 발행되었다.

   그리고 감사추적에 "왜" 를 담을 자리가 없었다. 누가 · 언제 · 무엇을은
   남는데, 기준정보를 왜 바꿨는지는 어디에도 없다.
--------------------------------------------------------------------------- */


/* === 1. 완제품 사용기간은 이력으로만 바꾼다 ============================= */
/*
 * 완제품의 shelf_life_months 를 처음 정하는 것은 열어 둔다. 형명을 만들 때
 * 값이 있어야 하고, 그때는 아직 로트가 없어 소급될 것도 없다.
 *
 * 바꾸는 것을 막는다. 바꿔야 하면 shelf_life_history 에 안정성 보고서 번호와
 * 함께 등록한다 - §4.2 가 그러라고 만든 표다. 그 경로에는 승인자와 보고서
 * 번호가 NOT NULL 로 걸려 있다.
 *
 * 원재료 · 시약 · 포장재는 그대로 둔다. 그쪽 사용기간은 입고 로트의
 * expiry_date 로 관리되고 제품 유효기한을 만들지 않는다.
 */
create or replace function trg_item_shelf_life()
returns trigger language plpgsql as $fn$
begin
  if new.type = 'FIN'
     and new.shelf_life_months is distinct from old.shelf_life_months then
    raise exception
      '완제품 사용기간은 화면에서 바꿀 수 없습니다. 안정성 시험 보고서 번호와 함께 '
      '사용기간 이력으로 등록하십시오 (%개월 → %개월)',
      old.shelf_life_months, new.shelf_life_months;
  end if;
  return new;
end $fn$;

drop trigger if exists item_shelf_life on item;
create trigger item_shelf_life before update on item
  for each row execute function trg_item_shelf_life();


/* === 2. 발효되지 않은 제품표준서로는 발행하지 않는다 ==================== */
/*
 * 응용에 있던 검사를 DB 로 옮기고 두 가지를 더 본다. 응용 계층에서만 막은 건
 * 검증이 아니다 (§1).
 *
 *   status         DRAFT 인 표준서는 아직 쓰라고 낸 것이 아니다
 *   effective_from 발효일 전에는 그 개정본이 존재하지 않는 것과 같다
 *   verified_at    서면 대조 확인이 끝나야 한다 (전에도 있던 검사)
 *
 * 이것이 여섯 번째 차단인가: 아니다. 판정하지 않는다. 물어보는 것은 "이
 * 표준서가 지금 쓰라고 낸 것인가" 뿐이고, 그건 사람이 이미 서면으로 정해
 * status 와 effective_from 에 적어 둔 사실이다. 시스템은 그 사실을 읽는다.
 */
create or replace function trg_wo_dmr_effective()
returns trigger language plpgsql as $fn$
declare dm record; v_today date;
begin
  v_today := (timezone('Asia/Seoul', now()))::date;

  select revision, status, effective_from, verified_at into dm
    from device_master where id = new.device_master_id;

  if dm.verified_at is null then
    raise exception '서면 대조 확인이 끝나지 않은 제품표준서로는 발행할 수 없습니다 (%)',
      dm.revision;
  end if;
  if dm.status <> 'ACTIVE' then
    raise exception '제품표준서 %(이)가 아직 %상태입니다. 발효된 개정본으로 발행하십시오',
      dm.revision, dm.status;
  end if;
  if dm.effective_from is null or dm.effective_from > v_today then
    raise exception '제품표준서 %(의) 발효일이 %입니다. 그날부터 발행할 수 있습니다',
      dm.revision, coalesce(dm.effective_from::text, '미정');
  end if;

  return new;
end $fn$;

drop trigger if exists work_order_dmr_effective on work_order;
create trigger work_order_dmr_effective before insert on work_order
  for each row execute function trg_wo_dmr_effective();


/* === 3. 유효기한의 근거를 종이에 적을 수 있게 한다 ====================== */
/*
 * 제품 로트에는 shelf_life_ref 가 있으나 이력이 없으면 비어 있다. 비어 있는
 * 것이 곧 "품목 기본값을 썼다" 는 뜻인데, 종이만 보는 사람은 그걸 모른다.
 *
 * 근거 문구를 만들어 준다. 인쇄물이 이 함수를 읽는다.
 */
create or replace function shelf_life_basis(p_ref uuid, p_item uuid)
returns text language sql stable as $fn$
  select coalesce(
    (select format('%s개월 · 안정성 보고서 %s (%s)',
              h.months, h.study_report_no, h.effective_from)
       from shelf_life_history h where h.id = p_ref),
    (select format('%s개월 · 품목 기본값 (안정성 보고서 미등록)', i.shelf_life_months)
       from item i where i.id = p_item),
    '미정')
$fn$;

comment on function shelf_life_basis(uuid, uuid) is
  '유효기한이 무엇에 근거했는지 한 줄로. 인쇄물이 읽는다';


/* === 4. 감사추적에 왜를 담는다 (결함 7) ================================= */
/*
 * audit_log 는 누가 · 언제 · 무엇을만 남기고 왜는 남기지 않았다. 사유를
 * 요구하는 곳은 개별 컬럼으로 흩어져 있고 (취소 사유 · 정정 사유 · 반납 사유)
 * 기준정보 변경에는 하나도 없다.
 *
 * withActor 가 이미 app.user_id 를 세션에 세우고 있으므로 같은 자리에 사유를
 * 싣는다. 응용이 사유를 주면 그대로 남고, 주지 않으면 비어 있다.
 *
 * ── 비었다고 막지 않는다 ──────────────────────────────────────────────────
 * 막으면 여섯 번째 차단이 되고 §2 를 고쳐야 한다. 지금은 담을 자리를 만들고
 * 사유가 꼭 있어야 하는 곳(기준정보 변경)에서 응용이 채우게 한다.
 * 필수로 걸 것인지는 사양 개정에서 정한다.
 */
alter table audit_log add column if not exists reason text;

comment on column audit_log.reason is
  '왜 바꿨는가. 응용이 app.change_reason 으로 전달한다. 비어 있을 수 있다';

create or replace function trg_audit()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  key_col text := coalesce(tg_argv[0], 'id');
  j       jsonb;
  rid     uuid;
  secrets text[] := audit_secret_columns(tg_table_name);
  v_old   jsonb;
  v_new   jsonb;
  v_why   text;
  col     text;
begin
  j := coalesce(to_jsonb(new), to_jsonb(old));

  if not (j ? key_col) then
    raise exception '감사추적: %.% 컬럼이 없습니다 (트리거 인자를 확인하십시오)',
      tg_table_name, key_col;
  end if;

  rid := (j ->> key_col)::uuid;
  if rid is null then
    raise exception '감사추적: %.%가 null입니다', tg_table_name, key_col;
  end if;

  v_old := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;

  /* 비밀 컬럼은 값을 빼고 표시만 남긴다 (0060) */
  foreach col in array secrets loop
    if v_old ? col then v_old := jsonb_set(v_old, array[col], '"(감춤)"'::jsonb); end if;
    if v_new ? col then v_new := jsonb_set(v_new, array[col], '"(감춤)"'::jsonb); end if;
  end loop;

  /* 등록에는 사유를 묻지 않는다. 만든 것 자체가 사유다 */
  v_why := case when tg_op = 'UPDATE'
                then nullif(btrim(coalesce(current_setting('app.change_reason', true), '')), '')
           end;

  insert into audit_log (table_name, record_id, action, actor_id, old_value, new_value, reason)
  values (tg_table_name, rid, tg_op, current_user_id(), v_old, v_new, v_why);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $fn$;
