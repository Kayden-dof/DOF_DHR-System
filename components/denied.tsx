import Link from 'next/link';

export default function Denied({ what, need, children }: {
  what: string;
  need: string;
  /** 왜 막혔는지 따로 설명할 것이 있으면. 없으면 역할 안내만 나온다 */
  children?: React.ReactNode;
}) {
  return (
    /*
     * data-denied 는 화면에 보이지 않는 표시다.
     *
     * 권한 매트릭스를 재는 도구가 "권한 없음" 이라는 낱말을 찾아 막힌 화면을
     * 가려내고 있었다. 그런데 그 낱말을 본문에 정당하게 담는 화면이 생기자
     * (설정 > 권한 의 범례) 그 화면이 스스로 막힌 것으로 잡혔다.
     *
     * 낱말은 어디에나 있을 수 있다. 막혔다는 사실은 이 부품이 그려졌다는
     * 것이므로, 부품 자체에 표를 달고 그것을 본다.
     */
    <div data-denied className="card mx-auto max-w-lg p-6 text-center">
      <p className="chip mx-auto bg-danger-bg text-danger">권한 없음</p>
      <h1 className="mt-3 text-base font-semibold text-ink">{what}</h1>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {children ?? <>{need} 역할이 필요합니다. 필요하면 시스템관리자에게 역할 부여를 요청하십시오.</>}
      </p>
      <Link href="/" className="btn-ghost mt-4">
        현황으로
      </Link>
    </div>
  );
}

/*
 * 인쇄 화면이 막혔을 때 (lib/print.ts printGate). 인쇄 화면 여덟이 같은 글을
 * 저마다 적고 있었다 - 한 곳에 둔다 (최적화 2026-11-25). 그리는 것은 전과 같다.
 */
export function PrintDenied() {
  return (
    <Denied what="인쇄물" need="생산관리자 · 시스템관리자 또는 품질책임자">
      이미 나간 종이는 인쇄 이력의 <b>보기</b>로 여십시오.
    </Denied>
  );
}
