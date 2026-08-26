-- =============================================================================
-- 0026_shipment_request_required.sql  ·  출고에 출하 승인서 번호 필수
-- 근거: 사용자 결정 2026-08-27 ("입력 안 하면 기록 안 되게 만드는 게 맞음")
-- =============================================================================
--
-- 0025 는 이 값을 선택으로 두었다 (차단은 S01~S05 뿐이라는 §2 원칙). 그 판단을
-- 사용자에게 물었고, 필수로 확정되었다. 출고는 서면 승인된 요청서에 근거해야
-- 하고, 그 근거 없이 적힌 출고 기록은 나중에 이을 방법이 없다. S02 가 자재
-- 입고에 성적서 번호를 요구하는 것과 같은 성격의 고리다.
--
-- 응용 계층이 아니라 여기서 막는다. "응용 계층에서만 막은 건 검증이 아니다" (§1).
--
-- 소급하지 않는다. 이 규칙이 생기기 전의 출고 기록에는 번호가 없고, 그 사실이
-- 그대로 남아야 한다. 그래서 NOT NULL 이 아니라 트리거다 - 기존 행은 번호가
-- 빈 채로 두고, 새로 적히는 기록부터 요구한다.

create or replace function trg_shipment_request_no()
returns trigger language plpgsql as $$
begin
  -- 기존 행의 다른 값 수정은 막지 않는다. 번호를 건드리지 않으면 지나간다
  if tg_op = 'UPDATE'
     and new.release_request_no is not distinct from old.release_request_no then
    return new;
  end if;

  if new.release_request_no is null or btrim(new.release_request_no) = '' then
    raise exception '출하 승인서 번호가 없습니다. 서면 승인된 요청서의 번호를 적어야 출고를 기록할 수 있습니다';
  end if;
  return new;
end $$;

drop trigger if exists shipment_request_no on shipment;
create trigger shipment_request_no before insert or update
  on shipment for each row execute function trg_shipment_request_no();
