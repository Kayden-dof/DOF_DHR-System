import { withActor } from '@/lib/db';

/* ---------------------------------------------------------------------------
   회사 로고 (M5-2)

   설정에 담긴 그림을 그대로 내보낸다. 로그인 전에도 나와야 한다 — 로그인 화면
   자체가 이 로고를 쓴다. 회사 로고는 밖으로 나가도 회사가 영향을 받지 않으므로
   (§2.2) 인증을 걸지 않는다.

   ── 캐시 ──────────────────────────────────────────────────────────────────
   그림은 자주 바뀌지 않지만, 바꾸고 나면 바로 보여야 한다. 주소 뒤에 갱신
   시각을 붙여 부르므로(components/brand-mark.tsx) 그 주소는 오래 캐시해도 안전하다.
   시각이 없는 맨 주소는 짧게만 둔다.

   ── 어두운 바탕용 ─────────────────────────────────────────────────────────
   ?dark=1 이면 어두운 바탕용 로고를 낸다 (0074). 안 올렸으면 404 다 - 밝은
   바탕용으로 대신 내지 않는다. 부르는 쪽이 없는 것을 알아야 판을 깔지 말지
   정할 수 있다 (components/brand-mark.tsx).
--------------------------------------------------------------------------- */

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const dark = q.get('dark') === '1';

  const row = await withActor(null, (db) =>
    db.one<{ mime: string | null; bytes: Buffer | null }>(
      dark
        ? `select logo_dark_mime as mime, logo_dark_bytes as bytes from org_brand limit 1`
        : `select logo_mime as mime, logo_bytes as bytes from org_brand limit 1`),
  );

  if (!row?.bytes || !row.mime) {
    return new Response(null, { status: 404 });
  }

  const versioned = q.has('v');
  return new Response(new Uint8Array(row.bytes), {
    headers: {
      'content-type': row.mime,
      'cache-control': versioned
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=60',
      /* 그림 하나다. 무엇으로도 해석되지 않게 못 박는다 */
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
