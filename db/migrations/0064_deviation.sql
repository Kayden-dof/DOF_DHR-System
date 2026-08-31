/* ---------------------------------------------------------------------------
   일탈 대장 (사용자 결정 2026-08-31)

   §9.1 이 일탈 관리를 범위 밖으로 두면서 이렇게 적어 두었다.

     "numbering_target 에 DEVIATION 이 있고 채번 화면이 '일탈 번호' 를 선택지로
      내놓으나 담을 표도 화면도 없다. 번호만 나가는 상태로 운영에 들어가지
      않는다 - 선택지를 내리거나 대장을 만들거나 둘 중 하나를 정한다."

   대장을 만드는 쪽으로 정해졌다. 번호가 나가고 어디에도 남지 않는 상태가
   닫힌다.

   ── 시스템은 일탈을 판정하지 않는다 (§1) ──────────────────────────────────
   무엇이 일탈인지, 얼마나 중대한지, 조치가 타당한지는 사람이 서면으로 정한다.
   여기 적히는 것은 그 결정의 결과와 그것을 가리키는 문서번호다. 부적합 표가
   특채를 다루는 방식과 같다 (0045).

   그래서 이 표에는 등급도 없고 분류 열거형도 없다. 등급을 두면 시스템이 일탈의
   경중을 정하는 것이 되고, 그 순간 §1 의 경계를 넘는다.

   ── 종결은 상태 열이 아니라 사실이다 ──────────────────────────────────────
   status 열을 따로 두지 않는다. 종결일이 적혀 있으면 종결된 것이다. 상태를
   별도 열로 들면 종결일과 어긋날 수 있고, 어긋나면 어느 쪽이 참인지 알 수 없다.

   종결하려면 서면 보고서 번호와 승인자·승인일이 있어야 한다. 문서 없이 닫히는
   일탈은 대장에 적힐 이유가 없다 - 그 문서가 판정이고 대장은 그것을 가리킬
   뿐이다.

   ── 적힌 것은 고쳐 쓰지 않는다 (§2.1) ─────────────────────────────────────
   일탈 번호와 발생일은 처음 적은 값 그대로 간다. 종결 기록도 한 번 적으면
   바뀌지 않고 되돌려지지 않는다. 종결을 되돌릴 수 있으면 "그때 닫혀 있었다"
   가 성립하지 않는다.

   경위와 관련 대상은 열려 있다. 조사 중에 밝혀지는 것이 있고, 그것을 못 적게
   하면 대장 밖의 종이에 적히게 된다.
--------------------------------------------------------------------------- */

create table if not exists deviation (
  id             uuid primary key default gen_random_uuid(),
  deviation_no   text not null unique,        -- next_number('DEVIATION')
  occurred_on    date not null,
  title          text not null,               -- 무엇이 일어났는가. 한 줄
  detail         text,

  /* 무엇에 걸린 일탈인가. 전부 널 허용 - 어디에도 안 걸리는 일탈이 있다 */
  work_order_id  uuid references work_order(id),
  product_lot_id uuid references product_lot(id),
  material_lot_id uuid references material_lot(id),
  equipment_id   uuid references equipment(id),

  /* 서면 판정. 이것이 판정이고 아래 세 열은 그것을 가리킨다 (§1) */
  report_no      text,                        -- 서면 일탈 보고서 번호
  outcome        text,                        -- 서면에 적힌 결론을 옮겨 적는다
  approved_by    text,                        -- 승인자 이름. 계정이 아니다 (§4.5)
  approved_on    date,
  closed_on      date,

  registered_by  uuid not null references app_user(id),
  registered_at  timestamptz not null default now(),

  /* 종결하려면 서면 근거가 있어야 한다 */
  check (closed_on is null
         or (report_no is not null and outcome is not null
             and approved_by is not null and approved_on is not null)),
  /* 승인일이 발생일보다 앞설 수는 없다 */
  check (approved_on is null or approved_on >= occurred_on),
  check (closed_on is null or closed_on >= occurred_on)
);
create index if not exists deviation_occurred on deviation (occurred_on desc);
create index if not exists deviation_wo on deviation (work_order_id);
create index if not exists deviation_open on deviation (closed_on) where closed_on is null;

comment on table deviation is
  '일탈 대장. 서면 일탈 보고서의 결론과 문서번호를 옮겨 적는다. 시스템은 판정하지 않는다';
comment on column deviation.outcome is
  '서면에 적힌 결론을 그대로 옮긴 문장. 분류 열거형을 두지 않는다 (§1)';

/* --- 적힌 것은 고쳐 쓰지 않는다 -------------------------------------------- */
drop trigger if exists deviation_once on deviation;
create trigger deviation_once before update on deviation
  for each row execute function trg_once_written(
    'deviation_no', 'occurred_on', 'report_no', 'outcome',
    'approved_by', 'approved_on', 'closed_on');

/* --- 권한과 감사추적 ------------------------------------------------------- */
grant select, insert, update on deviation to app_role;
revoke delete on deviation from app_role;
grant select on deviation to app_readonly;

drop trigger if exists deviation_audit on deviation;
create trigger deviation_audit after insert or update
  on deviation for each row execute function trg_audit();

/* ---------------------------------------------------------------------------
   대장 조회

   무엇에 걸렸는지를 이름으로 풀어 둔다. 화면이 네 표를 각자 조인하면 화면마다
   조인이 갈린다.
--------------------------------------------------------------------------- */
create or replace view v_deviation as
select d.*,
       wo.batch_no,
       pl.lot_no       as product_lot_no,
       ml.lot_no       as material_lot_no,
       e.code          as equipment_code,
       e.name          as equipment_name,
       u.full_name     as registered_by_name,
       (d.closed_on is null) as is_open
  from deviation d
  left join work_order   wo on wo.id = d.work_order_id
  left join product_lot  pl on pl.id = d.product_lot_id
  left join material_lot ml on ml.id = d.material_lot_id
  left join equipment    e  on e.id  = d.equipment_id
  left join app_user     u  on u.id  = d.registered_by;

grant select on v_deviation to app_role, app_readonly;
