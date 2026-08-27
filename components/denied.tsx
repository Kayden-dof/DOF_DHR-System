import Link from 'next/link';

export default function Denied({ what, need, children }: {
  what: string;
  need: string;
  /** 왜 막혔는지 따로 설명할 것이 있으면. 없으면 역할 안내만 나온다 */
  children?: React.ReactNode;
}) {
  return (
    <div className="card mx-auto max-w-lg p-6 text-center">
      <p className="chip mx-auto bg-danger-bg text-danger">권한 없음</p>
      <h1 className="mt-3 text-base font-bold text-ink">{what}</h1>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {children ?? <>{need} 역할이 필요합니다. 필요하면 시스템관리자에게 역할 부여를 요청하십시오.</>}
      </p>
      <Link href="/" className="btn-ghost mt-4">
        현황으로
      </Link>
    </div>
  );
}
