/* ---------------------------------------------------------------------------
   규격 표기 — 크기는 cm 그대로, 두께만 mm 로 환산 (3차 검수 결함 1)

   형명은 PD + 가로2 + 세로2 + 두께하한2 + 두께상한2 다 (§4.2). 여기서 앞 네
   자리와 뒤 네 자리는 단위가 다르다.

     크기 자리  숫자가 곧 cm 다.   '10' → 10cm,  '05' → 5cm
     두께 자리  10배한 mm 다.      '05' → 0.5mm, '10' → 1.0mm

   품목 등록 화면이 스스로 그렇게 안내한다 - "5x5 는 0505", "0.5~1.0mm 는 0510".
   §4.2 가 든 제외 조합 "10×15, 10×18, 12×15 의 2.5~3mm" 도 크기가 cm 임을
   전제한다. 사용자도 확정해 주었다 (2026-08-31).

   그런데 이름을 만드는 곳도 인쇄하는 곳도 네 자리 전부에 mm_label 을 걸어
   10배 작게 적고 있었다.

     PD10150510   지금 → "DX2401 1.0x1.5 0.5~1.0mm"
                  맞는 값 → "DX2401 10x15cm 0.5~1.0mm"

   ── 왜 중대한가 ───────────────────────────────────────────────────────────
   이 값이 라벨요청서에 실려 라벨 업체로 가고, 출하 승인 요청서에 실려
   품질책임자 서명 위에 놓인다. 둘 다 정본이다. 이종 진피 이식재의 규격이
   10배 작게 인쇄되어 라벨로 붙으면 표시 · 기재 사항 위반이고, 붙은 라벨은
   회수 말고 되돌릴 방법이 없다.

   §8.2 가 "이 시스템에서 가장 중요한 검증" 이라고 못박은 자리다.

   ── 코드는 건드리지 않는다 ────────────────────────────────────────────────
   item.code 는 그대로다. 계보도 제조번호도 코드로 이어지므로 이름만 고치면
   된다. 이름은 사람이 읽는 표시일 뿐이고, 지금 값이 틀렸으므로 고치는 것이
   기록 변조가 아니라 오기 정정이다.
--------------------------------------------------------------------------- */


/* === 1. 크기 표기 함수 ================================================== */
/*
 * mm_label 과 나란히 둔다. 이름이 단위를 말하게 해서 다음 사람이 헷갈리지
 * 않게 한다 - 이 결함이 정확히 그 헷갈림에서 나왔다.
 */
create or replace function cm_label(p text) returns text
language sql immutable as $fn$
  select (p::int)::text
$fn$;

comment on function cm_label(text) is
  '형명의 크기 두 자리를 cm 로. 숫자가 곧 cm 다 - 05 는 5, 10 은 10';
comment on function mm_label(text) is
  '형명의 두께 두 자리를 mm 로. 10배한 값이다 - 05 는 0.5, 10 은 1.0';


/* === 2. 이름을 만들 때 크기와 두께를 갈라 쓴다 ========================== */
create or replace function generate_finished_items(
  p_sizes          text[],
  p_bands          text[],
  p_exclude        text[] default '{}',
  p_name_prefix    text   default 'DX2401',
  p_shelf_months   int    default 12
) returns table (item_code text, item_name text, was_created boolean)
language plpgsql as $fn$
declare
  s text; b text; suffix text; v_code text; v_name text; v_new boolean;
begin
  foreach s in array p_sizes loop
    if s !~ '^[0-9]{4}$' then
      raise exception '크기는 숫자 4자리여야 합니다 (가로2+세로2): %', s;
    end if;
    foreach b in array p_bands loop
      if b !~ '^[0-9]{4}$' then
        raise exception '두께 구간은 숫자 4자리여야 합니다 (하한2+상한2): %', b;
      end if;

      suffix := s || b;
      continue when suffix = any (p_exclude);

      v_code := 'PD' || suffix;
      /* 크기는 cm 그대로, 두께만 mm 로. 0057 이전에는 넷 다 10 으로 나눴다 */
      v_name := format('%s %sx%scm %s~%smm',
                  p_name_prefix,
                  cm_label(substr(s,1,2)), cm_label(substr(s,3,2)),
                  mm_label(substr(b,1,2)), mm_label(substr(b,3,2)));

      insert into item (code, name, type, purchase_uom, usage_uom,
                        shelf_life_months, is_active)
      values (v_code, v_name, 'FIN', 'EA', 'EA', p_shelf_months, true)
      on conflict (code) do nothing;

      v_new := found;
      item_code := v_code; item_name := v_name; was_created := v_new;
      return next;
    end loop;
  end loop;
end $fn$;


/* === 3. 종이와 화면이 같은 규칙을 쓰게 한다 ============================= */
/*
 * 인쇄 페이지 두 곳이 각자 같은 함수를 복제해 두고 있었다. 복제는 언젠가
 * 갈라진다 - 실제로 한쪽은 "1.0 x 1.5 cm", 다른 쪽은 "1.0x1.5cm" 로 이미
 * 갈라져 있었다. 규격 문구를 DB 에 한 번만 두고 응용은 그것을 읽는다.
 */
create or replace function spec_label(p_code text) returns text
language sql immutable as $fn$
  select case
    when p_code ~ '^PD[0-9]{8}$' then
      format('%sx%scm · 두께 %s~%smm',
        cm_label(substr(p_code, 3, 2)), cm_label(substr(p_code, 5, 2)),
        mm_label(substr(p_code, 7, 2)), mm_label(substr(p_code, 9, 2)))
    else ''
  end
$fn$;

comment on function spec_label(text) is
  '형명을 사람이 읽는 규격으로. 인쇄물과 화면이 이 하나만 쓴다';


/* === 4. 이미 등록된 이름을 고친다 ======================================= */
/*
 * 코드는 그대로 두고 이름만 다시 만든다. 오기 정정이므로 감사추적에 남는다.
 * 이름을 손으로 바꾼 품목이 있으면 덮어쓰지 않도록, 지금 이름이 옛 규칙으로
 * 만든 모양일 때만 고친다.
 */
do $$
declare n int;
begin
  update item i
     set name = format('%s %sx%scm %s~%smm',
           split_part(i.name, ' ', 1),
           cm_label(substr(i.code, 3, 2)), cm_label(substr(i.code, 5, 2)),
           mm_label(substr(i.code, 7, 2)), mm_label(substr(i.code, 9, 2)))
   where i.type = 'FIN'
     and i.code ~ '^PD[0-9]{8}$'
     /* 옛 규칙으로 만든 이름만. 'DX2401 0.5x0.5 0.5~1.0mm' 모양 */
     and i.name ~ '^\S+ [0-9]+\.[0-9]x[0-9]+\.[0-9] ';

  get diagnostics n = row_count;
  if n > 0 then
    raise notice '완제품 이름 %건을 크기 cm 표기로 고쳤습니다', n;
  end if;
end $$;
