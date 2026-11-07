/* ===========================================================================
   0123 · 작업표준서 · 제조기록서 등록과 대조 (사용자 요청 2026-11-07)

   "돼지 진피 작업표준서 · 제조기록서를 입력하되, 둘의 정합성이 어긋나는 것은
   빨간색으로 표기해 프린트 아웃할 수 있게."

   ── 무엇을 담는가 ─────────────────────────────────────────────────────────
     mfg_doc    서면 문서 한 장 한 장. 문서번호 · 제목 · 개정 · 제정일 · 쪽수
     mfg_check  공정마다 항목 한 줄. 작업표준서의 기재와 제조기록서의 기재를
                나란히 두고 판정(일치 · 불일치 · 기재 누락 · 기준 미정 ·
                기록서에만)을 붙인다

   ── 제품표준서(device_master)에 매달지 않는 까닭 ───────────────────────────
   공정 · 자재 구성표를 세우는 제품표준서는 서면과 대조 확인을 거쳐야 하는
   별도 절차다 (실무 착수 ④). 문서 대조는 그 전에도 필요하고, 그 결과가
   제품표준서를 세우는 입력이 된다. 그래서 제품 코드(DX2401)와 공정 코드
   (WS-DX2401-01)를 글자로 들고, 제품표준서가 서면 그때 코드로 맞춘다.

   ── 판정은 사람이 한 대조의 기록이다 ──────────────────────────────────────
   시스템이 두 글을 견주어 판정하지 않는다. 사람이 두 문서를 맞대어 본 결과를
   옮겨 적는다 - 이 시스템은 판정성 문구를 스스로 만들지 않는다 (§10).
   근거(대조 문서 번호)를 줄마다 남긴다.

   ── 지우지 않는다 ──────────────────────────────────────────────────────────
   다른 기준정보와 같다. 고친 것은 감사추적에 이전 값과 함께 남는다.
   개정이 나오면 새 개정의 줄을 더하고, 옛 개정의 줄은 is_current 를 내린다.
=========================================================================== */

create table if not exists mfg_doc (
  id            uuid primary key default gen_random_uuid(),
  product_code  text not null,                       -- DX2401
  op_code       text,                                -- WS-DX2401-01. 제품 전체 문서면 비움
  kind          text not null check (kind in ('WS','BR')),   -- 작업표준서 · 제조기록서
  doc_no        text not null,                       -- WS-DX2401-01 · F706-DX2401-01
  title         text not null,
  revision      text not null,                       -- Rev.00
  issued_on     date,                                -- 본문 제정일자
  pages         int check (pages > 0),
  note          text,
  is_current    boolean not null default true,
  registered_by uuid not null references app_user(id),
  registered_at timestamptz not null default now(),
  unique (product_code, doc_no, revision)
);
comment on table mfg_doc is
  '서면 작업표준서 · 제조기록서 등록부. 문서 대조(mfg_check)의 대상 (0123)';
create index if not exists mfg_doc_product on mfg_doc (product_code, op_code);

create table if not exists mfg_check (
  id            uuid primary key default gen_random_uuid(),
  product_code  text not null,
  op_code       text not null,                       -- WS-DX2401-01
  op_name       text not null,                       -- NaCl 처리 및 세척
  seq           int  not null check (seq > 0),
  grp           text not null default '',            -- 준비 · 작업 · 공정검사 · 투입자재 · 설비 · 시약 제조 · 기록 · 문서
  item          text not null,                       -- 관리항목
  ws_text       text not null default '',            -- 작업표준서 기재
  ws_at         text not null default '',            -- 작업표준서 위치
  br_text       text not null default '',            -- 제조기록서 기재
  br_at         text not null default '',            -- 제조기록서 위치
  verdict       text not null check (verdict in ('MATCH','MISMATCH','MISSING','UNDEFINED','BR_ONLY','FLOW')),
  why           text not null default '',
  /*
   * 두 문서에서 이 항목이 놓인 차례 (위에서 아래로 1, 2, 3 …).
   * 제조기록서가 작업 순서를 따라 적히는지는 이 둘을 견주어 본다 - 작업표준서
   * 차례로 늘어놓았을 때 제조기록서 차례가 거꾸로 가는 줄이 흐름이 끊긴 자리다.
   */
  ws_order      int check (ws_order > 0),
  br_order      int check (br_order > 0),
  basis         text not null default '',            -- 근거. 대조 문서 번호 · 항목
  is_current    boolean not null default true,
  registered_by uuid not null references app_user(id),
  registered_at timestamptz not null default now(),
  check (ws_text <> '' or br_text <> ''),
  check (verdict = 'MATCH' or why <> '')
);
comment on table mfg_check is
  '작업표준서 · 제조기록서 항목 대조. 사람이 맞대어 본 결과와 그 근거 (0123)';
