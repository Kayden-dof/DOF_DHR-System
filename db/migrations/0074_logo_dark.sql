-- ---------------------------------------------------------------------------
-- 어두운 바탕용 로고 (사용자 선택 2026-09-01)
--
-- 로그인 왼쪽 면과 현장 머리줄은 어둡다. 짙은 색 로고를 올리면 거기서 묻히고,
-- 흰 로고를 올리면 밝은 머리줄에서 묻힌다. 로고 한 장으로 두 바탕을 다 감당할
-- 수 없다.
--
-- 임시로 어두운 자리에서는 로고 뒤에 밝은 판을 깔아 두었는데, 히어로 면에서
-- 스티커처럼 보인다. 회사가 자기 흰색 로고를 올릴 수 있게 칸을 하나 더 둔다.
--
--   logo_bytes       밝은 바탕용. 머리줄 · 설정 · 인쇄물
--   logo_dark_bytes  어두운 바탕용. 로그인 왼쪽 면 · 현장 머리줄
--
-- 어두운 바탕용을 올리지 않으면 지금처럼 밝은 판을 깔아 밝은 바탕용 로고를
-- 얹는다. 어느 제조소에서나 읽히는 것이 먼저다.
--
-- PNG 만 받는 것은 0072 와 같다. 크기 상한도 같다.
-- 감사추적에는 바뀐 사실만 남고 그림은 (감춤) 으로 덮인다 (0060 · 0070).
-- ---------------------------------------------------------------------------

alter table org_brand add column if not exists logo_dark_bytes bytea;
alter table org_brand add column if not exists logo_dark_mime  text;
alter table org_brand add column if not exists logo_dark_name  text;

alter table org_brand drop constraint if exists org_brand_logo_dark_mime_check;
alter table org_brand add  constraint org_brand_logo_dark_mime_check
  check (logo_dark_mime is null or logo_dark_mime = 'image/png');

alter table org_brand drop constraint if exists org_brand_logo_dark_pair;
alter table org_brand add  constraint org_brand_logo_dark_pair
  check ((logo_dark_bytes is null) = (logo_dark_mime is null));

alter table org_brand drop constraint if exists org_brand_logo_dark_size;
alter table org_brand add  constraint org_brand_logo_dark_size
  check (logo_dark_bytes is null or octet_length(logo_dark_bytes) <= 524288);

-- 감사추적이 답해야 하는 것은 "언제 누가 바꿨는가" 이지 그 그림이 아니다 (§1)
create or replace function audit_secret_columns(p_table text)
returns text[] language sql immutable as $fn$
  select case p_table
    when 'app_user'  then array['pin_hash']
    when 'org_brand' then array['logo_bytes', 'logo_dark_bytes']
    else array[]::text[]
  end
$fn$;
