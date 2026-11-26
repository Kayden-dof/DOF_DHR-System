import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { canOpen } from '@/lib/access';
import { SHIPPING_NAV } from '../sections';

/* ---------------------------------------------------------------------------
   출하 첫 화면 → 하위 차림표의 맨 앞 탭 (사용자 2026-11-26 «모든 화면은 제일 앞에 있는 탭으로
   열리도록 · 출하는 수주 탭 먼저»)

   전에는 멸균 위탁으로 보냈다 (0160 · 출하 승인 화면을 걷을 때). 그 뒤 수주(0159)가 차림표 맨 앞에
   들어왔는데 이 자리는 그대로라, 레일의 «출하» 가 둘째 탭으로 열렸다. 이제 차림표(SHIPPING_NAV)의
   순서를 그대로 따른다 - 그 사람이 열 수 없는 탭은 건너뛴다.
--------------------------------------------------------------------------- */
export default async function ShippingIndex() {
  const user = await requireUser();
  const first = SHIPPING_NAV.find((n) => canOpen(n.href, user.seat, user.screens)) ?? SHIPPING_NAV[0];
  redirect(first.href);
}
