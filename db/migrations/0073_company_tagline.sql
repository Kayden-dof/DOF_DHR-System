-- ---------------------------------------------------------------------------
-- 회사 한 줄 문구도 설정으로 (§2.0)
--
-- 로그인 화면 왼쪽 어두운 면 아래에 'REGENERATIVE HEALTHCARE PLATFORM' 이
-- 코드에 박혀 있었다. DOF 가 무엇을 하는 회사인지를 적은 문구이고, 다른
-- 제조소가 받으면 자기 로고 아래에 남의 회사 설명이 붙는다.
--
-- system_tagline 과 다른 것이다.
--   system_tagline   이 프로그램이 무엇인가   '제조기록 지원 시스템'
--   company_tagline  이 회사가 무엇을 하는가  'REGENERATIVE HEALTHCARE PLATFORM'
--
-- 지금 값을 그대로 심는다. DOF 화면은 달라지지 않는다.
--
-- 열을 세우는 그 한 번만 심는다 (2026-11-27 정밀 점검). deploy-db 는 배포마다
-- 이관 파일 전부를 다시 돌므로, 전처럼 맨 위에 두면 사람이 설정에서 비운 문구를
-- 다음 배포가 되살린다. 열이 이미 있으면 그 값은 사람이 정한 것이다.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'org_brand'
                    and column_name = 'company_tagline') then
    alter table org_brand add column company_tagline text;

    update org_brand
       set company_tagline = 'REGENERATIVE HEALTHCARE PLATFORM'
     where company_tagline is null;
  end if;
end $$;
