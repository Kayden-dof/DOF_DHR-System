import { ImageResponse } from 'next/og';
import { withActor } from '@/lib/db';
import { getBrand } from '@/lib/brand';
import { pngBox } from '@/lib/png-box';

/* ---------------------------------------------------------------------------
   앱 아이콘 (PWA · 사용자 2026-11-26 «PWA 기능도 만들어주세요»)

   홈 화면 · 시작 메뉴 · 탭에 거는 정사각 아이콘을 설정의 로고로 그린다.
   전에는 올린 로고(지금 1359×827 가로 그림)를 그대로 «512x512» 라 적어 걸었다.
   정사각이 아니라 기기마다 찌그러지거나, 설치 단추가 뜨지 않았다.

     ?s=     32 · 180 · 192 · 512 가운데 하나 (그 밖은 192)
     ?mask=1 안드로이드가 원 · 둥근 네모로 잘라 쓰는 아이콘. 잘려도 남는 안쪽
             60% 에만 그린다
     ?v=     설정이 바뀐 시각. 붙어 있으면 오래 캐시한다 (app/logo 와 같은 약속)

   바탕은 흰색으로 채운다. iOS 는 투명한 곳을 검게 칠하고, 로고는 밝은 바탕용이다.
   로고를 올리지 않았으면 404 다. 첫 글자를 딴 네모를 지어 걸지 않는다 - 그것이
   그 회사 로고인 줄 안다 (app/layout.tsx 와 같은 결정).

   로그인 전에도 나와야 한다. 기기가 설치할 때 쿠키 없이 받아 간다.
--------------------------------------------------------------------------- */

export const dynamic = 'force-dynamic';

const SIZES = [32, 180, 192, 512];

/** 그림이 차지할 몫 (한 변 대비). 마스크용은 잘려도 남는 안쪽 원 안에 든다 */
const FILL = { any: 0.76, mask: 0.56, tiny: 0.92 };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const asked = Number(q.get('s'));
  const s = SIZES.includes(asked) ? asked : 192;
  const mask = q.get('mask') === '1';

  const brand = await getBrand();
  const row = brand.hasLogo
    ? await withActor(null, (db) =>
        db.one<{ mime: string | null; bytes: Buffer | null }>(
          `select logo_mime as mime, logo_bytes as bytes from org_brand limit 1`))
    : null;

  const headers = {
    'cache-control': q.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
    'x-content-type-options': 'nosniff',
  };

  /* 로고는 PNG 로 받는다 (0074). 못 읽는 그림이면 여백을 걷지 못할 뿐 통째로 앉힌다 */
  const geo = row?.bytes && row.mime === 'image/png' ? pngBox(new Uint8Array(row.bytes)) : null;
  if (!row?.bytes || !geo) return new Response(null, { status: 404 });

  const fill = s <= 32 ? FILL.tiny : mask ? FILL.mask : FILL.any;
  const { box } = geo;
  /* 투명 여백을 뺀 상자가 fill 안에 들도록 키우고, 그 상자를 한가운데에 둔다 */
  const k = Math.min((s * fill) / box.w, (s * fill) / box.h);
  const left = s / 2 - (box.x + box.w / 2) * k;
  const top = s / 2 - (box.y + box.h / 2) * k;
  const src = `data:image/png;base64,${Buffer.from(row.bytes).toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: s, height: s, display: 'flex', position: 'relative', overflow: 'hidden', background: '#ffffff' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" width={geo.width * k} height={geo.height * k}
             style={{ position: 'absolute', left, top }} />
      </div>
    ),
    { width: s, height: s, headers },
  );
}