create unique index if not exists mfg_check_seq
  on mfg_check (product_code, op_code, seq) where is_current;
create index if not exists mfg_check_product on mfg_check (product_code, op_code, seq);

/* ---------------------------------------------------------------------------
   개정 제안 (사용자 요청 2026-11-07)

   "제조기록서와 작업표준서 개정 제안도 버튼으로 요청할 수 있도록."

   문서를 고치는 것은 품질이 QMS 문서관리 절차로 한다. 이 시스템은 그 절차의
   **입력**을 만든다 - 무엇을, 왜, 어떻게 바꾸자는지를 한 건씩 적고, 모아서
   제안서로 뽑아 품질에 넘긴다. 받은 쪽의 처리 결과는 상태로 적는다.

     OPEN     적어 둠 (아직 넘기지 않음)
     SENT     품질에 넘김
     DONE     개정에 반영됨
     DROPPED  반영하지 않기로 함

   대조표의 한 줄에서 낼 수도 있고(check_id), 문서 전체에 대해 낼 수도 있다
   (흐름 · 순서를 다시 짜는 것처럼 한 줄에 매이지 않는 제안).
--------------------------------------------------------------------------- */
create table if not exists mfg_revision_request (
  id            uuid primary key default gen_random_uuid(),
  req_no        text not null unique,                -- RR-DX2401-001
  product_code  text not null,
  op_code       text,
  check_id      uuid references mfg_check(id),
  target        text not null check (target in ('WS','BR','BOTH')),
  doc_nos       text not null,                       -- 대상 문서번호 (여럿이면 쉼표)
  kind          text not null check (kind in ('VALUE','FIELD','FLOW','CRITERIA','DOC','OTHER')),
  current_text  text not null default '',            -- 지금 적힌 것
  proposed_text text not null,                       -- 이렇게 바꾸자
  reason        text not null,                       -- 왜
  status        text not null default 'OPEN' check (status in ('OPEN','SENT','DONE','DROPPED')),
  status_note   text not null default '',
  requested_by  uuid not null references app_user(id),
  requested_at  timestamptz not null default now(),
  status_at     timestamptz
);
comment on table mfg_revision_request is
  '작업표준서 · 제조기록서 개정 제안. 품질의 문서관리 절차에 넘기는 입력 (0123)';
create index if not exists mfg_revision_request_product
  on mfg_revision_request (product_code, status, requested_at);

/* 제안 번호. 제품마다 001 부터, 지운 번호를 다시 쓰지 않는다 (지우지 않으므로 빈자리도 없다) */
create or replace function next_revision_request_no(p_product text)
returns text language sql volatile
set search_path = pg_catalog, public, pg_temp as $$
  select format('RR-%s-%s', p_product, lpad((count(*) + 1)::text, 3, '0'))
    from mfg_revision_request where product_code = p_product
$$;
grant execute on function next_revision_request_no(text) to app_role;

do $$
declare t text;
begin
  foreach t in array array['mfg_doc','mfg_check','mfg_revision_request'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update on %I
                      for each row execute function trg_audit()', t || '_audit', t);
    execute format('drop trigger if exists %I on %I', t || '_no_delete', t);
    execute format('create trigger %I before delete on %I
                      for each row execute function trg_block_delete()', t || '_no_delete', t);
    execute format('drop trigger if exists %I on %I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on %I
                      for each statement execute function trg_block_delete()', t || '_no_truncate', t);
  end loop;
end $$;

grant select, insert, update on mfg_doc, mfg_check, mfg_revision_request to app_role;
grant select on mfg_doc, mfg_check, mfg_revision_request to app_readonly;
revoke delete, truncate on mfg_doc, mfg_check, mfg_revision_request from app_role;
