-- ---------------------------------------------------------------------------
-- 시연 표식의 증명이 표시 이전을 묻지 않았다 (4차 감사 D2)
--
-- only_demo_data() 가 "표시 시각 뒤로 감사추적이 조용한가" 만 봤다.
--
--   select exists (select 1 from demo_marker)
--      and not exists (select 1 from audit_log where acted_at > seeded_at)
--
-- 표시가 자료보다 **뒤에** 찍히므로, 그 앞에 무엇이 있었는지는 묻지 않는다.
-- 실기록이 든 DB 에 표식을 찍으면 증명이 통과하고, 그 순간 audit_log 를 뺀
-- 전 표에서 DELETE 가 열린다 (trg_block_delete).
--
-- 0051 주석이 적은 등식 - "이 DB 에는 지어낸 자료 말고는 아무것도 없다" -
-- 이 성립하지 않았다.
--
-- ── 고치는 방향 ────────────────────────────────────────────────────────
-- 표식에 **기준선**을 함께 적는다. 자료를 심기 시작하기 전의 감사추적 마지막
-- 번호다. 그보다 앞선 줄이 하나라도 있으면 이 DB 에는 시연 이전의 무언가가
-- 있었다는 뜻이므로 증명이 서지 않는다.
--
-- 기존 표식에는 기준선이 없다. 그때는 "모른다" 이고, 모르면 증명하지 않는다.
-- 문은 닫히는 쪽이 안전하다.
-- ---------------------------------------------------------------------------

alter table demo_marker add column if not exists audit_before bigint;

comment on column demo_marker.audit_before is
  '시연 자료를 심기 전의 audit_log 마지막 번호. 그보다 앞선 줄이 있으면 시연 전용 DB 가 아니다';

create or replace function only_demo_data()
returns boolean
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp as $$
  select exists (select 1 from demo_marker where audit_before is not null)
     /* 표시 뒤로 사람이 손대지 않았는가 */
     and not exists (
       select 1 from audit_log
        where acted_at > (select seeded_at from demo_marker limit 1))
     /* 표시 앞에 무언가 있지 않았는가 */
     and not exists (
       select 1 from audit_log
        where id <= (select audit_before from demo_marker limit 1))
$$;

comment on function only_demo_data() is
  '이 DB 에 지어낸 시연 자료 말고는 아무것도 없음을 DB 가 증명할 수 있는가 (앞뒤를 다 본다)';


-- === purge_demo_data 가 증명을 복제해 갖고 있었다 ==========================
--
-- 0051 은 증명을 함수로 떼어 두며 이렇게 적었다.
--
--   "따로 떼어 둔 이유는 트리거와 0050 이 같은 판정을 써야 하기 때문이다.
--    두 곳에 따로 쓰면 언젠가 한쪽만 고쳐지고, 느슨한 쪽이 이긴다."
--
-- 그런데 purge_demo_data 는 only_demo_data 를 부르지 않고 같은 판정을 제 안에
-- 다시 적고 있었다. 위에서 증명을 조이자 **느슨한 쪽이 그대로 남아** 증명이
-- 서지 않는데도 비우기가 통과했다 (4차 감사에서 시험이 잡았다).
--
-- 본문은 손대지 않고 맨 앞에 한 줄만 세운다. 통째로 다시 적으면 옮겨 적다
-- 틀릴 수 있고, 이 함수는 기록 전체를 지우는 함수다.

do $$
declare src text; patched text; anchor text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_demo_data' limit 1;

  if src is null or src like '%only_demo_data()%' then
    return;                                   -- 없거나 이미 부르고 있다
  end if;

  /*
   * 이미 있는 검사들 **뒤에** 세운다.
   *
   * 앞에 두었더니 그 메시지가 먼저 나가 원래의 구체적인 문구를 덮었다.
   * 시험 출력이 그대로 OQ 각본이 되므로 (§8.1) 이미 검증된 문장을 바꾸면
   * 각본도 함께 바뀐다. 무엇이 걸렸는지 조작자가 알아야 하기도 하다.
   *
   * 그래서 여기서는 남은 것만 본다 - 표시 **앞에** 무엇이 있었는가.
   */
  anchor := '갈라낼 수 없으므로 비우지 않습니다'', v_after;' || chr(10) || '  end if;';

  if position(anchor in src) = 0 then
    raise notice 'purge_demo_data 의 본문 모양이 달라 검사를 붙이지 못했습니다';
    return;
  end if;

  patched := replace(src, anchor, anchor || chr(10) || chr(10)
    || '  if not only_demo_data() then' || chr(10)
    || '    raise exception ''시연 자료 표시 앞에 다른 기록이 있거나 기준선이 없습니다. ''' || chr(10)
    || '      ''이 DB 는 시연 전용이라고 증명되지 않습니다'';' || chr(10)
    || '  end if;');

  execute patched;
end $$;
