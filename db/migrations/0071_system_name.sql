/* ---------------------------------------------------------------------------
   시스템 이름도 설정에서 (M5-2 이어서 · §2.0)

   머리줄의 `DHR` 과 로그인 화면의 `Device History Record` · `제조기록 지원
   시스템` 이 코드에 박혀 있었다. 회사 이름과 색은 설정으로 옮겼는데 이것들이
   남아 있으면, 다른 제조소가 받아 자기 이름을 넣어도 옆에 남의 제품 이름이
   붙어 있다 (사용자 지적 2026-09-01).

   ── 짧은 이름과 긴 이름 ───────────────────────────────────────────────────
   머리줄은 좁아 짧은 이름이 들어가고, 로그인 화면은 그것을 풀어 쓴다.
   줄임말은 아는 사람에게만 이름이라, 첫 화면에서는 풀어 주는 것이 맞다.

   비우면 그 자리는 아무것도 그리지 않는다. 지어내지 않는다.
--------------------------------------------------------------------------- */

alter table org_brand add column if not exists system_name       text;
alter table org_brand add column if not exists system_name_long  text;
alter table org_brand add column if not exists system_tagline    text;

comment on column org_brand.system_name is
  '머리줄에 붙는 짧은 이름 (DHR)';
comment on column org_brand.system_name_long is
  '로그인 화면에 풀어 쓰는 이름 (Device History Record)';
comment on column org_brand.system_tagline is
  '그 아래 한 줄 (제조기록 지원 시스템)';

/*
 * 지금 화면에 나오는 값을 그대로 옮긴다.
 *
 * where 절이 없으면 배포마다 이 줄이 다시 쓰인다. 값은 그대로인데 감사
 * 트리거는 UPDATE 를 잡으므로, 감사추적에 "이관 계정이 회사 표시를 바꿨다" 가
 * 배포 횟수만큼 쌓인다 - 아무도 바꾸지 않았는데 바꿨다고 적힌다.
 *
 * 감사추적이 답해야 하는 것은 "무엇이 언제 누구에 의해 바뀌었는가" 다 (§1).
 * 바뀌지 않은 것을 적으면 그 대장을 읽는 사람이 진짜 변경을 찾지 못한다.
 *
 * 채울 것이 있을 때만 쓴다.
 */
update org_brand
   set system_name      = coalesce(system_name, 'DHR'),
       system_name_long = coalesce(system_name_long, 'Device History Record'),
       system_tagline   = coalesce(system_tagline, '제조기록 지원 시스템')
 where system_name is null
    or system_name_long is null
    or system_tagline is null;
