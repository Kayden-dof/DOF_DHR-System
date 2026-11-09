/* ===========================================================================
   0125 · 공간과 설비 배치 (사용자 요청 2026-11-09)

   "공간을 그리고 그 안에 장비를 배치하는 형태의 기능"

   ── 무엇을 담는가 ─────────────────────────────────────────────────────────
     room        방 하나. 번호(101) · 이름 · 청정 등급 · 면적 · 모양
     equipment   어느 방에 있는가(room_id), 그 방 안 어디인가(pos_x_mm · pos_y_mm).
                 벽에 걸친 설비(패스박스)는 건너편 방(to_room_id)을 함께 적는다

   ── 모양 ──────────────────────────────────────────────────────────────────
   사각형 여럿이다 (rects: [{"x":..,"y":..,"w":..,"h":..}], 단위 mm). ㄱ자 방은
   사각형 둘. 좌표는 도면 왼쪽 위를 0 으로 둔 mm 다. 다각형을 받지 않는 까닭은
   그리는 손이 격자 위에서 끄는 것만으로 끝나야 하기 때문이다.

   면적은 서면 도면에 적힌 값을 옮겨 적는다. 사각형에서 셈하지 않는다 - 도면의
   면적은 기둥 · 덕트 · 벽 안쪽을 뺀 실측이라 바깥 치수의 곱과 다르다.

   ── 자리는 방 밖에도 둘 수 있다 ───────────────────────────────────────────
   «포장실 앞» 의 방서기처럼 방 밖(복도 · 출입구)에 놓인 설비가 있다. 그래서
   자리(pos)는 방 없이도 받는다. 방을 지우면 그 방의 설비는 방에서만 빠지고
   자리는 남는다 (on delete set null).

   ── 지울 수 있다 (0124 뒤) ─────────────────────────────────────────────────
   기준정보라 지울 수 있다. 지운 행은 감사추적에 이전 값과 함께 남는다.
   TRUNCATE 는 행 트리거를 건너뛰므로 막는다.
=========================================================================== */

create table if not exists room (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (btrim(code) <> ''),     -- 도면 번호. 101
  name        text not null check (btrim(name) <> ''),            -- 전실1
  clean_class text check (clean_class in ('A','B','C','D','CNC','NC')),
  area_m2     numeric check (area_m2 is null or area_m2 > 0),     -- 서면 도면의 면적
  rects       jsonb not null default '[]'::jsonb
              check (jsonb_typeof(rects) = 'array'),
  note        text,
  is_active   boolean not null default true
);
comment on table room is
  '방. 번호 · 이름 · 청정 등급 · 서면 면적 · 모양(사각형 여럿, mm). 설비 배치도의 바탕 (0125)';

alter table equipment add column if not exists room_id    uuid references room(id) on delete set null;
alter table equipment add column if not exists to_room_id uuid references room(id) on delete set null;
alter table equipment add column if not exists pos_x_mm   int;
alter table equipment add column if not exists pos_y_mm   int;

comment on column equipment.room_id    is '놓인 방 (0125). 비어 있으면 방 밖이거나 아직 놓지 않음';
comment on column equipment.to_room_id is '벽에 걸친 설비의 건너편 방. 패스박스 · 패스스루 (0125)';
comment on column equipment.pos_x_mm   is '배치도 위 자리 x (mm, 도면 왼쪽 위 기준) (0125)';
comment on column equipment.pos_y_mm   is '배치도 위 자리 y (mm) (0125)';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'equipment_pos_pair') then
    alter table equipment add constraint equipment_pos_pair
      check ((pos_x_mm is null) = (pos_y_mm is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'equipment_to_room_other') then
    alter table equipment add constraint equipment_to_room_other
      check (to_room_id is null or to_room_id is distinct from room_id);
  end if;
end $$;

create index if not exists equipment_room on equipment (room_id);

/* --- 감사추적 · 지우기 ------------------------------------------------------ */
drop trigger if exists room_audit on room;
create trigger room_audit after insert or update or delete on room
  for each row execute function trg_audit('id');

drop trigger if exists room_no_truncate on room;
create trigger room_no_truncate before truncate on room
  for each statement execute function trg_block_delete();

grant select, insert, update, delete on room to app_role;
grant select on room to app_readonly;
revoke truncate on room from app_role;
