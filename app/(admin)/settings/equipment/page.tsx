import { redirect } from 'next/navigation';

/* 설비는 제 메뉴로 올라갔다 (2026-08-27). 옛 주소로 온 사람을 넘겨보낸다. */
export default function MovedToEquipment() {
  redirect('/equipment');
}
