/* ---------------------------------------------------------------------------
   회사 표시 — 이름 · 색 · 로고 (M5-2 · §2.0)

   회사 이름이 화면 세 곳에 `DOF Inc.` 로, 로고는 컴포넌트 안에 벡터 좌표로,
   강조색은 `globals.css` 에 `#562C8D` 로 박혀 있었다. 다른 제조소가 이 프로그램을
   받으면 세 곳을 고쳐 다시 빌드해야 한다. §2.0 이 금지한 모양이다.

   ── 한 줄짜리 표다 ────────────────────────────────────────────────────────
   단일 조직이므로 (§4) 회사도 하나다. `org_id` 를 두지 않는다. 표는 한 줄만
   가질 수 있게 못을 박고, 그 줄을 고쳐 쓴다.

   **키는 uuid 여야 한다.** 처음에 boolean 으로 두었더니 감사추적 트리거가
   터졌다 — `trg_audit` 은 모든 감사 대상 표에 uuid `id` 가 있다고 보고
   `(to_jsonb(new)->>'id')::uuid` 로 읽는다 (0002). 한 줄만 갖게 하는 일은
   고정값 CHECK 로 한다.

   ── 로고는 담는다 ─────────────────────────────────────────────────────────
   §2.2 의 기준으로 담아도 되는 쪽이다 — 밖으로 나가도 회사가 영향을 받지 않는다.
   제조기록·성적서는 여전히 담지 않고 번호로 가리킨다.

   **어디에 담는가는 DB 다.** Vercel 의 파일 체계는 배포마다 사라져 디스크에
   두면 다음 배포에 로고가 없어진다. 그림 한 장이라 크지 않고, 백업에 함께
   들어가 복구하면 로고도 같이 돌아온다.

   ── 색은 하나만 받는다 ────────────────────────────────────────────────────
   강조색 하나만 받고 나머지 여섯 단계는 거기서 만든다. 자유롭게 열면 대비가
   무너져 현장에서 글자가 안 보인다. 파생은 한 곳에서만 한다 (lib/brand.ts).

   ── 지금 값을 그대로 옮긴다 ───────────────────────────────────────────────
   회사 이름과 색은 지금 화면에 나오는 값을 찍는다. 옮기면서 화면이 바뀌면 안
   된다. 로고는 비워 둔다 - 비어 있으면 이름을 글자로 낸다.
--------------------------------------------------------------------------- */

create table if not exists org_brand (
  /* 한 줄만. 키가 uuid 인 이유는 위 주석 참고 */
  id            uuid primary key default '00000000-0000-0000-0000-000000000b01'
                check (id = '00000000-0000-0000-0000-000000000b01'),
  company_name  text not null,
  brand_color   text not null default '#562C8D'
                check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_mime     text check (logo_mime in ('image/svg+xml', 'image/png')),
  logo_bytes    bytea,
  logo_name     text,
  updated_by    uuid references app_user(id),
  updated_at    timestamptz not null default now(),
  /* 그림이 있으면 형식도 있어야 한다. 둘 중 하나만 있으면 그릴 수 없다 */
  check ((logo_bytes is null) = (logo_mime is null)),
  /* 512 KB. 화면과 종이에 나오는 표시일 뿐 자료가 아니다 */
  check (logo_bytes is null or octet_length(logo_bytes) <= 524288)
);

comment on table org_brand is
  '회사 표시. 이름 · 강조색 · 로고. 단일 조직이라 한 줄만 갖는다 (§4)';
comment on column org_brand.brand_color is
  '강조색 하나. 나머지 단계는 lib/brand.ts 가 여기서 만든다 - 두 곳에서 만들면 갈라진다';

/* 지금 화면에 나오는 값을 그대로 옮긴다 */
insert into org_brand (company_name, brand_color)
values ('DOF Inc.', '#562C8D')
on conflict (id) do nothing;

grant select on org_brand to app_role, app_readonly;
grant update on org_brand to app_role;
revoke delete on org_brand from app_role;

drop trigger if exists org_brand_audit on org_brand;
create trigger org_brand_audit after insert or update
  on org_brand for each row execute function trg_audit();

/*
 * 로고 바이트는 감사추적에 담지 않는다. 감사추적이 답해야 하는 것은 "무엇이
 * 언제 누구에 의해 바뀌었는가" 이지 그 그림이 아니다 (§1 · 0060). 그림을 담으면
 * 감사추적이 그림 보관소가 되고, 바꿀 때마다 한 벌씩 쌓인다.
 */
create or replace function audit_secret_columns(p_table text)
returns text[] language sql immutable as $fn$
  select case p_table
    when 'app_user'  then array['pin_hash']
    when 'org_brand' then array['logo_bytes']
    else array[]::text[]
  end
$fn$;

drop trigger if exists org_brand_no_delete on org_brand;
create trigger org_brand_no_delete before delete on org_brand
  for each row execute function trg_block_delete();
