/* ---------------------------------------------------------------------------
   개체 순번

   지금까지 추적이 제조번호까지였다. 한 로트 40개가 네 병원에 나뉘어 나가면
   "이 로트가 그 네 곳에 갔다"까지만 알았고, 어느 개체가 어디로 갔는지는
   자료에 없었다. 회수가 필요하면 로트 전체가 대상이 된다 (사용자 지적).

   ── 개체마다 표를 만들지 않는다 ───────────────────────────────────────────
   개체마다 한 행씩 두면 배치당 200 행이 늘고, 멸균 박스 내용물도 출고도 시료도
   전부 개체 단위로 골라야 한다. 현장에서 누를 것이 그만큼 늘고 종이 기록도
   같이 늘어난다. 얻는 것에 비해 치르는 값이 크다.

   대신 순번으로 다룬다. 한 제조번호의 개체는 1 부터 생산 수량까지 번호를
   갖는다. 라벨에는 개체마다 다른 번호가 찍히고 (P2608-0004-001 …), 시스템은
   "어디부터 어디까지가 어디로 갔다"를 적는다. 개체 식별은 되면서 기록량은
   로트 단위에 가깝게 남는다.

   ── 번호를 나누는 규칙 ────────────────────────────────────────────────────
   시료는 앞 번호부터 뽑는다. 1 부터 시료 수량까지가 완제품검사로 빠지고,
   그 다음 번호부터가 출고 가능분이다. 규칙을 하나로 정해 두어야 종이와 화면이
   같은 번호를 가리킨다. 아무 번호나 뽑게 두면 어느 것이 시료였는지 나중에
   맞출 수 없다.

     생산 40 · 시료 2  →  001~002 시료 · 003~040 출고 가능

   ── 같은 번호를 두 번 내보내지 않는다 ─────────────────────────────────────
   출고 범위가 겹치면 한 개체가 두 곳으로 간 것이 된다. 물리적으로 있을 수 없는
   일이라 DB 에서 막는다. 이건 S01~S05 에 더하는 판정이 아니라 산술 모순이다.
--------------------------------------------------------------------------- */

alter table shipment
  add column if not exists unit_from int,
  add column if not exists unit_to   int;

comment on column shipment.unit_from is '나간 개체 순번의 시작. 제조번호 안에서 1부터 센다';
comment on column shipment.unit_to   is '나간 개체 순번의 끝';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shipment_unit_range') then
    alter table shipment add constraint shipment_unit_range check (
      (unit_from is null) = (unit_to is null)
      and (unit_from is null or (unit_from >= 1 and unit_to >= unit_from))
    );
  end if;
end $$;

/* ---------------------------------------------------------------------------
   출고 가능한 첫 번호

   시료 다음 번호부터 세되, 이미 나간 범위는 건너뛴다. 화면이 이 값을 미리
   채워 주므로 사람이 번호를 세지 않는다.
--------------------------------------------------------------------------- */
create or replace function next_unit_seq(p_lot uuid)
returns int language sql stable as $$
  select greatest(
    coalesce((select max(unit_to) from shipment where product_lot_id = p_lot), 0),
    coalesce((select qty_sample from product_lot where id = p_lot), 0)
  ) + 1
$$;

grant execute on function next_unit_seq(uuid) to app_role;

/* ---------------------------------------------------------------------------
   범위가 겹치거나 로트를 벗어나지 않는지 본다
--------------------------------------------------------------------------- */
create or replace function trg_shipment_unit_range()
returns trigger language plpgsql as $fn$
declare v_made int; v_sample int; v_lot text; v_hit text;
begin
  if new.unit_from is null then
    return new;                      -- 순번을 안 적은 지난 기록은 그대로 둔다
  end if;

  select qty_produced, qty_sample, lot_no into v_made, v_sample, v_lot
    from product_lot where id = new.product_lot_id;

  if new.unit_to > v_made then
    raise exception '제조번호 %는 %개까지입니다 (요청 %~%)',
      v_lot, v_made, new.unit_from, new.unit_to;
  end if;

  if new.unit_from <= v_sample then
    raise exception '%~%번은 완제품검사 시료입니다 (앞 %개). %번부터 출고할 수 있습니다',
      1, v_sample, v_sample, v_sample + 1;
  end if;

  if (new.unit_to - new.unit_from + 1) <> new.qty then
    raise exception '순번 범위(%~% = %개)와 출고 수량(%)이 다릅니다',
      new.unit_from, new.unit_to, new.unit_to - new.unit_from + 1, new.qty;
  end if;

  select string_agg(format('%s~%s', s.unit_from, s.unit_to), ', ') into v_hit
    from shipment s
   where s.product_lot_id = new.product_lot_id
     and s.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
     and s.unit_from is not null
     and s.unit_from <= new.unit_to
     and s.unit_to   >= new.unit_from;

  if v_hit is not null then
    raise exception '이미 나간 번호와 겹칩니다 (%). 한 개체가 두 곳으로 갈 수 없습니다', v_hit;
  end if;

  return new;
end $fn$;

drop trigger if exists shipment_unit_range on shipment;
create trigger shipment_unit_range before insert or update
  on shipment for each row execute function trg_shipment_unit_range();
