import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getBrand, brandVars } from '@/lib/brand';

/* ---------------------------------------------------------------------------
   최상위 틀

   글꼴은 Pretendard 를 내려받아 쓰지 않는다. 제조소 패드가 늘 망에 붙어 있다고
   볼 수 없고, 글꼴이 늦게 오면 숫자 자리가 흔들려 로트번호를 잘못 읽는다.
   설치돼 있으면 쓰고 없으면 맑은 고딕으로 떨어진다.

   탭 아이콘은 CI 법인 로고(BI 정방)의 남보라 바탕에 흰 DOF 다.
--------------------------------------------------------------------------- */

const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="12" fill="#342C68"/>` +
    `<g transform="translate(3.6 8.2) scale(0.272) translate(0 198.425) scale(1 -1)" fill="#fff">` +
    `<path d="M224.6202 147.0424 L224.6202 126.8744 L264.9562 126.8744 L264.9562 147.0424 Z"/>` +
    `<path fill="#9FA0A0" d="M244.788 106.707 L264.956 106.707 L264.956 126.875 L244.788 126.875 Z"/>` +
    `<path d="M181.3278 53.1194 L195.7608 53.1194 L195.7608 71.8964 L221.9148 71.8964 L221.9148 84.1894 L195.7608 84.1894 L195.7608 93.4584 L224.6198 93.4584 L224.6198 106.7064 L181.3278 106.7064 Z"/>` +
    `<path d="M146.0408 66.0064 C138.3608 66.0064 132.1338 72.2304 132.1338 79.9124 C132.1338 87.5954 138.3608 93.8194 146.0408 93.8194 C153.7228 93.8194 159.9478 87.5954 159.9478 79.9124 C159.9478 72.2304 153.7228 66.0064 146.0408 66.0064 Z M146.0408 108.4434 C130.2828 108.4434 117.5108 95.6734 117.5108 79.9124 C117.5108 64.1524 130.2828 51.3824 146.0408 51.3824 C161.7988 51.3824 174.5708 64.1524 174.5708 79.9124 C174.5708 95.6734 161.7988 108.4434 146.0408 108.4434 Z"/>` +
    `<path d="M82.8005 66.3673 L75.4615 66.3673 L75.4615 93.4583 L82.8005 93.4583 C90.2585 93.4583 96.4165 87.5563 96.4165 79.9133 C96.4165 72.2693 90.1705 66.3673 82.8005 66.3673 Z M84.7545 106.7063 L61.0285 106.7063 L61.0285 53.1193 L84.7545 53.1193 C99.4265 53.3143 111.1675 65.1963 111.1675 79.9133 C111.1675 94.6303 99.4265 106.5113 84.7545 106.7063 Z"/>` +
    `</g></svg>`,
  );

export const metadata: Metadata = {
  title: {
    default: 'DOF DHR',
    template: '%s · DOF DHR',
  },
  description: '제조기록 지원 시스템. 정본은 서명된 종이다.',
  applicationName: 'DOF DHR',
  /*
   * 파비콘은 SVG 로 두고 (어떤 배율에서도 깨지지 않는다), 홈 화면 아이콘만
   * PNG 로 낸다. iOS 는 SVG 를 홈 화면에 걸지 못한다.
   */
  icons: {
    icon: FAVICON,
    apple: '/icons/apple-touch-icon.png',
  },
  /*
   * 패드에서 홈 화면에 걸었을 때 브라우저 껍데기 없이 뜨게 한다. iOS 는
   * manifest 의 display 를 보지 않고 이 두 값을 본다.
   */
  appleWebApp: {
    capable: true,
    title: 'DOF DHR',
    statusBarStyle: 'black-translucent',
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 현장에서 두 손가락으로 확대해 로트번호를 확인하는 일이 있다. 막지 않는다.
  maximumScale: 5,
  themeColor: '#342C68',
};

/* ---------------------------------------------------------------------------
   회사 강조색을 여기서 심는다 (M5-2 · §2.0)

   전에는 globals.css 에 #562C8D 로 박혀 있었다. 다른 제조소가 받으면 그 파일을
   고쳐 다시 빌드해야 한다.

   :root 에 이미 있는 값 위에 덮어쓴다. 설정을 못 읽어도 globals.css 의 값이
   그대로 남아 화면이 무채색이 되지 않는다.

   파생은 lib/brand.ts 한 곳에서만 한다 (§10).
--------------------------------------------------------------------------- */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { brandColor } = await getBrand();
  return (
    <html lang="ko">
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${brandVars(brandColor)}}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
