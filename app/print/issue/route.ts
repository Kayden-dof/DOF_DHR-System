import { NextResponse } from 'next/server';
import { issueTicket } from '@/lib/print';

/* ---------------------------------------------------------------------------
   인쇄 단추가 부르는 자리

   미리보기 화면이 들고 있던 발행권을 돌려받아 대장에 한 줄 적고, 그 종이의
   회차 · 인쇄 시각 · 인쇄자를 되돌려 준다. 화면은 머리글을 그 값으로 바꾸고
   인쇄 대화상자를 연다.

   주소는 바뀌지 않는다. 그래서 새로 고치면 다시 미리보기이고, 뒤로 가기나
   즐겨찾기로 정본이 다시 나오는 자리가 생기지 않는다.

   ── 왜 서버 액션이 아닌가 ─────────────────────────────────────────────────
   서버 액션으로 두면 **시험이 이 자리를 부를 수 없다.** 액션 식별자는 빌드마다
   바뀌므로 그것을 긁어 흉내 내는 시험은 시험이 먼저 깨진다
   (scripts/session-cookie.mjs 가 로그인에서 같은 함정을 적어 두었다).

   인쇄는 1급 기능이고 (§7) 대장에 쓰는 유일한 자리다. 시험이 닿지 못하는
   자리에 두면 "통과했다" 가 아무것도 뜻하지 않는다 (§8.0.1).

   ── 열어 둔 문이 아니다 ───────────────────────────────────────────────────
   §10 이 금지하는 것은 "인쇄 화면이 아닌 곳에서 record_print 행 만들기" 다.
   이 자리는 발행권 없이는 아무것도 하지 않고, 발행권은 인쇄 화면이 그려질 때
   서버가 봉해 건넨 것뿐이다. 문을 연 것이 아니라 그 화면의 단추가 어디로
   가는지를 적은 것이다.
--------------------------------------------------------------------------- */
export async function POST(req: Request) {
  /*
   * 다른 자리에서 건너온 요청은 받지 않는다. 발행권이 없으면 어차피 아무 일도
   * 일어나지 않지만, 우리 화면에서 온 것만 받는 편이 문이 하나 적다.
   */
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) {
    return NextResponse.json({ ok: false, reason: '잘못된 요청입니다' }, { status: 403 });
  }

  let ticket = '';
  try {
    ticket = String(((await req.json()) as { ticket?: unknown }).ticket ?? '');
  } catch { /* 빈 값으로 둔다. 아래에서 만료와 같은 말로 답한다 */ }

  try {
    const r = await issueTicket(ticket);
    if ('expired' in r) {
      return NextResponse.json(
        { ok: false, reason: '이 화면을 연 지 오래되었습니다. 새로 고친 뒤 인쇄하세요.' });
    }
    return NextResponse.json({ ok: true, meta: r });
  } catch (e) {
    /*
     * 막히는 까닭은 대개 둘이다 - 열람 권한이거나, 그 묶음이 이미 잠겼거나
     * (S04). 둘 다 사람이 읽을 수 있는 말로 DB 에서 올라온다. 지어내지 않고
     * 그대로 옮긴다 (§1).
     */
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : '인쇄를 등록하지 못했습니다' });
  }
}
