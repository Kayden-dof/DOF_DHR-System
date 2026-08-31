/* ---------------------------------------------------------------------------
   일탈 대장에도 "아직 오지 않은 날"을 막는다 (4차 검수 · 자기 검수)

   0064 는 날짜에 하한만 걸었다 — 승인일과 종결일이 발생일보다 앞설 수 없다.
   상한이 없어 **미래 날짜가 그대로 들어간다.** 다음 달에 일어난 일탈, 내년에
   승인된 종결이 대장에 적힌다.

   0052 가 공정 기록에 이미 같은 것을 걸어 두었다.

     "작업일이 아직 오지 않은 날입니다"

   같은 성격인데 새 표에만 빠졌다. 새로 만든 표가 기존 규칙을 물려받지 않는
   것은 흔한 자리다.

   ── 이것이 §1 의 "차단은 다섯 개뿐"을 늘리는가 ────────────────────────────
   아니다. 일탈이 중대한지 사소한지, 조치가 타당한지 묻지 않는다. 묻는 것은
   하나다 — **아직 오지 않은 날을 적고 있는가.** §2.1 의 구조적 불변식이고,
   공정 기록의 작업일과 같은 층이다.

   ── 왜 CHECK 가 아니라 트리거인가 ─────────────────────────────────────────
   CHECK 는 immutable 표현식만 받는다. "오늘"은 부를 때마다 달라지므로 CHECK 에
   넣을 수 없다. 시간대도 KST 로 봐야 한다 — UTC 로 보면 한국 시각 오전 9시
   이전에 오늘 날짜가 어제로 읽혀, 오늘 일어난 일탈이 거부된다.
--------------------------------------------------------------------------- */

create or replace function trg_deviation_dates()
returns trigger language plpgsql as $fn$
declare v_today date := (timezone('Asia/Seoul', now()))::date;
begin
  if new.occurred_on > v_today then
    raise exception '발생일이 아직 오지 않은 날입니다 (%)', new.occurred_on;
  end if;
  if new.approved_on is not null and new.approved_on > v_today then
    raise exception '승인일이 아직 오지 않은 날입니다 (%)', new.approved_on;
  end if;
  if new.closed_on is not null and new.closed_on > v_today then
    raise exception '종결일이 아직 오지 않은 날입니다 (%)', new.closed_on;
  end if;
  return new;
end $fn$;

drop trigger if exists deviation_dates on deviation;
create trigger deviation_dates before insert or update
  of occurred_on, approved_on, closed_on
  on deviation for each row execute function trg_deviation_dates();
