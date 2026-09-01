import type { MetadataRoute } from 'next';
import { getBrand, darkTone } from '@/lib/brand';

/* ---------------------------------------------------------------------------
   앱 설치 정보 (PWA)

   현장 패드에서 홈 화면에 걸어 두고 브라우저 껍데기 없이 전체 화면으로 쓰기
   위한 것이다. 얻는 것은 셋이다.

     · 주소창과 탭 줄이 사라져 세로 100px 남짓을 기록 화면이 되찾는다
     · 홈 화면 아이콘 한 번으로 들어간다. 주소를 외우거나 즐겨찾기를 뒤지지
       않는다
     · standalone 이라 작업 중에 다른 사이트로 새어 나갈 길이 없다

   ── 오프라인은 넣지 않는다 ────────────────────────────────────────────────
   PWA 하면 따라오는 오프라인 캐시를 일부러 넣지 않는다. 이 시스템에서 그건
   기능이 아니라 위험이다.

     · 캐시된 화면은 낡은 자재 잔량과 낡은 잠금 상태를 보여 준다. 그 화면을
       믿고 기록하면 틀린 기록이 남는다
     · 오프라인 쓰기를 큐에 쌓으면, 작업자는 저장된 줄 알고 손을 떼는데 실제로
       저장되지 않았을 수 있다. 나중에 올라가면서 S04 잠금에 막히면 그 기록은
       갈 곳이 없다
     · 인쇄물이 정본이다 (§1). 종이에 찍힌 값과 화면 값이 갈라지는 길을
       스스로 만들 이유가 없다

   그래서 서비스 워커를 두지 않는다. 연결이 끊기면 브라우저가 끊겼다고 말하고,
   그게 맞는 동작이다. 끊긴 채로 기록을 받는 것보다 낫다.

   설치는 서비스 워커 없이도 된다. 크롬 계열은 manifest 와 아이콘만으로 설치를
   허용하고, iOS 는 원래 apple-touch-icon 과 메타 태그로만 홈 화면에 걸린다.

   ── 이름 · 색 · 아이콘은 설정에서 온다 (§2.0) ─────────────────────────────
   전에는 'DOF DHR' 과 남보라 #342C68, DOF 아이콘 파일 셋이 여기 박혀 있었다.
   다른 제조소가 받아 홈 화면에 걸면 남의 회사 아이콘이 걸린다.

   로고를 올리지 않았으면 아이콘을 아예 내지 않는다. 그러면 설치 단추가 안 뜨는
   기기가 있는데, 남의 로고를 걸어 두는 것보다 낫다. 지어내지 않는다.
--------------------------------------------------------------------------- */

/*
 * 설정을 읽으므로 미리 구우면 안 된다. 빌드하던 때의 설정이 그대로 굳어
 * 로고를 나중에 올려도 홈 화면 아이콘이 비어 있었다 (2026-09-01 확인).
 */
export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const b = await getBrand();
  const short = [b.companyName, b.systemName].filter(Boolean).join(' ') || 'DHR';
  const long = b.systemTagline ? `${short} \u00b7 ${b.systemTagline}` : short;
  const dark = darkTone(b.brandColor);
  const logo = b.hasLogo ? `/logo?v=${b.logoUpdatedAt ?? '0'}` : null;

  return {
    name: long,
    short_name: short,
    description: b.systemTagline || undefined,

    /*
     * 현장 화면으로 들어간다. 패드를 드는 사람은 작업자이고, 관리 화면은
     * 머리글의 단추로 건너간다. 관리자가 쓰는 데스크톱은 보통 설치하지 않는다.
     */
    start_url: '/work',
    scope: '/',

    display: 'standalone',
    orientation: 'any',          // 패드를 눕혀 쓰기도 하고 세워 쓰기도 한다
    lang: 'ko',
    dir: 'ltr',

    /* 뜨는 동안의 바탕. 현장 화면의 머리띠와 같은 톤이라야 이어져 보인다 */
    background_color: dark,
    theme_color: dark,

    /*
     * 올린 로고를 그대로 건다. 크기는 브라우저가 맞춘다. maskable 은 내지
     * 않는다 - 안쪽 80% 로 잘려도 읽히도록 만든 그림이라야 하는데, 올라온
     * 로고가 그렇다고 볼 수 없다. 잘못 잘리는 것보다 안 자르는 편이 낫다.
     */
    icons: logo
      ? [{ src: logo, sizes: '512x512', type: 'image/png', purpose: 'any' }]
      : [],

    /* 홈 화면 아이콘을 길게 눌렀을 때 나오는 바로가기 */
    shortcuts: [
      { name: '작업할 배치', url: '/work' },
      { name: '관리 화면', url: '/' },
    ],
  };
}
