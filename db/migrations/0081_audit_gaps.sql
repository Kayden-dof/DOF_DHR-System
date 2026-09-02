-- ---------------------------------------------------------------------------
-- 감사에서 나온 스키마 구멍을 닫는다 (4차 적대적 감사 2026-09-02)
--
--   D1  개발 계정 표시를 켜는 것도 시스템관리자만
--   D3  purge_demo_data 에 search_path
--   F1  model_scheme · model_segment 에 감사 · 삭제 차단
--   F2  deviation · labour_rate 에 삭제 차단
-- ---------------------------------------------------------------------------


-- === D1. 개발 계정 표시를 켜는 것도 시스템관리자만 =========================
--
-- 0052 는 **끄는 것**만 막았다. 켜는 것은 열려 있었고, 계정을 새로 만들 때는
-- 응용에도 검사가 없었다.
--
-- 생산관리자 하나가 화면만으로 완주했다 - 개발 계정을 만들며 초기 비밀번호를
-- 스스로 정하고, 그 계정으로 들어가 임의 계정의 비밀번호를 초기화한다
-- (setPin 의 유일한 문턱이 is_developer 다). 전자서명이 없어 기록의 귀속이
-- 로그인 하나에 달려 있으므로(§1), 그 뒤 남의 이름으로 공정 기록이 남고 그
-- 이름이 박힌 제조기록서가 인쇄되어 S04 로 잠긴다.
--
-- 응용에서 막았다. 그것만으로는 검증이 아니다 (§1-2).
--
-- ── 설치와 사람을 가른다 ────────────────────────────────────────────────
-- 이관과 배포 스크립트는 소유자로 돌고 app.user_id 가 비어 있다. 그때는 첫
-- 개발 계정을 만들어야 하므로 막지 않는다. 사람이 로그인해서 하는 것만 묻는다.

create or replace function trg_dev_flag_sysadmin()
returns trigger language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  /* 켜는 순간만 본다. 끄는 것은 0052 가 이미 막는다 */
  if new.is_developer and not coalesce(old.is_developer, false) then
    if current_user_id() is not null and not has_role('SYS_ADMIN') then
      raise exception '개발 계정 표시는 시스템관리자만 켤 수 있습니다';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists app_user_dev_flag on app_user;
create trigger app_user_dev_flag before insert or update of is_developer
  on app_user for each row execute function trg_dev_flag_sysadmin();


-- === D3. 기록 전체를 지우는 함수에 search_path =============================
--
-- §10 이 명시적으로 금지한 상태였다. security definer 함수가 search_path 를
-- 고정하지 않으면, 임시 표를 만들 수 있는 주체가 그 함수가 보는 자료를
-- 바꿔치기할 수 있다. 하필 **기록 전체를 지우는 유일한 함수**가 그랬다.
--
-- 지금은 app_role 로 임의 SQL 을 도는 주체가 없어 도달하지 못하지만, 0001
-- 안내대로 app_role 만 가진 로그인 계정을 만드는 순간 살아난다.

do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_demo_data'
   limit 1;

  if src is not null and src not like '%search_path%' then
    /* 본문은 그대로 두고 설정만 붙인다. 고쳐 쓰면 두 곳이 갈라진다 */
    execute 'alter function purge_demo_data() set search_path = pg_catalog, public, pg_temp';
  end if;
end $$;


-- === F1. 종이 치수를 정하는 표에 감사와 삭제 차단 ==========================
--
-- model_scheme · model_segment 는 spec_label() 의 유일한 출처이고, 그 값이
-- 라벨요청서와 출하 승인 요청서 종이에 나간다. 그런데 감사 트리거도 삭제
-- 차단도 없었다. divisor 한 줄이 바뀌어도 audit_log 에 한 줄도 남지 않았다.
--
-- §5 는 기록 성격의 표와 **기준정보 표에도** 감사를 걸라고 한다.

drop trigger if exists model_scheme_audit on model_scheme;
create trigger model_scheme_audit after insert or update or delete
  on model_scheme for each row execute function trg_audit();

drop trigger if exists model_segment_audit on model_segment;
create trigger model_segment_audit after insert or update or delete
  on model_segment for each row execute function trg_audit('scheme_id');

drop trigger if exists model_scheme_no_delete on model_scheme;
create trigger model_scheme_no_delete before delete or truncate
  on model_scheme for each statement execute function trg_block_delete();

drop trigger if exists model_segment_no_delete on model_segment;
create trigger model_segment_no_delete before delete or truncate
  on model_segment for each statement execute function trg_block_delete();


-- === F2. 삭제 차단이 REVOKE 만인 표 ========================================
--
-- deviation 과 labour_rate 는 app_role 의 DELETE 를 걷었을 뿐 트리거가 없다.
-- 노출 면은 소유자 세션(SQL 편집기 · 이관 · 복구 도구)이다. 다른 기록성 표와
-- 같은 층을 세운다.

drop trigger if exists deviation_no_delete on deviation;
create trigger deviation_no_delete before delete or truncate
  on deviation for each statement execute function trg_block_delete();

drop trigger if exists labour_rate_no_delete on labour_rate;
create trigger labour_rate_no_delete before delete or truncate
  on labour_rate for each statement execute function trg_block_delete();

comment on trigger model_scheme_audit on model_scheme is
  '형명 체계가 종이의 규격 표기를 정한다. 바뀌면 남아야 한다 (4차 감사 F1)';
