import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import {
  readAllow, allows, clientIp, readCountries, clientCountry,
  readPlaces, placeAllows, clientRegion, clientCity,
} from '@/lib/net';
import { SESSION_COOKIE } from '@/lib/auth-const';

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

/* ---------------------------------------------------------------------------
   같은 자리를 되풀이해 적지 않는다

   인터넷에 열린 주소는 훑고 다니는 기계가 늘 두드린다. 요청마다 DB 를 건드리면
   바깥에서 두드리는 만큼 쓰기가 일어난다.

   표에도 (날짜 · 자리 · 계정 · 까닭) 으로 묶는 열쇠가 있지만(0109), 그건
   **줄 수**를 묶는 것이지 **질의 수**를 묶지는 못한다. 여기서 한 번 더 거른다.

   완전하지 않다 - 서버가 여럿이면 각자 자기 것만 안다. 완전할 필요도 없다.
   줄이려는 것이지 세려는 것이 아니고, 세는 자리는 표다.
--------------------------------------------------------------------------- */
const QUIET_MS = 60_000;
const seen = new Map<string, number>();

function tooSoon(key: string): boolean {
  const now = Date.now();
  const last = seen.get(key);
  if (last !== undefined && now - last < QUIET_MS) return true;
  /* 오래된 것을 치운다. 램에 두는 값이라 마냥 늘게 두지 않는다 */
  if (seen.size > 500) {
    for (const [k, t] of seen) if (now - t > QUIET_MS) seen.delete(k);
  }
  seen.set(key, now);
  return false;
}

/**
 * 막힌 접속을 적는다. **답을 붙들지 않는다** - 적는 것이 실패해도 403 은 나간다.
 * 문이 서는 것이 먼저이고 적는 것은 그다음이다.
 */
/*
 * 꾸러미 요청은 적지 않는다.
 *
 * 화면 하나를 열면 스크립트와 글꼴이 줄줄이 따라온다. 그것까지 적으면 `path`
 * 자리에 그중 아무거나 남아, 무엇을 열려 했는지가 보이지 않는다. 문서 요청이
 * 늘 먼저 오므로 그것만 적으면 된다.
 */
const ASSET = /^\/(_next|fonts|favicon|manifest|logo)\b/;

async function note(
  reason: string, path: string,
  ip: string | null, cc: string | null, region: string | null, city: string | null,
  cookie: string | undefined,
) {
  if (ASSET.test(path)) return;
  try {
    const { peekSessionUser } = await import('@/lib/session');
    const who = peekSessionUser(cookie);
    if (tooSoon(`${ip ?? ''}|${who ?? ''}|${reason}`)) return;

    const { withActor } = await import('@/lib/db');
    await withActor(null, (db) => db.rows(
      `select access_block_note($1, $2, $3, $4, $5::uuid, $6, $7)`,
      [ip, cc, region, city, who, reason, path]));
  } catch (e) {
    console.warn('[net] 막힌 접속을 적지 못했습니다', (e as Error).message);
  }
}

/*
 * matcher 를 두지 않는다. 없으면 **모든 요청**에 돈다 - 화면만이 아니라
 * 꾸러미(_next/static)와 public 까지. 바깥에 내줄 것이 없으므로 그게 맞다.
 * 화면만 걸러 두면 막힌 사람에게도 스크립트 꾸러미는 그대로 나간다.
 *
 * 파일 이름은 proxy.ts 다. Next 16 에서 middleware 가 이 이름으로 바뀌었다.
 */
export function proxy(req: NextRequest, event: NextFetchEvent) {
  const { rules, bad } = readAllow(process.env.ALLOW_FROM);
  const { list: countries, bad: countryBad } = readCountries(process.env.ALLOW_COUNTRY);
  const { list: regions } = readPlaces(process.env.ALLOW_REGION);
  const { list: cities } = readPlaces(process.env.ALLOW_CITY);
  if (bad.length > 0) {
    console.warn('[net] ALLOW_FROM 에서 읽지 못한 조각', bad.join(' '));
  }
  if (countryBad.length > 0) {
    console.warn('[net] ALLOW_COUNTRY 에서 읽지 못한 조각', countryBad.join(' '));
  }
  if (rules.length === 0 && countries.length === 0
      && regions.length === 0 && cities.length === 0) {
    return NextResponse.next();
  }

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
  const region = clientRegion(req.headers);
  const city = clientCity(req.headers);
  /*
   * 막을 때마다 그 사실을 남긴다 (0109 · 사용자 지시 2026-09-11).
   *
   * 문이 닫혀 있으면 로그인 시도 자체가 일어나지 않으므로, 밖에서 무슨 일이
   * 있었는지는 여기 말고 알 자리가 없다. 세션 쿠키를 들고 왔으면 누구인지도
   * 함께 적는다 - 제조소 패드를 들고 나간 경우가 그것이다.
   *
   * `waitUntil` 로 답 뒤에 돌린다. 적는 일이 403 을 늦추지 않는다.
   */
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const where = (reason: string) => {
    event.waitUntil(note(reason, path, ip, cc, region, city, cookie));
    return deny(ip, cc, region, city);
  };

  if (countries.length > 0 && (!cc || !countries.includes(cc))) {
    console.warn('[net] 막음 · 나라', cc ?? '(나라 모름)', ip ?? '', path);
    return where('COUNTRY');
  }

  /*
   * 시·도와 시는 나라보다 잘 흔들린다. 여러 값을 적을 수 있으므로, 며칠
   * 지켜보고 나오는 것을 다 적으면 흔들림이 잠금으로 이어지지 않는다.
   */
  if (regions.length > 0 && !placeAllows(regions, region)) {
    console.warn('[net] 막음 · 시도', region ?? '(시도 모름)', ip ?? '', path);
    return where('REGION');
  }
  if (cities.length > 0 && !placeAllows(cities, city)) {
    console.warn('[net] 막음 · 시', city ?? '(시 모름)', ip ?? '', path);
    return where('CITY');
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
    return where('ADDRESS');
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
function deny(
  ip: string | null, country: string | null,
  region: string | null, city: string | null,
) {
  /*
   * 막힌 사람이 읽어 줄 값이다. 주소만이 아니라 **잣대로 쓰는 값을 전부** 낸다 -
   * 시·도나 시로 좁혀 두었다면 어긋난 것이 그 둘 중 하나이고, 그 값을 목록에
   * 더하면 바로 풀린다. 무엇 때문에 막혔는지 모르는 화면은 전화 한 통을
   * 더 만든다.
   */
  const place = [region, city].filter(Boolean).join(' ');
  const where = [ip ?? '접속지를 읽지 못했습니다', country, place || null]
    .filter(Boolean).join(' · ');
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
