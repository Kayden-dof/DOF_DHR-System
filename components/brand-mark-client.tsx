'use client';

/* ---------------------------------------------------------------------------
   클라이언트에서 부르는 회사 표시 (§2.0)

   `components/brand-mark.tsx` 의 BrandMark 는 서버에서 설정을 읽는다. 그런데
   `app/error.tsx` 는 클라이언트 부품이어야 한다 (React 가 그렇게 요구한다).
   거기서는 설정을 읽을 수 없다.

   그래서 뿌리 배치가 이미 :root 로 내려보낸 값을 그대로 쓴다.

     --brand-logo     로고가 있으면 url(...) · 없으면 none
     --brand-company  로고가 없을 때만 회사 이름. 있으면 빈 글

   둘을 겹쳐 두면 어느 쪽이든 눈에 보이는 것은 하나다. 갈래를 자바스크립트로
   나누지 않으므로 첫 HTML 에서 이미 맞다.

   ── 지어내지 않는다 ───────────────────────────────────────────────────────
   로고도 이름도 없으면 아무것도 그리지 않는다. BrandMark 와 같은 규칙이다.
--------------------------------------------------------------------------- */

export function BrandMarkClient({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`brand-css display leading-none ${className ?? ''}`}
    />
  );
}
