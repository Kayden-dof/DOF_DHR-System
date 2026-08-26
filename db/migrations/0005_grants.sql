-- =============================================================================
-- 0005_grants.sql  —  권한 (S03)
-- 근거: CLAUDE.md §5 (revoke delete ... from app_role), §4.10 운영 규칙
-- 범위: M0
-- =============================================================================
--
-- 원칙: 필요한 것만 준다. REVOKE는 실수로 GRANT ALL이 들어갔을 때를 대비한
-- 이중 확인이지, 이것만으로 막히는 것이 아니다. 애초에 주지 않는 것이 1차
-- 방어선이고, 소유자·슈퍼유저 우회는 0002/0004의 차단 트리거가 막는다.
--
-- §5의 REVOKE DELETE 목록 중 M0에 존재하는 표는 audit_log 하나다.
-- app_user·user_role은 그 목록에 없다 —— 역할 회수는 정상 작업이다.
-- numbering_rule·numbering_counter는 §4.10이 사실상 같은 것을 요구하므로
-- (규칙은 내리기만, 카운터는 되돌리지 않기) 같은 취급을 한다.

-- -----------------------------------------------------------------------------
-- 사용자 · 역할
-- app_user에 DELETE를 주지 않는다. 계정 정리는 is_active=false로 한다.
-- 기록을 남긴 계정을 지우면 그 기록의 작성자를 설명할 수 없게 된다.
-- user_role은 DELETE를 준다. 역할 회수 경로가 없으면 전보·퇴사를 처리할 수
-- 없고, 개발 계정 전환도 QP 회수를 전제로 하기 때문이다. 회수 이력은
-- user_role_audit 트리거가 남긴다.
-- -----------------------------------------------------------------------------
grant select, insert, update         on app_user  to app_role;
grant select, insert, update, delete on user_role to app_role;

revoke delete, truncate on app_user  from app_role;
revoke truncate         on user_role from app_role;

-- -----------------------------------------------------------------------------
-- 감사추적
-- 읽기만 준다. 쓰기는 trg_audit(security definer)만 한다. app_role에 INSERT를
-- 주면 감사기록을 위조할 수 있다.
-- -----------------------------------------------------------------------------
grant select on audit_log to app_role;
revoke insert, update, delete, truncate on audit_log from app_role;

-- -----------------------------------------------------------------------------
-- 채번
-- numbering_counter에는 아무 권한도 주지 않는다. "관리 화면에서도 노출하지
-- 않는다"(§4.10). 응용은 next_number()로만 접근한다 —— 그래서 그 함수가
-- security definer다.
-- -----------------------------------------------------------------------------
grant select, insert, update on numbering_rule to app_role;
revoke delete, truncate      on numbering_rule from app_role;

revoke all on numbering_counter from app_role;

-- -----------------------------------------------------------------------------
-- 함수
-- security definer 함수는 PUBLIC 기본 EXECUTE를 회수하고 명시적으로 준다.
-- 응용 계층에서 번호를 조합하지 않는다. 반드시 next_number()를 경유한다 (§10).
-- -----------------------------------------------------------------------------
revoke all on function next_number(numbering_target, uuid) from public;
grant execute on function next_number(numbering_target, uuid) to app_role;

grant execute on function current_user_id()      to app_role;
grant execute on function has_role(role_code)    to app_role;

-- 규칙 관리 화면의 형식 미리보기. 카운터를 건드리지 않는 순수 치환이다.
grant execute on function render_number(text, int, int, timestamp, text)  to app_role;
grant execute on function preview_number(text, int, int, text)            to app_role;
