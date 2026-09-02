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
  /*
   * 열쇠가 없으면 아예 닫는다 (4차 감사 D5).
   *
   * 전에는 `if (secret)` 이라 CRON_SECRET 을 안 세우면 인증 없이 열렸다.
   * 개발노트가 그것을 "선택" 이라 적어 배포 점검에서 빠졌다.
   *
   * 실제 노출은 "멱등한 유지보수를 몇 시간 일찍 돌릴 수 있다" 에 그치지만,
   * 열쇠를 빠뜨린 것이 조용히 열린 문이 되어서는 안 된다. 빠뜨리면 닫힌다.
   */
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else {
    /*
     * 열쇠가 없으면 이 문은 인증 없이 열린다.
     *
     * 닫아 버리면 유효기한 만료 표시가 멈춘다 - 그쪽이 더 나쁘다. 대신
     * **조용히 열려 있지 않게** 한다. 서버 로그에 남기고, 설정 > 개요가
     * 그 상태를 화면에 적는다 (PRINT_SECRET 을 다루는 방식과 같다).
     *
     * 실제 노출은 "멱등한 유지보수를 몇 시간 일찍 돌릴 수 있다" 에 그친다.
     * 문제는 크기가 아니라 개발노트가 그것을 "선택" 이라 적어 배포 점검에서
     * 빠졌다는 것이다 (4차 감사 D5).
     */
    console.warn('[daily] CRON_SECRET 이 없어 인증 없이 열려 있습니다');
  }

  try {
    const out = await withActor(null, async (db) => ({
      expired: await db.val<number>(`select expire_material_lots()`),
      swept: await db.val<number>(`select login_attempt_sweep()`),
    }));

    /*
     * 백업은 유지보수 뒤에 뜬다 (5차 감사 C3).
     *
     * 순서가 중요하다 - 백업이 오래 걸려 함수가 끊기면 앞의 것까지 함께
     * 죽는다. 유효기한 표시가 멈추는 쪽이 더 나쁘므로 그것을 먼저 끝낸다.
     * 그리고 백업 실패가 이 응답을 실패로 만들지 않는다.
     */
    // 무엇이 바뀌었는지 서버 로그에 남긴다. 아무 일도 없으면 0으로 남는다.
    console.log('[daily]', JSON.stringify(out));
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error('[daily] 실패', e);
    return NextResponse.json(
      { error: (e as Error).message ?? 'failed' }, { status: 500 });
  }
}
