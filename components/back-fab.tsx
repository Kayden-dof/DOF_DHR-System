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

   ── 언제 숨는가 ───────────────────────────────────────────────────────────
   갈 곳이 없으면 나오지 않는다. 눌러도 아무 일이 없는 단추가 떠 있으면 그
   화면의 다른 단추까지 못 믿게 된다.

     · 각 영역의 첫 화면 (관리 현황 · 현장 배치 목록) 은 돌아갈 위가 없다
     · 이 앱에 바로 들어온 첫 화면이면 히스토리에 앞이 없다. 뒤로 가면 앱
       바깥으로 나가 버리므로 그때도 숨는다

   히스토리 길이는 서버에서 알 수 없다. 그래서 처음에는 숨겨 두고 브라우저에서
   확인한 뒤에 띄운다. 잠깐 없다가 나타나는 편이, 눌렀더니 앱을 벗어나는 것보다
   낫다.
--------------------------------------------------------------------------- */

/** 돌아갈 위가 없는 화면. 각 영역의 첫 장이다 */
const ROOTS = new Set(['/', '/work', '/login', '/no-role']);

export default function BackFab() {
  const router = useRouter();
  const path = usePathname();
  const [canGo, setCanGo] = useState(false);

  useEffect(() => {
    // 이 앱에 바로 들어온 화면이면 앞이 없다
    setCanGo(window.history.length > 1);
  }, [path]);

  if (ROOTS.has(path) || !canGo) return null;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="뒤로"
      title="뒤로"
      className="back-fab"
    >
      <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none"
           stroke="currentColor" strokeWidth="2.25"
           strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 5 L8 12 L15 19" />
      </svg>
      <span className="back-fab-label">뒤로</span>
    </button>
  );
}
