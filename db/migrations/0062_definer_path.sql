/* ---------------------------------------------------------------------------
   security definer 함수에 search_path 를 박는다 (IQ 최초 실행에서 발견)

   §10 이 이렇게 적어 두었다.

     "security definer 함수에 search_path 생략 — 호출자가 임시 표로 그 함수가
      보는 자료를 바꿔치기할 수 있다."

   1차 감사에서 닫은 줄 알았는데 세 개가 남아 있었다. 시험은 이것을 잡지
   못한다 — 함수가 옳게 도는지만 보고, 무엇을 보고 도는지는 묻지 않기
   때문이다. scripts/iq.mjs 를 처음 돌리자마자 나왔다.

   ── 무엇이 가능했는가 ─────────────────────────────────────────────────────
   definer 함수는 만든 사람의 권한으로 돈다. search_path 가 열려 있으면 부르는
   쪽이 pg_temp 에 같은 이름의 표를 만들어 둘 수 있고, 함수 안의 조회가 진짜
   표 대신 그 가짜를 읽는다. 소유자 권한으로 도는 코드가 부르는 사람이 지어낸
   자료를 사실로 삼는 셈이다.

   amend_material_issue 와 cut_product_lot_field 는 투입량 정정과 재단 수량을
   다루고, copy_dmr_structure 는 제품표준서 구조를 통째로 옮긴다. 셋 다 계보에
   닿는 자리다.

   ── 왜 함수를 다시 쓰지 않는가 ────────────────────────────────────────────
   본문은 옳다. 고칠 것은 그 함수가 무엇을 보는가 하나뿐이다. 본문을 다시
   쓰면 옮겨 적는 사이에 다른 것이 바뀔 수 있고, 그 위험을 질 이유가 없다.

   ── purge_demo_data 는 여기 없다 ──────────────────────────────────────────
   같은 상태이지만 손대지 않는다. 시연 자료를 비우는 경로는 지금 그대로 두기로
   확정되어 있다 (사용자 지시 2026-08-31). IQ 는 이 함수를 계속 짚어 보고서에
   남기고, 실무 착수 때 이 파일 자체가 정리되면서 함께 사라진다.
--------------------------------------------------------------------------- */

do $$
declare f text;
begin
  foreach f in array array[
    'amend_material_issue(uuid, numeric, text)',
    'copy_dmr_structure(uuid, uuid)',
    'cut_product_lot_field(uuid, uuid, int, int, date)'
  ] loop
    if to_regprocedure('public.' || f) is not null then
      execute format(
        'alter function public.%s set search_path = pg_catalog, public, pg_temp', f);
    end if;
  end loop;
end $$;
