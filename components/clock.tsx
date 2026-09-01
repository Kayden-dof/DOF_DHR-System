'use client';

import { useEffect, useState } from 'react';

/* ---------------------------------------------------------------------------
   지금 몇 시인가 (사용자 요청 2026-09-01)

   현장에서 공정을 시작하고 끝낼 때 시각을 적는다. 그 시각이 종이에 남고
   제조기록서에 그대로 찍힌다. 화면에 시계가 있으면 손목을 보지 않아도 되고,
   무엇보다 **화면이 말하는 시각과 기록에 남는 시각이 같아진다.**

   ── 반드시 한국 시각이다 ──────────────────────────────────────────────────
   기기 시간대를 따라가면 안 된다. 패드의 시간대가 어긋나 있으면 화면은 그
   시각을 보여 주는데 기록은 서버의 한국 시각으로 남아, 두 값이 갈린다.
   시간대를 Asia/Seoul 로 못 박는다 (§10 · lib/kst.ts 와 같은 규율).

   ── 첫 그림은 비워 둔다 ───────────────────────────────────────────────────
   서버가 그린 시각과 브라우저가 그린 시각은 다를 수밖에 없다. 그대로 두면
   하이드레이션에서 어긋났다고 경고가 나고, 그 경고는 진짜 문제를 덮는다.
   붙은 뒤에 채운다 - 자리는 미리 잡아 두어 글자가 들어올 때 옆이 밀리지 않는다.
--------------------------------------------------------------------------- */

const KST = 'Asia/Seoul';

const dateFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: KST, month: 'long', day: 'numeric', weekday: 'short',
});

/* 24시간 표기. 오전 · 오후를 붙이면 기록지의 시각 칸과 모양이 달라진다 */
const timeFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: KST, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

export default function Clock({ withDate = false, className = '' }: {
  /** 날짜도 함께 낸다. 현장 머리줄처럼 하루를 통째로 두는 자리에 쓴다 */
  withDate?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    /*
     * 초가 바뀌는 순간에 맞춰 첫 박자를 잡는다. 그냥 1초마다 돌리면 시작
     * 지점에 따라 최대 1초가 밀려, 두 화면을 나란히 놓으면 초가 어긋나 보인다.
     */
    let id: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      setNow(new Date());
      id = setInterval(() => setNow(new Date()), 1000);
    }, 1000 - (Date.now() % 1000));
    return () => { clearTimeout(start); if (id) clearInterval(id); };
  }, []);

  return (
    <span className={`tnum tabular-nums ${className}`}>
      {now ? (
        <>
          {withDate && <span className="mr-2">{dateFmt.format(now)}</span>}
          {timeFmt.format(now)}
        </>
      ) : (
        /* 자리만 잡아 둔다. 값이 들어올 때 옆의 것이 밀리지 않는다 */
        <span aria-hidden className="opacity-0">
          {withDate ? '9월 9일 (수) 00:00:00' : '00:00:00'}
        </span>
      )}
    </span>
  );
}
