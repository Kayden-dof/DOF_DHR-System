-- ---------------------------------------------------------------------------
-- 화면의 낱말이 제품에서 나온다 (사용자 지시 2026-09-07)
--
-- "DX2401 에 맞춰 작성된 문구를 전수로 고칠 것. 이 프로그램은 의료기기 전
-- 제품을 범위로 둔다."
--
-- 전수로 훑어 보니 세 갈래였다.
--
--   ① 예시 문구   placeholder 와 defaultValue 가 DOF 의 품목을 예로 들었다.
--                 특히 공정 흐름 예시는 **defaultValue 라 그대로 제출됐다** -
--                 다른 제조소가 이 회사 공정을 자기 제품표준서로 등록하게 된다.
--                 (화면에서 고쳤다)
--   ② 분기 공정   "재단 이전 / 재단 이후" 가 87곳에 박혀 있다. 재단은 DX2401 의
--                 공정 이름이지 프로그램의 낱말이 아니다. 분기가 없는 품목이면
--                 그 말 자체가 뜻이 없다 (§12).
--   ③ 투입 단위   "장입 20장" 의 `장` 이 박혀 있다. 액상이면 L, 분말이면 kg 다.
--
-- ②와 ③을 여기서 연다.
--
-- ── ② 분기 공정의 이름은 이미 자료에 있다 ───────────────────────────────
-- 제품표준서에 또 적게 하지 않는다. 분기 공정은 **`after_cutting` 이 false 인
-- 마지막 공정**이고 (그 뒤부터 기록이 제품 로트에 붙는다), 그 이름을 물으면
-- 된다. 같은 것을 두 곳에 적으면 갈라진다 (§10).
--
-- 분기가 없는 품목이면 null 을 낸다. 그때 화면은 그 말을 아예 쓰지 않는다.
--
-- ── ③ 투입 단위는 제품이 정한다 ─────────────────────────────────────────
-- 기본값을 두지 않는다. `장` 은 이 제조소의 값이지 프로그램의 성질이 아니다
-- (§2.0). 비어 있으면 화면은 숫자만 보여 준다 - 지어낸 단위를 붙이는 것보다
-- 낫다.
-- ---------------------------------------------------------------------------

-- === ② 분기 공정의 이름 ====================================================

create or replace function split_op_name(p_dm uuid)
returns text language sql stable
set search_path = pg_catalog, public, pg_temp as $fn$
  /*
   * 분기 공정 = 재단 이전 공정 중 마지막 것. 그 다음 공정부터 기록이 제품
   * 로트에 붙는다 (§3 · dmr_operation.after_cutting).
   *
   * 뒤에 after_cutting 공정이 하나도 없으면 분기가 없는 품목이다. 그때는
   * null 이고, 화면은 "…이후" 라는 말을 쓰지 않는다.
   */
  select o.name
    from dmr_operation o
   where o.device_master_id = p_dm
     and not o.after_cutting
     and exists (select 1 from dmr_operation a
                  where a.device_master_id = p_dm and a.after_cutting)
   order by o.seq desc
   limit 1
$fn$;

comment on function split_op_name(uuid) is
  '분기 공정의 이름. 재단 이전 공정 중 마지막 것. 분기가 없으면 null';

grant execute on function split_op_name(uuid) to app_role, app_readonly;


-- === ③ 투입 단위 ===========================================================

alter table device_master add column if not exists load_unit text;

comment on column device_master.load_unit is
  '장입 수량의 단위. 장 · L · kg 등. 비면 화면이 숫자만 보여 준다. 기본값을 두지 않는다 (§2.0)';

/*
 * 기존 행에 값을 넣지 않는다.
 *
 * `장` 을 채워 두면 그것이 곧 프로그램의 기본값이 되고, 다음 제조소가 액상
 * 제품을 올려도 `장` 으로 서 있게 된다. 이관이 where 없이 기준정보를 건드리면
 * 감사추적도 더러워진다 (§10). 화면에서 받는다.
 */
