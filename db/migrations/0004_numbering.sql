-- =============================================================================
-- 0004_numbering.sql  -  채번 규칙 · 채번 함수
-- 근거: CLAUDE.md §4.10
-- 범위: M0  ("M1의 자재 로트 등록이 채번에 의존하므로 M0에서 완성해 둔다")
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'numbering_target') then
    create type numbering_target as enum
      ('WORK_ORDER','BATCH','PRODUCT_LOT','MATERIAL_LOT','STERIL_BATCH','DEVIATION');
  end if;
  if not exists (select 1 from pg_type where typname = 'reset_cycle') then
    create type reset_cycle as enum ('NEVER','YEARLY','MONTHLY','DAILY');
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- [사양과의 차이 - item FK 보류]
--   §4.10은 item_id를 uuid references item(id)로 정의한다. item은 M1 표이므로
--   M0에서는 FK 없이 컬럼만 둔다. 규칙 선택 로직(품목별 우선)은 item 표가 없어도
--   그대로 동작하고 시험도 가능하다. M1에서 item을 만든 직후 아래 한 줄을 넣는다.
--
--     alter table numbering_rule
--       add constraint numbering_rule_item_id_fkey
--       foreign key (item_id) references item(id);
-- -----------------------------------------------------------------------------
create table if not exists numbering_rule (
  id             uuid primary key default gen_random_uuid(),
  target         numbering_target not null,
  item_id        uuid,                       -- 품목별 규칙. null이면 공통 규칙
  pattern        text not null,              -- 예 DX-{YY}{MM}-{SEQ:4}
  reset          reset_cycle not null default 'YEARLY',
  seq_width      int not null default 4 check (seq_width between 1 and 10),
  is_active      boolean not null default true,
  effective_from date not null,
  registered_by  uuid not null references app_user(id),
  registered_at  timestamptz not null default now()
);

