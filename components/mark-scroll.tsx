'use client';

import { useEffect } from 'react';

/**
 * 확인해 볼 항목이 가리키는 첫 칸으로 화면을 옮긴다 (사용자 2026-11-20). 칸에는 data-hl 이 붙는다
 * (components/print-frame FormBody). 표시한 칸이 없으면 아무것도 하지 않는다.
 */
export default function MarkScroll() {
  useEffect(() => {
    const el = document.querySelector('[data-hl]');
    if (el) el.scrollIntoView({ block: 'center' });
  }, []);
  return null;
}
