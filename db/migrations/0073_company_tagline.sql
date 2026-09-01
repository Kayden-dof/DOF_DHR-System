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
-- ---------------------------------------------------------------------------

alter table org_brand add column if not exists company_tagline text;

update org_brand
   set company_tagline = 'REGENERATIVE HEALTHCARE PLATFORM'
 where company_tagline is null;