-- 품목별 규칙이 공통 규칙보다 우선한다. 활성 규칙은 (target, item)당 하나.
create unique index if not exists numbering_rule_active_uniq
  on numbering_rule (target, coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_active;

-- 채번 카운터. 규칙과 주기 키 조합으로 순번을 관리한다.
create table if not exists numbering_counter (
  rule_id    uuid not null references numbering_rule(id),
  cycle_key  text not null,               -- NEVER / 2026 / 2026-08 / 2026-08-26
  last_seq   int  not null default 0,
  primary key (rule_id, cycle_key)
);


-- -----------------------------------------------------------------------------
-- 채번 함수 (§4.10)
--
-- [사양과의 차이 1 - 시각 기준을 Asia/Seoul로 고정]
--   사양은 now()를 그대로 쓴다. now()의 to_char 결과는 세션 타임존을 따르므로
--   DB가 UTC로 뜬 경우 KST 00:00~09:00 사이의 채번이 전날 날짜를 받는다.
--   cycle_key(YEARLY/MONTHLY/DAILY)와 인쇄되는 연월일 토큰이 동시에 하루씩
--   밀린다. 로트번호는 추적의 기준점이라 접속 세션 설정에 따라 달라지면 안 된다.
--   단일 사업장이므로 Asia/Seoul로 못박는다.
--
-- [사양과의 차이 2 - 품목 토큰 조회를 패턴 포함 여부로 가드]
--   사양은 p_item이 있으면 패턴에 품목 토큰이 없어도 item을 조회한다. 불필요한
--   조회이고, M0에는 item 표가 없어 "품목별 규칙 우선" 시험 자체가 불가능해진다.
--   패턴이 실제로 요구할 때만 조회한다.
--
-- [사양과의 차이 3 - search_path 고정]
--   security definer 함수의 search_path 미고정은 권한 상승 경로다.
--
-- [사양과의 차이 4 - 규칙 교체 시 순번 승계]
--   카운터 기본키가 (rule_id, cycle_key)라, §4.10대로 "규칙 변경은 신규 행
--   추가"를 따르면 새 rule_id에 카운터가 새로 생겨 순번이 1부터 다시 시작한다.
--   패턴이 같으면 이미 나간 번호가 그대로 재발행된다. §10이 금지하는 번호
--   재사용이다. 새 카운터 행을 만들 때 같은 (target, item_id, cycle_key)의
--   기존 최대값에서 이어받는다.
--
--   승계는 같은 cycle_key 안에서만 일어난다. reset 주기를 바꿔 규칙을 교체하면
--   (YEARLY -> MONTHLY 등) 주기 키가 달라 승계되지 않고 1부터 시작한다. 주기를
--   바꾸는 것은 번호 체계를 바꾸는 일이므로 패턴도 함께 바뀌는 것이 정상이지만,
--   패턴을 그대로 두고 주기만 바꾸면 충돌할 수 있다. 규칙 등록 화면에서 주기
--   변경 시 경고를 띄울 것.
--
-- [경합 차단 - 규칙 조회의 for share]
--   승계는 "구 규칙 카운터의 커밋된 최대값"을 읽는다. 구 규칙으로 아직 발행
--   중인 트랜잭션이 있으면 그 증가분이 안 보여 같은 번호가 두 번 나갈 수 있다.
--   규칙 행에 공유 잠금을 걸어 발행 중에는 규칙을 내리지 못하게 한다.
--   공유 잠금끼리는 충돌하지 않으므로 동시 발행 성능에는 영향이 없다.
--   규칙 교체(update numbering_rule)만 발행 종료를 기다린다.
--
-- [사양 그대로 둔 것 - SEQ 토큰의 자릿수]
--   자릿수는 패턴에 적힌 n이 아니라 seq_width 컬럼이 결정한다(사양 코드가 그렇다).
--   토큰표에는 "순번 n자리"로 적혀 있어 둘이 어긋날 수 있다. 규칙 등록 화면에서
--   n과 seq_width를 같이 보여주거나 한쪽만 입력받을 것.
-- -----------------------------------------------------------------------------
-- -----------------------------------------------------------------------------
-- 토큰 치환 (§4.10 치환 토큰표)
--
-- 발행(next_number)과 규칙 관리 화면의 형식 미리보기가 같은 코드를 쓰게 분리한다.
-- §10 "채번 번호를 응용 계층에서 조합" 금지. 미리보기를 화면에서 문자열
-- 조작으로 흉내내면 두 곳이 어긋나는 순간 등록된 패턴과 실제 번호가 달라진다.
--
-- 순수 함수라 immutable이다. 시각은 인자로 받는다.
-- 품목 코드가 없으면 품목 토큰을 그대로 남긴다. 미리보기에서 "아직 안 풀린
-- 자리"가 눈에 보여야 한다. 발행 경로의 엄격한 검사는 next_number가 한다.
-- -----------------------------------------------------------------------------
create or replace function render_number(
  p_pattern   text,
  p_seq_width int,
  p_seq       int,
  p_at        timestamp,
  p_item_code text default null
) returns text language sql immutable as $fn$
  select regexp_replace(
           replace(replace(replace(replace(replace(replace(
             p_pattern,
             '{YYYY}',  to_char(p_at, 'YYYY')),
             '{YY}',    to_char(p_at, 'YY')),
             '{MM}',    to_char(p_at, 'MM')),
             '{DD}',    to_char(p_at, 'DD')),
             '{ITEM}',  coalesce(p_item_code, '{ITEM}')),
             '{MODEL}', coalesce(right(p_item_code, 8), '{MODEL}')),
           '\{SEQ:(\d+)\}', lpad(p_seq::text, p_seq_width, '0'), 'g')
$fn$;

-- 규칙 관리 화면 전용. 카운터를 건드리지 않는다.
-- 실제 다음 순번은 보여주지 않는다. §4.10 "관리 화면에서도 노출하지 않는다".
-- 어디까지나 형식 확인용이라 표본 순번을 받는다.
create or replace function preview_number(
  p_pattern   text,
  p_seq_width int,
  p_seq       int  default 1,
  p_item_code text default null
) returns text language sql stable as $fn$
  select render_number(p_pattern, p_seq_width, p_seq,
                       timezone('Asia/Seoul', now()), p_item_code)
$fn$;


create or replace function next_number(p_target numbering_target, p_item uuid default null)
returns text language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $fn$
declare
  r      record;
  v_now  timestamp;
  v_code text;
  ck     text;
  v_base int;
  n      int;
begin
  -- 품목별 규칙 우선, 없으면 공통 규칙
  select * into r from numbering_rule
   where target = p_target and is_active
     and (item_id = p_item or item_id is null)
   order by (item_id is null)          -- false(품목별)가 먼저
   limit 1
     for share;                        -- 발행 중 규칙 교체를 막는다 (아래 주석)
  if not found then
    raise exception '채번 규칙이 정의되지 않았습니다 (%)', p_target;
  end if;

  v_now := timezone('Asia/Seoul', now());

  ck := case r.reset
          when 'NEVER'   then 'NEVER'
          when 'YEARLY'  then to_char(v_now, 'YYYY')
          when 'MONTHLY' then to_char(v_now, 'YYYY-MM')
          when 'DAILY'   then to_char(v_now, 'YYYY-MM-DD')
        end;

  -- 순번 승계. 규칙을 교체하면 rule_id가 바뀌어 카운터가 새로 생긴다. 그대로
  -- 두면 같은 패턴에서 이미 나간 번호가 다시 나온다 (§10 번호 재사용 금지).
  -- 같은 (target, item_id, cycle_key)의 구 규칙 카운터에서 이어받는다.
  -- item_id는 null(공통 규칙)일 수 있으므로 = 가 아니라 is not distinct from.
  select coalesce(max(c.last_seq), 0) into v_base
    from numbering_counter c
    join numbering_rule  nr on nr.id = c.rule_id
   where nr.target = r.target
     and nr.item_id is not distinct from r.item_id
     and c.cycle_key = ck;

  -- 원자적 증가. 동시 채번에도 중복이 발생하지 않는다.
  -- 조회 후 증가시키는 방식으로 바꾸지 말 것.
  insert into numbering_counter (rule_id, cycle_key, last_seq)
  values (r.id, ck, v_base + 1)
  on conflict (rule_id, cycle_key)
    do update set last_seq = numbering_counter.last_seq + 1
  returning last_seq into n;

  -- 품목 토큰이 있는 패턴만 item을 조회한다. 미리보기와 달리 발행 경로는
  -- 풀리지 않은 토큰을 그대로 내보내면 안 되므로 여기서 막는다.
  if r.pattern like '%{ITEM}%' or r.pattern like '%{MODEL}%' then
    if to_regclass('public.item') is null then
      raise exception '품목 토큰은 item 표(M1) 도입 이후에 사용할 수 있습니다';
    end if;
    if p_item is null then
      raise exception '채번 규칙에 품목 토큰이 있으나 품목이 지정되지 않았습니다 (%)', r.pattern;
    end if;
    execute 'select code from item where id = $1' into v_code using p_item;
    if v_code is null then
      raise exception '품목을 찾을 수 없습니다 (%)', p_item;
    end if;
  end if;

  return render_number(r.pattern, r.seq_width, n, v_now, v_code);
end $fn$;


-- -----------------------------------------------------------------------------
-- 규칙 불변성 (§4.10 운영 규칙)
--   "규칙 변경은 신규 행 추가로 한다. 기존 행을 수정하지 않는다. 구 규칙은
--    is_active=false로 내린다. 과거 번호가 어느 규칙으로 만들어졌는지 추적할
--    수 있어야 한다."
--   패턴을 제자리에서 고칠 수 있으면 이미 발행된 번호를 설명할 수 없게 된다.
--   is_active를 내리는 것만 허용한다.
-- -----------------------------------------------------------------------------
create or replace function trg_rule_immutable()
returns trigger language plpgsql as $fn$
begin
  if new.target         is distinct from old.target
  or new.item_id        is distinct from old.item_id
  or new.pattern        is distinct from old.pattern
  or new.reset          is distinct from old.reset
  or new.seq_width      is distinct from old.seq_width
  or new.effective_from is distinct from old.effective_from
  or new.registered_by  is distinct from old.registered_by
  or new.registered_at  is distinct from old.registered_at then
    raise exception '채번 규칙은 수정할 수 없습니다. is_active를 내리고 새 규칙을 등록하십시오';
  end if;
  if old.is_active = false and new.is_active = true then
    raise exception '내린 채번 규칙은 다시 활성화할 수 없습니다. 새 규칙을 등록하십시오';
  end if;
  return new;
end $fn$;

drop trigger if exists numbering_rule_immutable on numbering_rule;
create trigger numbering_rule_immutable before update
  on numbering_rule for each row execute function trg_rule_immutable();


-- -----------------------------------------------------------------------------
-- 카운터 역행 금지 (§4.10 운영 규칙)
--   "numbering_counter를 직접 수정하지 않는다. 순번을 되돌리면 중복이 발생한다."
--   앞으로만 갈 수 있게 한다. 초기 이관용 시작 순번은 INSERT로 넣으므로 이
--   트리거에 걸리지 않는다.
-- -----------------------------------------------------------------------------
create or replace function trg_counter_forward_only()
returns trigger language plpgsql as $fn$
begin
  if new.rule_id   is distinct from old.rule_id
  or new.cycle_key is distinct from old.cycle_key then
    raise exception '채번 카운터의 규칙·주기 키는 변경할 수 없습니다';
  end if;
  if new.last_seq <= old.last_seq then
    raise exception '채번 순번은 되돌릴 수 없습니다 (주기 %: % 에서 %)',
      old.cycle_key, old.last_seq, new.last_seq;
  end if;
  return new;
end $fn$;

drop trigger if exists numbering_counter_forward_only on numbering_counter;
create trigger numbering_counter_forward_only before update
  on numbering_counter for each row execute function trg_counter_forward_only();


-- -----------------------------------------------------------------------------
-- 감사추적 · 삭제 차단 (§5 S03)
--
-- numbering_rule은 감사 대상이다. numbering_counter는 제외한다. 채번 1건마다
-- 감사행이 1건씩 붙어 audit_log가 채번 로그로 뒤덮이는데, 발행된 번호는 그
-- 번호를 쓴 기록(work_order, material_lot ...)에 이미 남으므로 추적에 보태는
-- 것이 없다. 카운터의 무결성은 역행 금지 트리거와 권한 회수로 지킨다.
--
-- 두 표 모두 삭제는 막는다. 규칙을 지우면 과거 번호의 근거가 사라지고,
-- 카운터를 지우면 순번이 1부터 다시 시작해 번호가 재사용된다 (§10 금지).
-- -----------------------------------------------------------------------------
drop trigger if exists numbering_rule_audit on numbering_rule;
create trigger numbering_rule_audit after insert or update
  on numbering_rule for each row execute function trg_audit();

drop trigger if exists numbering_rule_no_delete on numbering_rule;
create trigger numbering_rule_no_delete before delete on numbering_rule
  for each row execute function trg_block_delete();

drop trigger if exists numbering_rule_no_truncate on numbering_rule;
create trigger numbering_rule_no_truncate before truncate on numbering_rule
  for each statement execute function trg_block_delete();

drop trigger if exists numbering_counter_no_delete on numbering_counter;
create trigger numbering_counter_no_delete before delete on numbering_counter
  for each row execute function trg_block_delete();

drop trigger if exists numbering_counter_no_truncate on numbering_counter;
create trigger numbering_counter_no_truncate before truncate on numbering_counter
  for each statement execute function trg_block_delete();
