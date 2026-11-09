/* ---------------------------------------------------------------------------
   원액을 자재 로트 한 줄로 세우고 S02 를 두 갈래로 나눈다
   (사용자 결정 2026-10-23 · 0117 에서 이어짐)
   근거 CLAUDE.md §1 · §2 · §2.1 · §4.4 · §10

   ── 왜 바꾸는가 ──────────────────────────────────────────────────────
   20X PBS 원액은 사내에서 만들어 보관하다 여러 배치에 이어 쓴다. 로트가
   되어야 계보가 원액에서 끊기지 않고, S01 · S05 가 원액 투입에 닿고,
   유효기간이 시스템에 들어온다.

   원액을 별도 표 둘로 세우지 않는다. 자재 로트의 S01 · S04 · S05 · 계보 ·
   인쇄 · 원가 · 검토가 두 벌이 되고, 같은 사실의 경로가 둘이면 반드시
   어긋난다 (§4.6). 원액도 자재 로트 한 줄이다.

   ── 그러면 S02 는 ───────────────────────────────────────────────────
   원액에는 성적서가 없다. 성적서 칸에 제조기록서 양식번호나 관리번호를
   채우면 성적서가 아닌 것을 성적서라 적는 셈이다 (§1). 그래서 칸을
   비우고, 대신 **원료 로트 없이는 원액 로트가 서지 않게** 한다. 원액의
   근거는 원료 로트들의 성적서로 이어진다.

     입고 로트   성적서 번호 · 성적서 일자 · 공급자 · 공급자 로트가 모두
                 있다. 지금의 S02 그대로다
     원액 로트   넷이 모두 비고 제조일이 있다. 원료 로트는 원료 줄이
                 가리킨다 (0119)

   두 갈래는 섞을 수 없다. 원액에 성적서 번호를 적을 수도, 입고 로트에서
   공급자를 비울 수도 없다.

   판정하지 않는다 (§1). 무엇이 옳은 성적서인지, 원액이 쓸 만한지 묻지
   않는다. 묻는 것은 어느 갈래의 칸이 채워져 있느냐와 그 품목이 원액이냐
   뿐이다.

   ── 어디서 막는가 ───────────────────────────────────────────────────
   표 안에서 풀리는 것은 CHECK 가 막는다 (material_lot_source). DB 계층에서
   막히고 변이 시험이 이 검사를 떼어 볼 수 있다.

   다른 표를 봐야 하는 것은 트리거가 막는다. 품목이 원액인지는 item 을 봐야
   알 수 있다. 트리거는 복구 때 물러나므로(session_replication_role =
   replica) 옛 백업을 막지 않는다.

   ── 옛 자료와 옛 백업은 ─────────────────────────────────────────────
   지금까지 네 칸이 NOT NULL 이었으므로 기존 행과 옛 백업은 모두 입고
   갈래를 만족한다. NOT VALID 를 쓰지 않는다 - 검증하지 않은 제약은 검증이
   아니다 (§10).

   made_on 은 칸만 더하고 기본값을 주지 않는다. not null default 로 더한
   칸은 그 칸을 모르던 옛 백업을 통째로 들이지 못한다 (§10 · 0096).

   이 파일이 하지 않는 것: 원료 줄을 요구하는 커밋 시 검사와 원료 줄 고쳐
   쓰기 차단은 원료 줄이 생기는 0119 에서 건다.
--------------------------------------------------------------------------- */


/* === 1. 제조일 칸 · 입고 칸의 NOT NULL 을 푼다 ========================= */

alter table material_lot add column if not exists made_on date;

comment on column material_lot.made_on is
  '비어 있으면 입고 로트, 값이 있으면 사내에서 만든 원액 로트의 제조일. '
  '번호의 날짜이고 유효기간의 출발점이다 (0118)';

/*
 * 네 칸을 비울 수 있게 한다. 풀기만 하고 검사를 안 걸면 입고 로트의 S02 가
 * 사라지므로 아래 CHECK 가 바로 이어서 대신 묻는다. 같은 파일 = 같은
 * 트랜잭션이라 그 사이에 빈 입고 로트가 들어올 틈이 없다.
 */
alter table material_lot alter column coa_no          drop not null;
alter table material_lot alter column coa_date        drop not null;
alter table material_lot alter column supplier_id     drop not null;
alter table material_lot alter column supplier_lot_no drop not null;


