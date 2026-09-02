-- ---------------------------------------------------------------------------
-- 규격을 못 만들면 그 사실을 말한다 (5차 감사 C2)
--
-- `spec_label('XX99999999')` 이 빈 문자열을 냈다. 라벨요청서의 규격 칸이 그
-- 값을 그대로 놓으므로 **빈 칸이 인쇄되고 아무 표시도 없었다.**
--
-- 인쇄 시험도 잡지 않는다 - 값이 비면 대조하지 않고 건너뛴다. 자료가 비었으니
-- 종이도 비는 것이 "일치" 이기 때문이다. 시험은 충실성을 묻지 완결성을 묻지
-- 않으므로 맞는 설계다. 그래서 이 자리는 종이가 말해야 한다.
--
-- **규격은 라벨 업체가 이 종이를 보고 찍는 값이다.** 한때 두 인쇄 페이지가
-- 각자 환산해 10배 작은 치수가 나갔고(§7), 그래서 만드는 자리를 여기 하나로
-- 모았다. 비는 경우도 같은 자리에서 답해야 한다 - 페이지마다 "없으면 뭐라고
-- 쓸까" 를 따로 정하면 그때처럼 갈라진다 (§10 복제는 갈라진다).
--
-- ── 판정이 아니다 ──────────────────────────────────────────────────────
-- 적합·부적합을 말하지 않는다. **왜 이 칸이 비었는지**를 사실로 적을 뿐이다
-- (§8.5 "사실만 제시한다"). 인쇄를 막지도 않는다.
--
-- 말하는 대상은 완제품뿐이다. 자재 코드에는 이런 뜻의 규격이 없고 없는 것이
-- 정상이므로 빈 문자열 그대로 둔다 (시험 MS-03).
-- ---------------------------------------------------------------------------

create or replace function spec_label(p_code text)
returns text
language plpgsql stable
set search_path = pg_catalog, public, pg_temp as $fn$
declare p record; out_ text;
begin
  select s.spec_pattern into out_
    from model_scheme s
   where s.is_active
     and left(p_code, length(s.prefix)) = s.prefix
     and exists (select 1 from model_parts(p_code))
   order by length(s.prefix) desc limit 1;

  /*
   * 못 만들었을 때 말하는 대상은 **완제품뿐**이다.
   *
   * 자재 코드(RM-006 · NT-0001)에는 이런 뜻의 규격이 없고, 없는 것이 정상이다.
   * 거기까지 문구를 내면 "형명이 아닌 코드에는 규격 문구를 지어내지 않는다"
   * 를 어긴다 (시험 MS-03). 빈 문자열 그대로 둔다.
   *
   * 완제품인데 못 만드는 것은 다르다. 그 칸은 라벨 업체가 보고 찍는 자리라
   * 비면 안 된다. 둘을 가른다 - 체계가 아직 하나도 없는 것과, 체계는 있는데
   * 이 코드가 어느 것에도 안 맞는 것은 손쓸 자리가 다르다. 앞은 설정 ·
   * 형명 체계로, 뒤는 그 품목 코드로 간다.
   */
  if out_ is null then
    if not exists (select 1 from item where code = p_code and type = 'FIN') then
      return '';
    end if;
    if not exists (select 1 from model_scheme where is_active) then
      return '(형명 체계 미등록)';
    end if;
    return '(형명 체계에 없는 코드)';
  end if;

  for p in select * from model_parts(p_code) loop
    out_ := replace(out_, '{' || p.seq || '}', p.shown);
  end loop;
  return out_;
end $fn$;

comment on function spec_label(text) is
  '형명에서 규격 문구를 만든다. 만들 수 없으면 왜 못 만드는지 적는다 - '
  '빈 칸이 종이에 나가면 아무도 모른다 (5차 감사 C2)';
