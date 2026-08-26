/* ---------------------------------------------------------------------------
   DOF 로고

   사내 CI 원본(next DOF LOGO_type 1.ai)의 벡터 좌표를 그대로 옮겼다.
   글자를 다시 그리거나 비슷한 글꼴로 흉내 내지 않는다. 로고는 회사 자산이라
   임의로 변형하면 안 되고, 벡터라 어떤 배율에서도 깨지지 않는다.

   원본은 PDF 좌표계(y가 위로 증가)라 그룹 하나로 뒤집어 쓴다. 좌표를 손으로
   계산해 옮겨 적으면 옮기다 틀리므로 원본 수치를 그대로 둔다.

   ArtBox  x 61.0284 ~ 264.956 · y 51.3828 ~ 147.042 (MediaBox 높이 198.425)
--------------------------------------------------------------------------- */

const VIEW = '61.0284 51.383 203.9276 95.659';

/** DOF 워드마크. 자주색과 회색 두 도형이 오른쪽 위 깃발을 이룬다. */
export function Wordmark({
  className, purple = 'var(--color-brand)', gray = 'var(--color-ci-gray)',
  title = 'DOF',
}: { className?: string; purple?: string; gray?: string; title?: string }) {
  return (
    <svg viewBox={VIEW} className={className} role="img" aria-label={title}
         xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0 198.425) scale(1 -1)">
        {/* 깃발 자주 */}
        <path fill={purple} d="M224.6202 147.0424 L224.6202 126.8744 L264.9562 126.8744 L264.9562 147.0424 Z" />
        {/* 깃발 회색 */}
        <path fill={gray} d="M244.788 106.707 L264.956 106.707 L264.956 126.875 L244.788 126.875 Z" />
        {/* F */}
        <path fill={purple} d="M181.3278 53.1194 L195.7608 53.1194 L195.7608 71.8964 L221.9148 71.8964
                                L221.9148 84.1894 L195.7608 84.1894 L195.7608 93.4584 L224.6198 93.4584
                                L224.6198 106.7064 L181.3278 106.7064 Z" />
        {/* O */}
        <path fill={purple} fillRule="nonzero" d="
          M146.0408 66.0064
          C138.3608 66.0064 132.1338 72.2304 132.1338 79.9124
          C132.1338 87.5954 138.3608 93.8194 146.0408 93.8194
          C153.7228 93.8194 159.9478 87.5954 159.9478 79.9124
          C159.9478 72.2304 153.7228 66.0064 146.0408 66.0064 Z
          M146.0408 108.4434
          C130.2828 108.4434 117.5108 95.6734 117.5108 79.9124
          C117.5108 64.1524 130.2828 51.3824 146.0408 51.3824
          C161.7988 51.3824 174.5708 64.1524 174.5708 79.9124
          C174.5708 95.6734 161.7988 108.4434 146.0408 108.4434 Z" />
        {/* D */}
        <path fill={purple} fillRule="nonzero" d="
          M82.8005 66.3673 L75.4615 66.3673 L75.4615 93.4583 L82.8005 93.4583
          C90.2585 93.4583 96.4165 87.5563 96.4165 79.9133
          C96.4165 72.2693 90.1705 66.3673 82.8005 66.3673 Z
          M84.7545 106.7063 L61.0285 106.7063 L61.0285 53.1193 L84.7545 53.1193
          C99.4265 53.3143 111.1675 65.1963 111.1675 79.9133
          C111.1675 94.6303 99.4265 106.5113 84.7545 106.7063 Z" />
      </g>
    </svg>
  );
}

/**
 * 어두운 바탕에 얹는 반전형. 법인 로고(BI 정방)가 쓰는 방식이라
 * 글자를 흰색으로 두고 깃발 회색만 한 단계 밝힌다.
 */
export function WordmarkOnDark({ className }: { className?: string }) {
  return <Wordmark className={className} purple="#FFFFFF" gray="rgba(255,255,255,.55)" />;
}

/**
 * 워드마크에 서술어를 붙인 조합형. 로그인 화면처럼 회사를 처음 보여 주는
 * 자리에만 쓴다. 화면 안쪽에서는 워드마크만 쓴다.
 */
export function Lockup({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 ${className ?? ''}`}>
      <Wordmark className="h-9 w-auto" />
      <span className="h-8 w-px bg-line" aria-hidden />
      <span className="text-[11px] font-medium leading-[1.45] tracking-tight text-muted">
        Regenerative
        <br />
        Healthcare Platform
      </span>
    </div>
  );
}
