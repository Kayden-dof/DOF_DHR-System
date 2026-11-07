import Link from 'next/link';
import type { Fix } from '@/lib/unblock';

/* ---------------------------------------------------------------------------
   막힌 까닭 한 줄과 푸는 자리로 가는 단추 하나 (lib/unblock.ts)

   비활성 단추 바로 아래에 둔다. 까닭은 "무엇이 비었는가" 이고, 단추 글은
   "거기 가서 무엇을 하는가" 다 - 화면 이름만 적으면 가서 또 찾아야 한다.

   그 화면을 못 여는 사람에게는 단추를 내지 않고 누구에게 열린 화면인지를
   적는다. 누르고 나서 권한 없음을 보게 하지 않는다.
--------------------------------------------------------------------------- */
export function Unblock({
  why, fix, todo, align = 'end', className = '',
}: {
  why?: React.ReactNode;
  fix?: Fix | null;
  /** 단추 글. "제품표준서 서면 확인하기" 처럼 가서 할 일 */
  todo: string;
  align?: 'start' | 'end';
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs leading-relaxed
                     ${align === 'end' ? 'justify-end text-right' : ''} ${className}`}>
      {why && <span className="text-muted">{why}</span>}
      {fix && (fix.href ? (
        /* 정본 이동 글귀(.qd-text-action--go · 먹색 · 600 · 끝 꺾쇠). 막힌 단추 옆의 «가서 할 일» 이다 */
        <Link href={fix.href} className="qd-text-action qd-text-action--go" title={fix.place}>
          {todo}
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor"
               strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </Link>
      ) : (
        <span className="text-faint">
          {fix.place}에서 합니다. 이 화면은 {fix.who || '관리자'}에게 열려 있습니다.
        </span>
      ))}
    </div>
  );
}
