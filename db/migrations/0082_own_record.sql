-- ---------------------------------------------------------------------------
-- 남의 공정 기록에 써 넣지 못한다 (4차 감사 D6)
--
-- issueMaterial · endRecord 가 process_record_id 를 폼 값 그대로 썼다. 그
-- 기록이 지금 로그인한 사람 것인지 응용도 DB 도 묻지 않았다.
--
-- 인쇄에는 그 확인이 이미 있다 (0053 · print_day_record). 같은 규율을 자재
-- 투입에도 세운다.
--
-- ── 왜 중요한가 ────────────────────────────────────────────────────────
-- 전자서명이 없어 기록의 귀속이 로그인 하나에 달려 있다 (§1). 종이에는 그
-- 묶음의 작업자만 표시되므로, 남의 기록에 붙은 투입은 종이에서 구분되지
-- 않는다. issued_by 와 감사추적에는 실제 행위자가 남지만, 그건 사후에
-- 캐내는 것이지 예방이 아니다.
--
-- ── 관리하는 사람은 지나간다 ────────────────────────────────────────────
-- 0053 과 같다. 작업자가 자리에 없는데 정정해야 하는 일이 있다. 누가 넣었는지는
-- issued_by 에 그대로 남는다.
--
-- 화면에는 남의 기록에 붙는 폼이 그려지지 않으므로, 이것은 오조작이 아니라
-- 조작한 요청을 막는 층이다.
-- ---------------------------------------------------------------------------

create or replace function trg_issue_own_record()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_actor uuid := current_user_id(); v_owner uuid;
begin
  /* 설치와 이관은 로그인 정보 없이 돈다. 사람이 하는 것만 묻는다 */
  if v_actor is null then
    return new;
  end if;

  select worker_id into v_owner from process_record where id = new.process_record_id;
  if v_owner is null then
    return new;                      -- 기록이 없으면 FK 가 막는다
  end if;

  if v_actor <> v_owner
     and not exists (select 1 from user_role
                      where user_id = v_actor and role in ('PROD_MGR', 'SYS_ADMIN')) then
    raise exception '다른 사람의 공정 기록에는 자재를 기록할 수 없습니다';
  end if;
  return new;
end $$;

drop trigger if exists material_issue_own on material_issue;
create trigger material_issue_own before insert
  on material_issue for each row execute function trg_issue_own_record();


-- 공정 마감과 정정도 같다. process_record 를 고치는 자리
create or replace function trg_record_own()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_actor uuid := current_user_id();
begin
  if v_actor is null then
    return new;
  end if;

  if v_actor <> old.worker_id
     and not exists (select 1 from user_role
                      where user_id = v_actor and role in ('PROD_MGR', 'SYS_ADMIN')) then
    raise exception '다른 사람의 공정 기록은 고칠 수 없습니다';
  end if;
  return new;
end $$;

drop trigger if exists process_record_own on process_record;
create trigger process_record_own before update
  on process_record for each row execute function trg_record_own();
