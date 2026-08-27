import { requireUser } from '@/lib/session';
import BackFab from '@/components/back-fab';

/* ---------------------------------------------------------------------------
   인쇄 화면

   종이가 정본이다 (§1). 화면은 종이의 미리보기일 뿐이고, 인쇄하면 화면 장식이
   전부 사라지고 자료만 남는다.

   모든 인쇄물에 공통으로 들어가는 것 (§7)
     인쇄 일시 · 인쇄자 · 인쇄 회차 · 자료 식별자(data_hash) · 쪽 번호
--------------------------------------------------------------------------- */

export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="min-h-screen bg-canvas py-6 print:bg-white print:py-0">
      {children}
      {/*
        * 인쇄 화면에도 같은 자리에 둔다. 여기서 돌아갈 곳이 가장 많고 (배치 ·
        * 설비 · 출하) 머리글의 "돌아가기" 는 위로 스크롤해야 닿는다.
        * 인쇄물에는 나오지 않는다 (.back-fab 은 @media print 에서 숨는다).
        */}
      <BackFab />
    </div>
  );
}
