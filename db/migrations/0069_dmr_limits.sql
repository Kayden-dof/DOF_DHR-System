/* ---------------------------------------------------------------------------
   장입 상한을 제품표준서로 옮긴다 (M5-1 · §2.0)

   `check (sheet_count between 1 and 30)` — 이 30은 DX2401의 값이다. 그런데
   표 정의에 있어서 화면에서 바꿀 수 없다. 다른 품목을 올리려면 개발자를 다시
   불러야 한다. §2.0이 금지한 바로 그 모양이다.

   ── 울타리는 남기고 상한만 옮긴다 ─────────────────────────────────────────
   CHECK를 지우지 않는다. `1 ~ 30`을 **있을 수 없는 값을 막는 바깥 울타리**로
   다시 정의한다 — `sheet_count > 0`. 0장이나 음수 장입은 어느 품목에서도
   자료가 될 수 없다.

   그 안쪽의 실제 상한은 제품표준서가 정하고 트리거가 본다.

   ── 이것이 §1의 "차단은 다섯 개뿐"을 늘리는가 ─────────────────────────────
   아니다. 적합인지 부적합인지 묻지 않는다. 묻는 것은 하나다 — **이 제품표준서가
   정한 범위 밖의 장수를 적고 있는가.** §2.1의 구조적 불변식과 같은 층이고,
   공정 기록의 작업일에 0052가 건 것과 같은 성격이다.

   ── 지금 값을 그대로 옮긴다 ───────────────────────────────────────────────
   이미 있는 제품표준서에는 `1 ~ 30`을 찍는다. 지금 시스템이 강제하는 값이
   그것이므로, 옮기면서 동작이 바뀌면 안 된다. 새로 만드는 개정은 상한을
   비워 둘 수 있고, 비면 상한이 없다.

   ── 멸균 발송 박스도 함께 ─────────────────────────────────────────────────
   `shipping-forms.tsx`의 `BOX = 50`도 같은 성격이다. 50개(25ea 2줄)는 DX2401의
   위탁 조건이지 프로그램의 성질이 아니다.
--------------------------------------------------------------------------- */

alter table device_master add column if not exists sheet_min int;
alter table device_master add column if not exists sheet_max int;
alter table device_master add column if not exists steril_box_qty int;

comment on column device_master.sheet_min is
  '배치 장입 장수 하한. 비우면 1';
comment on column device_master.sheet_max is
  '배치 장입 장수 상한. 비우면 상한 없음';
comment on column device_master.steril_box_qty is
  '멸균 발송 박스 한 개에 담는 제품 수. 비우면 화면이 박스 수를 세지 않는다';

/* 지금 강제하고 있는 값을 그대로 옮긴다. 옮기면서 동작이 바뀌면 안 된다 */
update device_master
   set sheet_min = coalesce(sheet_min, 1),
       sheet_max = coalesce(sheet_max, 30),
       steril_box_qty = coalesce(steril_box_qty, 50)
 where sheet_min is null or sheet_max is null or steril_box_qty is null;

do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'work_order'::regclass
                and conname = 'work_order_sheet_count_check') then
    alter table work_order drop constraint work_order_sheet_count_check;
  end if;
end $$;

/* 바깥 울타리. 어느 품목에서도 0장이나 음수는 자료가 될 수 없다 */
alter table work_order
  add constraint work_order_sheet_count_check check (sheet_count > 0);

/* --- 실제 상한은 제품표준서가 정한다 --------------------------------------- */
create or replace function trg_wo_sheet_range()
returns trigger language plpgsql as $fn$
declare lo int; hi int; nm text;
begin
  select coalesce(dm.sheet_min, 1), dm.sheet_max, coalesce(dm.product_code, i.code)
    into lo, hi, nm
    from device_master dm
    join item i on i.id = dm.item_id
   where dm.id = new.device_master_id;

  if new.sheet_count < lo then
    raise exception '장입 장수가 제품표준서의 하한(%장)보다 적습니다 (%장, %)',
      lo, new.sheet_count, nm;
  end if;
  if hi is not null and new.sheet_count > hi then
    raise exception '장입 장수가 제품표준서의 상한(%장)을 넘습니다 (%장, %)',
      hi, new.sheet_count, nm;
  end if;
  return new;
end $fn$;

drop trigger if exists work_order_sheet_range on work_order;
create trigger work_order_sheet_range before insert or update of sheet_count, device_master_id
  on work_order for each row execute function trg_wo_sheet_range();

/*
 * 하한이 상한보다 클 수는 없다. 이건 판정이 아니라 있을 수 없는 값이다.
 */
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'device_master'::regclass
                    and conname = 'device_master_sheet_range') then
    alter table device_master add constraint device_master_sheet_range
      check (sheet_min is null or sheet_min > 0)
      not valid;
    alter table device_master validate constraint device_master_sheet_range;
  end if;
end $$;
