/* ---------------------------------------------------------------------------
   열람자

   진행 상황을 보기만 하는 사람이 필요하다. 대표가 배치가 어디까지 갔는지,
   원가가 어떻게 나오는지 보려면 지금은 생산관리자 계정을 빌려야 하는데,
   그 계정은 작업 지시를 발행하고 자재를 고칠 수 있다. 보려고 들어간 사람이
   실수로 무언가를 바꾸는 길을 열어 둘 이유가 없다.

   역할 이름을 사람이 아니라 직무로 둔다. 대표 계정에 이 역할을 붙이고,
   나중에 감사 대응이나 외부 심사원에게도 같은 역할을 쓴다.

   ── 응용에서만 막지 않는다 ────────────────────────────────────────────────
   화면 게이트에 넣지 않는 것만으로도 지금은 막힌다. 모든 관리 화면이
   SYS_ADMIN 또는 PROD_MGR 만 통과시키기 때문이다. 그런데 그건 내가 게이트를
   하나도 빠뜨리지 않는다는 데 기대는 방식이고, §1 이 그걸 검증으로 치지
   않는다고 못 박고 있다.

   그래서 DB 역할을 따로 판다. app_readonly 는 select 만 가진다. 응용에
   구멍이 생겨도 쓰기는 DB 에서 거부된다. 두 겹 가운데 아래쪽이다.

   ── 인쇄는 쓰기다 ─────────────────────────────────────────────────────────
   이 시스템에서 인쇄는 보기가 아니다. 인쇄물 한 장이 record_print 행을 만들고,
   제조기록서라면 그 묶음이 잠긴다 (S04). 잠금을 푸는 방법은 없다.

   보려고 들어온 사람이 인쇄를 누르면 아직 작업 중인 일차가 잠겨 작업자가 더
   이상 기록하지 못한다. 그래서 열람자에게 인쇄 화면을 열지 않는다. select 만
   가진 역할이라 record_print insert 자체가 DB 에서 거부되기도 한다.
--------------------------------------------------------------------------- */

alter type role_code add value if not exists 'VIEWER';

/* ---------------------------------------------------------------------------
   읽기 전용 접속 역할

   app_role 과 나란히 둔다. 응용은 열람자 세션에서 이 역할로 질의한다
   (lib/db.ts 의 withActor). select 만 가지므로 insert · update · delete 는
   전부 DB 에서 거부된다.

   기존 표뿐 아니라 앞으로 만들 표에도 붙게 default privileges 를 건다.
   나중에 표를 하나 더 만들고 여기에 grant 하는 것을 잊으면, 열람자 화면이
   그 표만 못 읽는 이상한 상태가 된다.
--------------------------------------------------------------------------- */
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_readonly') then
    create role app_readonly nologin;
  end if;
  execute format('grant app_readonly to %I', current_user);
end $$;

grant usage on schema public to app_readonly;
grant select on all tables    in schema public to app_readonly;
grant select on all sequences in schema public to app_readonly;
grant execute on all functions in schema public to app_readonly;

alter default privileges in schema public
  grant select on tables to app_readonly;
alter default privileges in schema public
  grant execute on functions to app_readonly;

/*
 * security definer 함수는 주인 권한으로 도므로 읽기 전용 역할이 불러도 쓰기가
 * 일어난다. 열람자가 부를 일이 없는 것들에서 실행 권한을 걷어 낸다.
 *
 * next_number() 는 채번이고 record_print_log() 는 인쇄 기록이다. 둘 다 부르는
 * 순간 행이 생긴다. 화면에서 막고 있지만 여기서도 막는다.
 */
revoke execute on function next_number(numbering_target, uuid) from app_readonly;
revoke execute on function complete_process(uuid) from app_readonly;
revoke execute on function cut_product_lot(uuid, uuid, int, int, date) from app_readonly;
revoke execute on function cut_product_lot_field(uuid, uuid, int, int, date) from app_readonly;
revoke execute on function amend_material_issue(uuid, numeric, text) from app_readonly;
revoke execute on function return_material_issue(uuid, numeric, text) from app_readonly;
revoke execute on function retrieve_print(uuid, text) from app_readonly;
revoke execute on function copy_dmr_structure(uuid, uuid) from app_readonly;
revoke execute on function record_print_log(print_kind, text, uuid, uuid, int, uuid, uuid, int, uuid)
  from app_readonly;
