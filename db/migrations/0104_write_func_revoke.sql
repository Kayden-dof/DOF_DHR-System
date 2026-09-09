-- ---------------------------------------------------------------------------
-- 쓰는 함수를 열람 역할에서 이름으로 걷어 낸다 (IQ-14 가 짚음 2026-09-08)
--
-- IQ 를 돌렸더니 열람 역할(app_readonly)이 쓰는 함수 둘을 부를 수 있었다.
--
--     next_number      security definer · 부르면 채번 카운터가 오른다
--     sync_po_status   발주 상태를 쓴다
--
-- 앞의 것이 실제 구멍이다. security definer 라 주인 권한으로 도므로, 열람
-- 계정이 불러도 번호가 소진된다. 그 번호는 되돌릴 수 없고 (§4.10 "번호는
-- 재사용하지 않는다") 대장에는 그 자리가 왜 비었는지 남지 않는다.
--
-- ── 왜 열려 있었는가 ────────────────────────────────────────────────────
-- 0043 이 두 줄을 함께 넣었다.
--
--     alter default privileges in schema public
--       grant execute on functions to app_readonly;      ← 앞으로 만들 것 전부
--     revoke execute on function next_number(numbering_target, uuid)
--       from app_readonly;                               ← 그때의 서명
--
-- 앞 줄은 **그 뒤에 만들어지는 함수를 전부 자동으로 열어 준다.** 뒷줄은 그때의
-- 서명을 손으로 적어 둔 것이다. 0097 이 날짜 인자를, 0099 가 배치 인자를 더해
-- `next_number` 를 다시 만들면서 새 함수 객체가 생겼고, 앞 줄이 그것을 열었다.
-- 뒷줄은 이제 없는 서명을 가리키고 있어 아무것도 걷지 않는다.
--
-- **손으로 적은 서명 목록은 서명이 바뀌면 조용히 잠든다.** 0043 을 고치지
-- 않는다 - 이관은 지난 사실이다. 여기서 이름으로 다시 건다.
--
-- ── 이름으로 건다 ───────────────────────────────────────────────────────
-- 서명이 아니라 **이름**으로 훑어 그 이름의 모든 갈래에서 걷는다. 다음에 인자가
-- 늘어도 이 이관이 다시 돌면서 새 갈래까지 덮는다 (이관은 배포마다 다시 돈다).
--
-- 목록에 없는 이름은 그대로 열려 있다. 조회 함수는 열려 있어야 열람 화면이
-- 돌기 때문이다 (0043 의 판단은 그대로 둔다). 대신 IQ-14 가 그 목록을
-- 지킨다 - 쓰는 함수를 새로 만들고 여기 안 넣으면 다음 IQ 에서 걸린다.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  /* 부르면 자료가 바뀌는 함수들. IQ-14 의 WRITE_FUNCS 와 같은 목록이다 */
  names text[] := array[
    'next_number',
    'record_print_log',
    'print_day_record',
    'retrieve_print',
    'complete_process',
    'cut_product_lot',
    'cut_product_lot_field',
    'amend_material_issue',
    'return_material_issue',
    'make_solution',
    'copy_dmr_structure',
    'purge_demo_data',
    'sync_po_status',
    'record_print_lots'
  ];
begin
  if not exists (select 1 from pg_roles where rolname = 'app_readonly') then
    return;
  end if;

  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any(names)
  loop
    execute format('revoke execute on function %s from app_readonly', r.sig);
    execute format('revoke execute on function %s from public', r.sig);
  end loop;
end $$;
