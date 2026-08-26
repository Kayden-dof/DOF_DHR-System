'use client';

import { useRouter } from 'next/navigation';

/* ---------------------------------------------------------------------------
   행 전체가 링크인 목록

   처음에는 마지막 칸에 "열기" 단추를 두었는데, 행 전체가 갈 곳 하나를 가리키는
   목록에서 그 단추는 겨냥 연습일 뿐이다. 행 어디를 눌러도 들어가게 하고,
   끝에 옅은 화살표 하나로 눌린다는 것만 알린다.

   tr 은 a 로 감쌀 수 없어서 클릭을 코드로 잇는다. 그러면서 잃기 쉬운 것들을
   챙긴다.

     · 로트번호를 긁어 복사하는 중이면 이동하지 않는다. 이 화면의 번호는
       복사해서 대조하는 값이다
     · Ctrl/Cmd 클릭은 새 탭이다. 배치 두 개를 나란히 놓고 비교하는 일이 있다
     · 키보드로도 들어간다. 행이 초점을 받고 Enter 로 연다
--------------------------------------------------------------------------- */
export function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();

  function open(e: React.MouseEvent) {
    if (window.getSelection()?.toString()) return;   // 긁는 중이다
    if (e.ctrlKey || e.metaKey) { window.open(href, '_blank'); return; }
    router.push(href);
  }

  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter') router.push(href); }}
      className="group cursor-pointer"
    >
      {children}
      <td aria-hidden className="td sticky right-0 w-0 bg-surface text-right">
        <span className="text-base leading-none text-faint transition-colors group-hover:text-brand">
          &rsaquo;
        </span>
      </td>
    </tr>
  );
}
