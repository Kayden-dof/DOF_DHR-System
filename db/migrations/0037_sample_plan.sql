/* ---------------------------------------------------------------------------
   완제품검사 시료 채취 기준

   0036 에서 "제조번호당 몇 개"를 device_master 에 숫자 하나로 받았다. 그건
   틀렸다 (사용자 지적). 40 개 나온 로트와 200 개 나온 로트에서 같은 수를 뽑을
   이유가 없고, 무엇보다 그 숫자가 왜 그 숫자인지를 설명하는 근거가 어디에도
   없었다.

   시료 채취는 로트 크기 구간별로 정해지는 표를 따른다. 이 스키마에는 이미 같은
   모양이 있다 - dmr_bom_tier 의 SHEET_TIER 가 "장입 장수 구간별 고정량"이다.
   시료도 "생산 수량 구간별 고정 수"이므로 같은 구조를 쓴다.

   ── 근거를 함께 받는다 ────────────────────────────────────────────────────
   §6 의 min_stock_basis 가 세운 선례를 따른다. "근거 없는 숫자는 아무도 믿지
   않는다." 어느 검사기준서 몇 항의 표를 옮겼는지를 문장으로 받아 화면과 종이에
   함께 내보낸다. 숫자만 있으면 검토자가 그 숫자를 확인할 방법이 없다.

   ── 시스템은 정하지 않는다 ────────────────────────────────────────────────
   구간도 수량도 검사기준서가 정하고, 여기서는 옮겨 적은 값을 읽어 줄 뿐이다
   (§1). 등록된 구간이 없으면 현장에 아무것도 안내하지 않는다. 안내하지 않는
   것이 잘못된 수를 안내하는 것보다 낫다 (§8.5 와 같은 이유다).

   실제로 뽑은 수는 작업자가 적은 값 그대로 기록된다. 표와 다르면 다르다는
   사실만 표시하고 막지 않는다. 차단은 S01~S05 뿐이다 (§2).
--------------------------------------------------------------------------- */

create table if not exists sample_plan (
  id               uuid primary key default gen_random_uuid(),
  device_master_id uuid not null references device_master(id),
  min_qty          int  not null check (min_qty > 0),
  max_qty          int,                                  -- null 이면 상한 없음
  sample_qty       int  not null check (sample_qty >= 0),
  registered_by    uuid not null references app_user(id),
  registered_at    timestamptz not null default now(),
  check (max_qty is null or max_qty >= min_qty),
  unique (device_master_id, min_qty)
);
create index if not exists sample_plan_dm on sample_plan (device_master_id, min_qty);

comment on table sample_plan is
  '완제품검사 시료 채취 기준. 생산 수량 구간별 시료 수. 검사기준서에서 옮겨 적는다';

/* 어느 검사기준서의 어느 표를 옮겼는지. 숫자만으로는 확인할 방법이 없다 */
alter table device_master
  add column if not exists sample_basis text;

comment on column device_master.sample_basis is
  '시료 채취 기준의 근거 문구. 예 "검사기준서 QC-DX2401-01 표3"';

/* --- 0036 의 고정 숫자를 구간 하나로 옮기고 그 열을 내린다 ----------------
   자료가 두 곳에 있으면 반드시 어긋난다. 옮겨 둔 뒤 원래 열은 지운다.
   기록이 아니라 기준정보의 형태를 바로잡는 것이므로 §10 의 "기록은 삭제되지
   않는다"에 닿지 않는다. 이 열로 만들어진 기록도 아직 없다.
-------------------------------------------------------------------------- */
do $$
declare r record;
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'device_master' and column_name = 'sample_per_lot') then
    for r in execute
      'select id, sample_per_lot from device_master where sample_per_lot is not null'
    loop
      insert into sample_plan (device_master_id, min_qty, max_qty, sample_qty, registered_by)
      select r.id, 1, null, r.sample_per_lot,
             coalesce((select id from app_user where is_developer order by login_code limit 1),
                      (select id from app_user order by login_code limit 1))
      on conflict (device_master_id, min_qty) do nothing;
    end loop;
    execute 'alter table device_master drop column sample_per_lot';
  end if;
end $$;

/* --- 구간 판정 -----------------------------------------------------------
   생산 수량이 어느 구간에 드는지 본다. 드는 구간이 없으면 null 을 돌려주고
   화면은 아무것도 안내하지 않는다. required_qty() 와 같은 모양이다.
-------------------------------------------------------------------------- */
create or replace function required_sample(p_dm uuid, p_qty int)
returns int language sql stable as $$
  select sample_qty
    from sample_plan
   where device_master_id = p_dm
     and p_qty >= min_qty
     and (max_qty is null or p_qty <= max_qty)
   order by min_qty desc            -- 겹쳐 있어도 답이 하나로 정해진다
   limit 1
$$;

grant execute on function required_sample(uuid, int) to app_role;

grant select, insert, update on sample_plan to app_role;
revoke delete on sample_plan from app_role;

/*
 * 개발 부팅 때 이 사슬이 처음부터 다시 흐른다. create trigger 는 두 번째부터
 * 넘어지므로 먼저 내리고 건다. 결과는 늘 마지막에 건 것 하나다.
 */
drop trigger if exists sample_plan_audit on sample_plan;
create trigger sample_plan_audit after insert or update
  on sample_plan for each row execute function trg_audit();
