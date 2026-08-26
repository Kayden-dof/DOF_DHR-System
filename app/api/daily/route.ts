import { NextResponse } from 'next/server';
import { withActor } from '@/lib/db';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------------------
   일 1회 배치 (§6)

   사양 §6이 "일 1회 배치로 자재는 EXPIRED"라고 정한다. 함수는 있었지만 재고
   화면의 단추로만 돌았고, 아무도 누르지 않으면 기한이 지난 자재가 계속 사용
   가능으로 남았다.

   판정이 아니다. 날짜를 지난 것에 지났다고 표시하는 것뿐이다. 그래서 자동으로
   돌아도 §2의 차단 다섯 개와 무관하다.

   실행자는 사람이 아니므로 app.user_id 를 비워 둔다. 감사추적에는 수행자가
   빈 채로 남는데, 그것이 사실이다. 사람이 한 일처럼 꾸미지 않는다.

   Vercel 예약 작업이 부른다 (vercel.json). 바깥에서 아무나 부르지 못하게
   CRON_SECRET 을 확인한다.
--------------------------------------------------------------------------- */

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const out = await withActor(null, async (db) => ({
      expired: await db.val<number>(`select expire_material_lots()`),
      swept: await db.val<number>(`select login_attempt_sweep()`),
    }));

    // 무엇이 바뀌었는지 서버 로그에 남긴다. 아무 일도 없으면 0으로 남는다.
    console.log('[daily]', JSON.stringify(out));
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error('[daily] 실패', e);
    return NextResponse.json(
      { error: (e as Error).message ?? 'failed' }, { status: 500 });
  }
}
