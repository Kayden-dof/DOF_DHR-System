-- ---------------------------------------------------------------------------
-- 로고는 PNG 만 (사용자 지시 2026-09-01)
--
-- 0070 은 SVG 도 받았다. SVG 는 글자 파일이라 두 가지가 따라온다.
--
--   1) 글꼴을 참조한다. 로고를 내보낼 때 글자를 외곽선으로 바꾸지 않으면 그
--      글꼴이 없는 기계에서 다른 모양으로 그려지거나 사라진다. 회사 이름이 든
--      로고가 그렇게 되면 종이에 틀린 것이 찍힌다.
--   2) 스크립트와 바깥 그림을 품을 수 있다.
--
-- 응용에서 막는 것으로 끝내지 않는다. 응용에서만 막은 건 검증이 아니다 (§1).
--
-- 판정에 관여하지 않는다. 로고는 표시이고, 이 제약은 담기는 형식만 정한다.
-- ---------------------------------------------------------------------------

do $$
begin
  -- 남아 있는 SVG 가 있으면 제약을 걸기 전에 멈춘다. 조용히 지우지 않는다 -
  -- 이 시스템에는 삭제가 없고, 지우면 무엇이 있었는지 알 길이 사라진다.
  if exists (select 1 from org_brand where logo_mime = 'image/svg+xml') then
    raise exception
      'SVG 로고가 담겨 있습니다. 설정 · 회사 표시에서 PNG 로 다시 올린 뒤 이 이관을 적용하십시오';
  end if;
end $$;

alter table org_brand drop constraint if exists org_brand_logo_mime_check;
alter table org_brand add  constraint org_brand_logo_mime_check
  check (logo_mime is null or logo_mime = 'image/png');
