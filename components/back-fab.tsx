'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/* ---------------------------------------------------------------------------
   따라다니는 뒤로가기

   홈 화면에 걸어 전체 화면으로 쓰면 (PWA standalone) 브라우저 주소창이 없다.
   주소창이 없으면 뒤로가기 단추도 없다. 안드로이드는 기기 제스처가 남지만
   iPad 는 화면 왼쪽 가장자리를 쓸어야 하고, 장갑 낀 손으로 가장자리 제스처는
   잘 안 먹는다. 그래서 화면 안에 둔다 (사용자 요청).

   ── 어디에 두는가 ─────────────────────────────────────────────────────────
   오른쪽 아래. 패드를 두 손으로 들면 엄지가 닿는 자리이고, 글을 왼쪽부터
   읽으므로 내용을 가장 적게 가린다. 표의 오른쪽 끝 열을 가릴 수 있어 바닥에서
   충분히 띄우고, 홈 인디케이터가 있는 기기에서는 그만큼 더 올린다
   (safe-area-inset).

   ── 모든 화면에 둔다 ──────────────────────────────────────────────────────
   처음에는 각 영역의 첫 화면에서 숨겼는데, 그러면 화면을 옮길 때마다 단추가
   나타났다 사라진다. 늘 있는 자리에 늘 있어야 손이 먼저 간다 (사용자 지시).
   그래서 로그인 화면만 빼고 어디서나 같은 자리에 둔다.

   앞이 없을 때는 뒤로 가지 않고 그 영역의 첫 화면으로 올라간다. 히스토리가
   비었다고 앱 바깥으로 나가 버리면 현장에서는 앱이 꺼진 것처럼 보인다.
--------------------------------------------------------------------------- */

/** 로그인 앞뒤 화면. 여기엔 돌아갈 앱이 없다 */
const OUTSIDE = new Set(['/login', '/no-role']);

export default function BackFab() {
  const router = useRouter();
  const path = usePathname();
  const [hasPrev, setHasPrev] = useState(true);

  useEffect(() => {
    // 이 앱에 바로 들어온 화면이면 앞이 없다
    setHasPrev(window.history.length > 1);
  }, [path]);

  if (OUTSIDE.has(path)) return null;

  /* 현장 화면은 현장 목록으로, 관리 화면은 현황으로 올라간다 */
  const home = path.startsWith('/work') ? '/work' : '/';

  function go() {
    if (hasPrev) { router.back(); return; }
    if (path !== home) { router.push(home); return; }
    // 첫 화면에 바로 들어왔다. 갈 곳이 없으므로 아무것도 하지 않는다
  }

  return (
    <button
      type="button"
      onClick={go}
      aria-label="뒤로"
      title="뒤로"
      className="back-fab"
    >
      <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none"
           stroke="currentColor" strokeWidth="2.25"
           strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 5 L8 12 L15 19" />
      </svg>
    </button>
  );
}
