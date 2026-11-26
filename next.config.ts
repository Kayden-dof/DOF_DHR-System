import type { NextConfig } from 'next';

/* ---------------------------------------------------------------------------
   보안 머리글 (망 경계)

   접속지를 좁히는 것(proxy.ts)과 짝이다. 그쪽이 "누가 닿을 수 있는가"를
   묻는다면 여기는 "닿은 뒤에 이 화면이 무엇을 할 수 있는가"를 묶는다.

   판정하지 않는다 (§1). 기록에 손대지 않고 화면 동작도 바꾸지 않는다.

   ── 왜 이 값들인가 ────────────────────────────────────────────────────────
   default-src 'self'   바깥으로 나가는 길을 전부 끊는다. 이 프로그램은 CDN도
                        글꼴 서버도 쓰지 않는다 (글꼴은 public/fonts 에 있다).
                        스크립트가 끼어들어도 배치번호를 실어 보낼 자리가 없다.
   frame-ancestors      남의 화면 속 창틀에 이 화면을 끼워 넣지 못한다. 끼워
                        넣을 수 있으면 "승인" 단추 위에 투명한 판을 덮는다.
   form-action 'self'   서식이 바깥 주소로 날아가지 못한다.
   Referrer-Policy      주소에 배치 식별자가 들어 있다. 바깥으로 나가는 요청에
                        그 주소를 붙이지 않는다.

   'unsafe-inline' 은 남는다. Next 가 화면 자료를 인라인 <script> 로 실어
   보내기 때문이다. 이 규칙은 **끼어든 스크립트가 밖으로 나가는 것**을 막지,
   끼어드는 것 자체를 막지는 않는다. 그 이상은 nonce 를 붙여야 하고, 그러면
   화면마다 손이 가 빠뜨리는 자리가 생긴다.
--------------------------------------------------------------------------- */

const dev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  /* 개발 서버는 새로고침을 위해 eval 과 웹소켓을 쓴다. 배포에는 없다 */
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? ' ws: http://localhost:*' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join('; ');

const headers = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  /* 검색에 잡힐 자리가 아니다. 화면의 metadata 와 같은 말을 머리글로도 한다 */
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

if (!dev) {
  headers.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  });
}

const config: NextConfig = {
  // pg는 서버에서만 쓴다. 번들에 끌어넣지 않는다.
  serverExternalPackages: ['pg'],

  async headers() {
    return [
      { source: '/:path*', headers },
      /*
       * 글꼴은 다시 묻지 않고 쓴다 (2026-11-26 · 사용자 «새로 고침하면 전체 규격 · 부품 위치가 한 번씩
       * 다시 잡힌다»). 기본값(max-age=0, must-revalidate)이면 새로 고칠 때마다 글꼴을 서버에 다시
       * 묻는다 - 운영 실측 123ms. 글꼴은 100ms 까지만 기다리므로(font-display: fallback) 그보다 늦으면
       * 맑은 고딕으로 먼저 그렸다가 Pretendard 로 바뀌고, 글자 폭이 달라져 표 · 단추 자리가 다시 잡혔다.
       * 이레 동안은 묻지 않고, 그 뒤에도 가진 것을 먼저 쓰고 뒤에서 새로 받는다.
       * 파일 이름에 지문이 없으므로(scripts/subset-font.py) 1년 immutable 로 묶지는 않는다.
       */
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=2592000' }],
      },
    ];
  },
};

export default config;
