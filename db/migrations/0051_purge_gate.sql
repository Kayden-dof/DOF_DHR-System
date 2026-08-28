/* ---------------------------------------------------------------------------
   S03 삭제 차단에 하나뿐인 좁은 문

   0050 의 시연 자료 비우기가 S03 트리거에 그대로 막혔다. 예상한 일이고, 막힌
   것이 맞다 - REVOKE DELETE 는 app_role 만 막지만 트리거는 소유자와
   security definer 함수까지 막는다. 설계대로 동작한 것이다.

   그러면 문을 어떻게 낼 것인가. §10 은 override · force · unlock 플래그를
   금한다. 세션 변수 하나를 켜고 지우는 방식은 정확히 그 플래그다 - 켤 수
   있는 사람이 언제든 켤 수 있으면 차단이 아니라 권고가 된다.

   ── 플래그 대신 증명 ──────────────────────────────────────────────────────
   여기서는 아무도 켜고 끌 수 없는 것을 조건으로 삼는다. DB 스스로 아래 두
   가지를 증명할 수 있을 때만 삭제가 통과한다.

     1) demo_marker 에 행이 있다
        이 표는 시드 스크립트가 DB 주인 권한으로만 넣는다. 응용에는 insert
        권한이 없다 (0049). 표시를 스스로 만들어 낼 수 없다.

     2) 그 표시 시각 뒤로 audit_log 가 조용하다
        감사추적은 모든 입력과 변경을 남긴다. 한 줄이라도 있으면 지어낸
        자료와 실제 작업이 섞였다는 뜻이고, 섞이면 갈라낼 수 없다.

   둘이 함께 성립한다는 것은 "이 DB 에는 지어낸 자료 말고는 아무것도 없다" 는
   말과 같다. 지울 기록이 없으므로 기록을 지우는 것이 아니다. 실 운영이
   시작되면 2) 가 첫 기록에서 곧바로 깨지고, 그 뒤로는 영원히 닫힌다.

   조건은 권한이 아니라 사실이다. 켜는 사람도, 푸는 함수도 없다.

   ── 절대 열리지 않는 두 곳 ────────────────────────────────────────────────
   audit_log  위 증명이 감사추적에 기대고 있다. 감사추적을 지울 수 있으면
              증명을 지어낼 수 있다. 예외 없이 막는다.
   TRUNCATE   조건과 무관하게 막는다. 표를 통째로 비우는 길은 열지 않는다.
              비우기는 0050 이 표를 하나씩 순서대로 지운다.

   ── 부적합 표에도 삭제 차단을 건다 ────────────────────────────────────────
   product_nonconformity · wip_nonconformity 는 0045 · 0047 에서 감사추적은
   달았으나 삭제 차단이 빠져 있었다. app_role 에 delete 권한이 없어 응용에서는
   지울 수 없었지만, 표 소유자는 지울 수 있었다 - §5 가 REVOKE 와 TRIGGER 를
   함께 걸라고 한 이유가 그것이다. 재작업 · 특채 · 불량 수량은 기록이므로
   빠진 쪽을 여기서 채운다.

   감사추적 트리거는 이미 있으므로 건드리지 않는다. 하나 더 달면 한 번 쓸 때
   감사기록이 두 줄 남는다.
--------------------------------------------------------------------------- */

/*
 * 지어낸 자료만 들어 있는 상태인가.
 *
 * 따로 떼어 둔 이유는 트리거와 0050 이 같은 판정을 써야 하기 때문이다. 두
 * 곳에 따로 쓰면 언젠가 한쪽만 고쳐지고, 느슨한 쪽이 이긴다.
 */
create or replace function only_demo_data()
returns boolean language sql stable as $$
  select exists (select 1 from demo_marker)
     and not exists (
       select 1 from audit_log
        where acted_at > (select seeded_at from demo_marker limit 1))
$$;

comment on function only_demo_data() is
  '이 DB 에 지어낸 시연 자료 말고는 아무것도 없음을 DB 가 증명할 수 있는가';

create or replace function trg_block_delete()
returns trigger language plpgsql as $fn$
begin
  /*
   * 표를 통째로 비우는 길은 어떤 조건에서도 열지 않는다.
   *
   * 문구는 손대지 않는다. S03-18 시험 출력이 그대로 OQ 각본이 되므로 (§8.1)
   * 이미 검증된 문장을 바꾸면 각본도 함께 바뀐다. 괄호 안의 tg_op 가 DELETE
   * 인지 TRUNCATE 인지 알려 주므로 구분에 부족함이 없다.
   */
  if tg_op = 'TRUNCATE' then
    raise exception 'S03: 기록은 삭제할 수 없습니다 (%, %)', tg_table_name, tg_op;
  end if;

  /*
   * 감사추적만은 예외가 없다. 위 증명이 감사추적을 근거로 서 있으므로,
   * 감사추적을 지울 수 있으면 증명 자체를 만들어 낼 수 있다.
   */
  if tg_table_name <> 'audit_log' and only_demo_data() then
    return old;
  end if;

  raise exception 'S03: 기록은 삭제할 수 없습니다 (%, %)', tg_table_name, tg_op;
end $fn$;


/* --- 부적합 표에도 §5 의 삭제 차단을 건다 --------------------------------- */
do $$
declare t text;
begin
  foreach t in array array['product_nonconformity', 'wip_nonconformity'] loop
    /* 0051 이 잘못 달았던 중복 감사 트리거를 걷는다 (0045 의 것이 정본이다) */
    execute format('drop trigger if exists %I on %I', t || '_audit', t);

    execute format('drop trigger if exists %I on %I', t || '_no_delete', t);
    execute format(
      'create trigger %I before delete on %I
         for each row execute function trg_block_delete()', t || '_no_delete', t);

    execute format('drop trigger if exists %I on %I', t || '_no_truncate', t);
    execute format(
      'create trigger %I before truncate on %I
         for each statement execute function trg_block_delete()', t || '_no_truncate', t);

    execute format('revoke delete, truncate on %I from app_role', t);
  end loop;
end $$;
