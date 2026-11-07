'use client';

import Link from 'next/link';

/*
 * 참고 인쇄물의 머리 단추.
 *
 * 기록서 · 지시서와 달리 이 종이는 기록이 아니다 - 서면 두 문서를 맞대어 본
 * 결과를 사람이 읽고 검토하는 자료다. 그래서 인쇄 대장에 남기지 않고 잠그지도
 * 않는다. 몇 번을 뽑아도 아무것도 바뀌지 않는다.
 */
export default function PrintBar({ back, title }: { back: string; title: string }) {
  return (
    <div className="no-print mx-auto mb-4 flex w-[210mm] max-w-full items-center justify-between gap-3">
      <Link href={back} className="btn-quiet">돌아가기</Link>
      <span className="text-sm text-muted">{title}</span>
      <button type="button" onClick={() => window.print()} className="btn-primary">인쇄</button>
    </div>
  );
}
