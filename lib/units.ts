/* ---------------------------------------------------------------------------
   함께 적을 단위 (0143 · 사용자 2026-11-20 «그럼 L 도 병용표기 해줘»)

   양의 정본은 늘 품목의 사용 단위다. 품목에 함께 적을 단위(alt_uom)와 그 1 단위가
   사용 단위로 얼마인지(alt_ratio)가 있으면, 그 양을 옆에 괄호로 덧붙인다.
     30% 과산화수소: 사용 단위 kg, alt L · 1.11  →  «2.22 kg (2 L)»

   서버와 클라이언트가 함께 부르므로 'use client' 파일에 두지 않는다.
--------------------------------------------------------------------------- */
export interface AltUnit {
  alt_uom?: string | null;
  alt_ratio?: string | number | null;
}

/** 함께 적을 양 «2 L». 함께 적을 단위가 없거나 양을 모르면 빈 글 */
export function altQty(qty: number | string | null | undefined, alt?: AltUnit | null): string {
  if (qty === null || qty === undefined || qty === '' || !alt?.alt_uom) return '';
  const ratio = Number(alt.alt_ratio);
  const n = Number(qty);
  if (!Number.isFinite(n) || !Number.isFinite(ratio) || ratio <= 0) return '';
  return `${+(n / ratio).toFixed(2)} ${alt.alt_uom}`;
}

/** 사용 단위 양 뒤에 붙일 « (2 L)». 없으면 빈 글 */
export function altSuffix(qty: number | string | null | undefined, alt?: AltUnit | null): string {
  const a = altQty(qty, alt);
  return a ? ` (${a})` : '';
}
