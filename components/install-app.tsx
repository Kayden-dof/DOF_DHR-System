'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/* ---------------------------------------------------------------------------
   앱으로 설치 (PWA · 사용자 2026-11-26)

   크롬 · 엣지는 설치할 수 있을 때 `beforeinstallprompt` 를 화면이 뜰 때 한 번 보낸다.
   그때 «내 설정» 이 열려 있으리란 법이 없으므로 최상위 틀(app/layout.tsx)의
   InstallCapture 가 붙잡아 두고, «내 설정» 의 InstallApp 이 꺼내 쓴다.

   붙잡으면서 브라우저의 설치 띠를 막는다(preventDefault). 현장 패드에서 기록하다가
   아래에서 올라오는 띠를 잘못 누르는 일이 없게 - 설치는 사람이 «내 설정» 에서 고른다.
   주소창의 설치 아이콘은 그대로 남는다.

   iPad · iPhone 의 Safari 에는 이 신호가 없다. 공유 단추의 «홈 화면에 추가» 를 안내한다.
--------------------------------------------------------------------------- */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let held: InstallPromptEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());

function subscribe(f: () => void) {
  subs.add(f);
  return () => { subs.delete(f); };
}

/** 최상위 틀에 하나. 아무것도 그리지 않는다 */
export function InstallCapture() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      held = e as InstallPromptEvent;
      tell();
    };
    const onInstalled = () => { held = null; installed = true; tell(); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return null;
}

type Where = 'app' | 'ios' | 'other';

function whereAmI(): Where {
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return 'app';
  const ua = navigator.userAgent;
  /* iPadOS 는 스스로를 Mac 이라 부른다. 손가락이 닿으면 iPad 다 */
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios ? 'ios' : 'other';
}

/** «내 설정» 의 설치 칸 */
export function InstallApp() {
  const prompt = useSyncExternalStore(subscribe, () => held, () => null);
  const done = useSyncExternalStore(subscribe, () => installed, () => false);
  const [where, setWhere] = useState<Where | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setWhere(whereAmI()); }, []);

  async function install() {
    if (!held) return;
    setBusy(true);
    const ev = held;
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      /* 한 번 쓴 신호는 다시 쓸 수 없다. 거절했으면 브라우저가 다음에 다시 보낸다 */
      held = null;
      if (outcome === 'accepted') installed = true;
      tell();
    } finally {
      setBusy(false);
    }
  }

  if (where === null) return <p className="px-4 py-3 text-sm text-muted">&nbsp;</p>;

  if (where === 'app') {
    return <p className="px-4 py-3 text-sm text-body">이 화면은 앱으로 열려 있습니다.</p>;
  }

  if (done) {
    return (
      <p className="px-4 py-3 text-sm text-body">
        설치했습니다. 홈 화면이나 시작 메뉴의 아이콘으로 여십시오.
      </p>
    );
  }

  if (prompt) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm text-body">이 기기에 앱으로 설치할 수 있습니다.</p>
        <button type="button" className="btn-primary" disabled={busy} onClick={install}>
          앱으로 설치
        </button>
      </div>
    );
  }

  if (where === 'ios') {
    return (
      <ol className="list-inside list-decimal space-y-1 px-4 py-3 text-sm text-body">
        <li>Safari 로 이 주소를 엽니다.</li>
        <li>주소창 옆의 공유 단추를 누릅니다.</li>
        <li>«홈 화면에 추가» 를 누릅니다.</li>
      </ol>
    );
  }

  return (
    <p className="px-4 py-3 text-sm text-body">
      브라우저 메뉴(⋮)에서 «앱 설치» 또는 «홈 화면에 추가» 를 누르십시오.
      이미 설치했다면 홈 화면이나 시작 메뉴의 아이콘으로 엽니다.
    </p>
  );
}
