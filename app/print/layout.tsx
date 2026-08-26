import { requireUser } from '@/lib/session';

/* ---------------------------------------------------------------------------
   인쇄 화면

   종이가 정본이다 (§1). 화면은 종이의 미리보기일 뿐이고, 인쇄하면 화면 장식이
   전부 사라지고 자료만 남는다.

   모든 인쇄물에 공통으로 들어가는 것 (§7)
     인쇄 일시 · 인쇄자 · 인쇄 회차 · 자료 식별자(data_hash) · 쪽 번호
--------------------------------------------------------------------------- */

export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <div className="min-h-screen bg-canvas py-6 print:bg-white print:py-0">{children}</div>;
}
