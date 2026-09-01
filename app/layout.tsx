import type { Metadata, Viewport } from 'next';
import './globals.css';
import './fonts.css';   // 글꼴 조각. scripts/subset-font.py 가 만든다
import { getBrand, brandVars, brandMarkVar, darkTone } from '@/lib/brand';

/* ---------------------------------------------------------------------------
   최상위 틀

   글꼴은 Pretendard 를 내려받아 쓰지 않는다. 제조소 패드가 늘 망에 붙어 있다고
   볼 수 없고, 글꼴이 늦게 오면 숫자 자리가 흔들려 로트번호를 잘못 읽는다.
   설치돼 있으면 쓰고 없으면 맑은 고딕으로 떨어진다.

   이름 · 색 · 아이콘은 전부 설정에서 온다 (§2.0). 여기에 회사 이름을 적지
   않는다 - 다른 제조소가 받으면 탭에 남의 회사가 뜬다.
--------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   탭 이름과 아이콘도 설정에서 온다 (§2.0)

   전에는 'DOF DHR' 과 DOF 벡터가 여기 박혀 있었다. 다른 제조소가 받으면 자기
   화면 탭에 남의 회사 이름이 뜬다.

   ── 아이콘은 로고가 있을 때만 건다 ────────────────────────────────────────
   로고가 없으면 아무것도 걸지 않고 브라우저의 기본 아이콘에 맡긴다. 지어내지
   않는다 - 첫 글자를 딴 네모를 만들어 걸면 그것이 그 회사 로고인 줄 안다.
--------------------------------------------------------------------------- */
export async function generateMetadata(): Promise<Metadata> {
  const b = await getBrand();
  const name = [b.companyName, b.systemName].filter(Boolean).join(' ') || 'DHR';
  const logo = b.hasLogo ? `/logo?v=${b.logoUpdatedAt ?? '0'}` : undefined;

  return {
    title: { default: name, template: `%s \u00b7 ${name}` },
    description: b.systemTagline || undefined,
    applicationName: name,
    icons: logo ? { icon: logo, apple: logo } : undefined,
    /*
     * 패드에서 홈 화면에 걸었을 때 브라우저 껍데기 없이 뜨게 한다. iOS 는
     * manifest 의 display 를 보지 않고 이 두 값을 본다.
     */
    appleWebApp: { capable: true, title: name, statusBarStyle: 'black-translucent' },
    robots: { index: false, follow: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const { brandColor } = await getBrand();
  return {
    width: 'device-width',
    initialScale: 1,
    // 현장에서 두 손가락으로 확대해 로트번호를 확인하는 일이 있다. 막지 않는다.
    maximumScale: 5,
    /* 주소창 색. 현장 화면의 머리띠와 같은 톤이라야 이어져 보인다 */
    themeColor: darkTone(brandColor),
  };
}

/* ---------------------------------------------------------------------------
   회사 강조색을 여기서 심는다 (M5-2 · §2.0)

   전에는 globals.css 에 #562C8D 로 박혀 있었다. 다른 제조소가 받으면 그 파일을
   고쳐 다시 빌드해야 한다.

   :root 에 이미 있는 값 위에 덮어쓴다. 설정을 못 읽어도 globals.css 의 값이
   그대로 남아 화면이 무채색이 되지 않는다.

   파생은 lib/brand.ts 한 곳에서만 한다 (§10).
--------------------------------------------------------------------------- */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  const { brandColor } = brand;
  const mark = brandMarkVar(brand);
  return (
    <html lang="ko">
      <head>
        <style dangerouslySetInnerHTML={{
          __html: `:root{${brandVars(brandColor)}${mark ? `;${mark}` : ''}}`,
        }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
