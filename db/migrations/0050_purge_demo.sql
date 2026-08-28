/* ---------------------------------------------------------------------------
   시연 자료 비우기 — 한 번만 쓰이고 사라지는 단추

   0049 는 "실 운영 전에 비우십시오" 라는 띠와 터미널 명령을 띄웠다. 그런데
   명령을 적어 두면 그걸 실행할 곳이 없는 사람에게는 아무 소용이 없다
   (사용자 지적). 화면에서 눌러 비울 수 있어야 한다.

   ── 이것이 §10 의 예외인가 ────────────────────────────────────────────────
   아니다. §10 이 지키는 것은 "기록은 지워지지 않는다" 이고, 그 기록이란 실제로
   일어난 일의 기록이다. 여기서 지우는 것은 일어나지 않은 일을 지어낸 자료다.

   그래도 응용에 삭제 경로를 여는 일이므로 자물쇠를 세 겹 건다.

     1) 표시가 있어야 한다
        demo_marker 는 시드 스크립트만 넣을 수 있다. 응용은 insert 권한이
        없다 (0049). 표시가 없으면 이 함수는 아무것도 하지 않는다.

     2) 표시를 남긴 뒤에 아무 일도 없었어야 한다
        audit_log 는 모든 입력과 변경을 남긴다. 표시 시각 뒤에 한 줄이라도
        있으면 그 사이에 실제 작업이 섞였을 수 있으므로 거부한다.
        이게 핵심 자물쇠다 - 실 운영이 시작된 뒤에는 절대 돌지 않는다.

     3) 시스템관리자만
        역할로 한 번 더 좁힌다.

   ── 한 번 쓰면 사라진다 ───────────────────────────────────────────────────
   마지막에 표시를 지운다. 표시가 없으면 1) 에서 막히므로 이 함수는 두 번째
   호출부터 늘 거부한다. 화면의 단추와 띠도 표시를 보고 그리므로 함께 사라진다.

   ── 감사추적은 지우지 않는다 ──────────────────────────────────────────────
   지어낸 자료를 지우는 것과, 지웠다는 사실을 지우는 것은 다르다. audit_log 는
   그대로 두고 여기에 비운 사실을 한 줄 더한다. 나중에 "이 시스템에 시연 자료가
   있었고 언제 비웠는가" 를 답할 수 있어야 한다.
--------------------------------------------------------------------------- */

create or replace function purge_demo_data()
returns text language plpgsql security definer as $fn$
declare
  v_me uuid; v_seeded timestamptz; v_after bigint; v_counts jsonb;
begin
  v_me := current_user_id();
  if v_me is null then
    raise exception '로그인 정보가 없습니다';
  end if;

  if not exists (select 1 from user_role
                  where user_id = v_me and role = 'SYS_ADMIN') then
    raise exception '시스템관리자만 시연 자료를 비울 수 있습니다';
  end if;

  select seeded_at into v_seeded from demo_marker limit 1;
  if v_seeded is null then
    raise exception '시연 자료 표시가 없습니다. 비울 것이 없거나 이미 비웠습니다';
  end if;

  /*
   * 표시를 남긴 뒤에 한 줄이라도 움직였으면 거부한다.
   *
   * audit_log 는 모든 입력과 변경을 남기므로, 그 뒤에 행이 있다는 것은 지어낸
   * 자료와 실제 작업이 섞였다는 뜻이다. 섞인 뒤에는 갈라낼 방법이 없고,
   * 갈라내지 못하면 지워서는 안 된다.
   */
  select count(*) into v_after from audit_log where acted_at > v_seeded;
  if v_after > 0 then
    raise exception
      '시연 자료를 넣은 뒤에 기록이 %건 더 쌓였습니다. 지어낸 자료와 실제 기록을 '
      '갈라낼 수 없으므로 비우지 않습니다', v_after;
  end if;

  select jsonb_build_object(
      '작업지시', (select count(*) from work_order),
      '제품로트', (select count(*) from product_lot),
      '공정기록', (select count(*) from process_record),
      '자재로트', (select count(*) from material_lot),
      '출고',     (select count(*) from shipment))
    into v_counts;

  /* 배치에서 갈라져 나온 것부터. 참조가 걸린 순서를 거슬러 올라간다 */
  delete from shipment;
  delete from steril_batch_lot;
  delete from steril_batch;
  delete from product_nonconformity;
  delete from wip_nonconformity;
  delete from material_issue;
  delete from stock_movement;
  delete from day_lock;
  delete from record_print;
  delete from process_record;
  delete from product_lot;
  delete from work_order_plan;
  delete from work_order;

  /*
   * 자재 로트도 지운다. 남겨 두면 잔여 수량이 지어낸 불출만큼 깎인 채로 남아,
   * 실물과 맞지 않는 재고가 첫날부터 서 있게 된다. 실 운영은 실제 성적서 번호로
   * 다시 입고하면서 시작하는 것이 맞다.
   *
   * material_lot 이 purchase_order 를 가리키므로 로트를 먼저 지운다.
   */
  delete from material_lot;
  delete from purchase_order;

  delete from demo_marker;

  /* 지운 사실은 남긴다. 지우는 것과 지웠다는 사실을 지우는 것은 다르다 */
  insert into audit_log (table_name, record_id, action, actor_id, old_value, new_value)
  values ('demo_marker', gen_random_uuid(), 'PURGE', v_me, v_counts,
          jsonb_build_object('purged_at', now(), 'seeded_at', v_seeded));

  return format('시연 자료를 비웠습니다. 작업지시 %s · 제품로트 %s · 공정기록 %s · 자재로트 %s',
                v_counts->>'작업지시', v_counts->>'제품로트',
                v_counts->>'공정기록', v_counts->>'자재로트');
end $fn$;

/*
 * public 에게 기본으로 붙는 execute 를 먼저 걷는다. 걷지 않으면 열람 전용
 * 역할도 public 을 타고 이 함수를 부를 수 있다 - 함수 안에서 역할을 한 번 더
 * 보긴 하지만, 부를 수 없어야 할 것은 부를 수 없게 두는 편이 맞다.
 */
revoke execute on function purge_demo_data() from public;
grant execute on function purge_demo_data() to app_role;
