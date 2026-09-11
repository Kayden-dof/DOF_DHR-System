import { NextResponse, type NextRequest } from 'next/server';
import {
  readAllow, allows, clientIp, readCountries, clientCountry,
} from '@/lib/net';

/* ---------------------------------------------------------------------------
   접속지 제한 (망 경계)

   지금 이 프로그램은 인터넷 전체에 열려 있고, 문은 여섯 자리 숫자 하나다.
   여기서 그 문 **앞에 설 수 있는 자리**를 좁힌다.

   ── 비어 있으면 아무도 막지 않는다 ────────────────────────────────────────
   ALLOW_FROM 이 없으면 이 파일은 아무 일도 하지 않는다. 기본값으로 문을 닫으면
   배포 한 번에 제조소 전원이 잠기고, 그것을 푸는 길이 바로 그 잠긴 화면 뒤에
   있다. 여는 것은 사람이 정해서 넣는다 (§2.0 - 주소는 이 회사의 값이다).

   ── 빠져나가는 문을 만들지 않는다 (§10) ───────────────────────────────────
   `?bypass=` 같은 것은 없다. 예외는 하나뿐이고 그것은 우회가 아니라 **다른
   자물쇠**다 - 예약 작업(`/api/daily`)은 사람이 부르는 자리가 아니라
   Vercel 이 자기 망에서 부르므로 제조소 주소로 올 수가 없다. 그 문은
   CRON_SECRET 으로 잠근다.

   ── 이것만으로 닫히지 않는다 ──────────────────────────────────────────────
   접속지는 Vercel 이 채워 준 머리글에서 읽는다. 바깥 겹(Vercel 방화벽)이 있어야
   여기 닿기 전에 끊기고, 여기는 그 겹이 꺼졌을 때 한 번 더 묻는 안쪽 겹이다.
   두 겹을 같은 값으로 맞춰 둔다.
--------------------------------------------------------------------------- */

/** 접속지 검사를 지나가는 길. 자기 자물쇠가 따로 있는 것만 적는다. */
const OWN_LOCK = ['/api/daily'];

/*
 * matcher 를 두지 않는다. 없으면 **모든 요청**에 돈다 - 화면만이 아니라
 * 꾸러미(_next/static)와 public 까지. 바깥에 내줄 것이 없으므로 그게 맞다.
 * 화면만 걸러 두면 막힌 사람에게도 스크립트 꾸러미는 그대로 나간다.
 *
 * 파일 이름은 proxy.ts 다. Next 16 에서 middleware 가 이 이름으로 바뀌었다.
 */
export function proxy(req: NextRequest) {
  const { rules, bad } = readAllow(process.env.ALLOW_FROM);
  const { list: countries, bad: countryBad } = readCountries(process.env.ALLOW_COUNTRY);
  if (bad.length > 0) {
    console.warn('[net] ALLOW_FROM 에서 읽지 못한 조각', bad.join(' '));
  }
  if (countryBad.length > 0) {
    console.warn('[net] ALLOW_COUNTRY 에서 읽지 못한 조각', countryBad.join(' '));
  }
  if (rules.length === 0 && countries.length === 0) return NextResponse.next();

  const path = req.nextUrl.pathname;
  if (OWN_LOCK.some((p) => path === p || path.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  /*
   * ── 적어 넣은 조건은 **전부** 만족해야 한다 ──────────────────────────────
   *
   * 둘 중 하나만 맞아도 열어 주면, 넓은 쪽(나라)이 좁은 쪽(주소)을 무르게
   * 만든다. 주소를 제조소 하나로 적어 두고 나라를 한국으로 적으면 한국
   * 어디서나 열리는 셈이다 - 규칙 하나가 다른 규칙을 넓히는 것은 §10 이
   * 금지한 우회 갈래와 같은 것이다.
   *
   * 그래서 적은 것은 전부 좁힌다. 나라만 적으면 나라로만 좁고, 둘 다 적으면
   * 둘 다 맞아야 한다.
   */
  const ip = clientIp(req.headers);
  const cc = clientCountry(req.headers);

  if (countries.length > 0 && (!cc || !countries.includes(cc))) {
    console.warn('[net] 막음 · 나라', cc ?? '(나라 모름)', ip ?? '', path);
    return deny(ip, cc);
  }

  if (rules.length === 0) return NextResponse.next();

  /*
   * 접속지를 알 수 없으면 막는다.
   *
   * 목록을 적어 넣은 사람의 뜻은 "이 자리들만" 이다. 알 수 없는 자리는 그
   * 목록에 없는 자리다. 여기서 지나가게 하면 머리글을 지운 요청 하나로 문이
   * 열리고, 그것은 §10 이 금지한 우회 갈래가 된다.
   *
   * 목록을 비우면 이 검사 자체가 돌지 않으므로(위) 잠겨도 푸는 길은 있다 -
   * 배포 환경에서 ALLOW_FROM 을 지우면 된다. 앱 안에 푸는 단추를 두지 않는
   * 것은 그 단추가 곧 문이기 때문이다.
   */
  if (!ip || !allows(rules, ip)) {
    console.warn('[net] 막음 · 주소', ip ?? '(접속지 모름)', path);
    return deny(ip, cc);
  }

  return NextResponse.next();
}

/*
 * 막은 화면. 왜 막혔는지와 무엇을 말해야 하는지를 적는다.
 *
 * "접근 거부" 한 줄만 두면 제조소 밖에서 열어 본 사람이 프로그램이 죽은 줄
 * 알고 전화를 건다. 자기 주소를 보여 주면 그대로 읽어 주면 된다 - 남의 비밀이
 * 아니라 그 사람 자신의 값이다.
 */
function deny(ip: string | null, country: string | null) {
  const where = [ip ?? '접속지를 읽지 못했습니다', country].filter(Boolean).join(' · ');
  const body = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>접속할 수 없습니다</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14181d;
      color:#e8ecf1;font:16px/1.7 "Malgun Gothic",system-ui,sans-serif}
 main{max-width:32rem;padding:2rem}
 h1{margin:0 0 .75rem;font-size:1.375rem}
 p{margin:0 0 .75rem;color:#aeb8c4}
 code{font-family:Consolas,"Courier New",monospace;color:#e8ecf1}
</style></head><body><main>
<h1>이 자리에서는 접속할 수 없습니다.</h1>
<p>이 시스템은 등록된 접속지에서만 열립니다. 제조소 안에서 다시 열어 보십시오.</p>
<p>제조소에서 열었는데도 이 화면이 나오면 시스템 관리자에게
   아래 주소를 알려 주십시오.</p>
<p><code>${escapeHtml(where)}</code></p>
</main></body></html>`;

  return new NextResponse(body, {
    status: 403,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
