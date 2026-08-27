import { requireUser } from '@/lib/session';
import { isViewerOnly } from '@/lib/roles';
import Denied from '@/components/denied';
import BackFab from '@/components/back-fab';

/* ---------------------------------------------------------------------------
   인쇄 화면

   종이가 정본이다 (§1). 화면은 종이의 미리보기일 뿐이고, 인쇄하면 화면 장식이
   전부 사라지고 자료만 남는다.

   모든 인쇄물에 공통으로 들어가는 것 (§7)
     인쇄 일시 · 인쇄자 · 인쇄 회차 · 자료 식별자(data_hash) · 쪽 번호
--------------------------------------------------------------------------- */

export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  /*
   * 열람자는 인쇄 화면에 들어오지 못한다.
   *
   * 이 시스템에서 인쇄는 보기가 아니라 쓰기다. 화면을 여는 것만으로
   * record_print 행이 생기고, 제조기록서라면 그 묶음이 잠긴다 (S04). 잠금을
   * 푸는 방법은 없다. 보려고 들어온 사람이 작업 중인 일차를 잠그면 작업자가
   * 더 이상 기록하지 못한다.
   *
   * 종이가 필요하면 생산관리자가 뽑는다. 열람자 세션은 DB 에서도 읽기 전용이라
   * 여기를 지나쳐도 인쇄 기록 자체가 남지 않는다 (0043).
   */
  if (isViewerOnly(user.roles)) {
    return (
      <Denied what="인쇄" need="생산관리자 또는 시스템관리자">
        인쇄물을 뽑으면 인쇄 기록이 남고 제조기록서는 그 묶음이 잠깁니다.
        열람 계정은 인쇄하지 않습니다. 종이가 필요하면 생산관리자에게 요청하십시오.
      </Denied>
    );
  }
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