/* === 2. S02 - 표 안의 검사 하나 ======================================== */
/*
 * 입고 갈래는 지금의 S02 그대로다. material_lot_coa_no_not_blank (빈 문자열
 * 금지)도 그대로 두므로 공백만 적은 성적서 번호는 여전히 막힌다.
 *
 * 제조일이 비었는데 성적서 · 공급자 중 하나라도 비면 어느 갈래도 아니다.
 * 옛 S02 가 NOT NULL 로 막던 것을 이제 이 검사가 막는다. 오류 코드만 23502
 * 에서 23514 로 바뀐다.
 */
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'material_lot_source'
                    and conrelid = 'material_lot'::regclass) then
    alter table material_lot add constraint material_lot_source check (
      (made_on is null
         and coa_no is not null and coa_date is not null
         and supplier_id is not null and supplier_lot_no is not null)
      or
      (made_on is not null
         and coa_no is null and coa_date is null
         and supplier_id is null and supplier_lot_no is null)
    );
  end if;
end $$;

comment on constraint material_lot_source on material_lot is
  'S02 두 갈래. 입고 로트는 성적서 번호 · 일자 · 공급자 · 공급자 로트가 모두 있고, '
  '원액 로트는 넷이 모두 비고 제조일이 있다. 섞을 수 없다 (0118)';


/* === 3. T2 - 제조일은 원액 품목의 로트에만 있다 ======================== */
/*
 * 표 안의 검사는 제조일이 있고 성적서 · 공급자가 모두 빈 줄을 원액 갈래로
 * 보고 통과시킨다. 그 품목이 정말 원액인지는 item 을 봐야 하므로 트리거가
 * 묻는다. 양쪽 모두 막는다.
 *
 *   원액 아닌 품목에 제조일     시약 로트를 성적서 없이 세우는 길이 된다
 *   원액 품목에 제조일 없음     원액이 입고 로트로 서서 원료 연결을 건너뛴다
 *
 * 없는 품목은 여기서 판단하지 않는다 - 외래키가 거부한다. 트리거가 먼저 돌아
 * 외래키 오류를 가리지 않게 한다.
 */
create or replace function trg_ml_made_item()
returns trigger language plpgsql as $fn$
declare v_type item_type;
begin
  select type into v_type from item where id = new.item_id;
  if v_type is null then
    return new;
  end if;

  if v_type = 'SOLUTION' and new.made_on is null then
    raise exception '원액 품목의 로트에는 제조일이 있어야 합니다 (로트 %)', new.lot_no;
  end if;
  if v_type <> 'SOLUTION' and new.made_on is not null then
    raise exception '원액 품목의 로트에만 제조일이 있습니다 (로트 %)', new.lot_no;
  end if;
  return new;
end $fn$;

drop trigger if exists material_lot_made_item on material_lot;
create trigger material_lot_made_item before insert or update
  on material_lot for each row execute function trg_ml_made_item();

comment on trigger material_lot_made_item on material_lot is
  '품목이 원액인 것과 제조일이 있는 것은 같이 선다. 어느 한쪽만 서면 거부한다 (0118)';


/* === 4. T4 - 로트가 있는 품목은 유형을 바꾸지 못한다 =================== */
/*
 * 지금은 품목 유형을 언제든 바꿀 수 있다. 시약 품목을 원액으로 돌리면 성적서
 * 없이 로트를 세울 길이 생기고, 원액을 시약으로 돌리면 이미 선 원액 로트가
 * T2 의 짝을 잃는다. 원료 줄을 요구하는 검사가 흔적은 남기지만 문을 열어 둘
 * 이유가 없다.
 *
 * 이미 적힌 사실을 없던 일로 만드는 길이므로 §2.1 의 자리다. 정상 작업은
 * 막지 않는다 - 로트가 아직 없는 품목은 유형을 바로잡을 수 있고, 로트가
 * 있어도 이름 · 단위 같은 다른 칸은 그대로 고칠 수 있다.
 */
create or replace function trg_item_type_frozen()
returns trigger language plpgsql as $fn$
begin
  if new.type is distinct from old.type
     and exists (select 1 from material_lot where item_id = old.id) then
    raise exception '로트가 있는 품목은 유형을 바꿀 수 없습니다 (%)', old.code;
  end if;
  return new;
end $fn$;

drop trigger if exists item_type_frozen on item;
create trigger item_type_frozen before update
  on item for each row execute function trg_item_type_frozen();

comment on trigger item_type_frozen on item is
  '로트가 하나라도 있으면 품목 유형을 바꾸지 못한다. 유형이 로트의 갈래를 정한다 (0118)';
