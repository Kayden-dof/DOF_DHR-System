// =============================================================================
// Q-Design 에서 온 사본입니다. **이 파일을 손으로 고치지 마세요.**
//
// 출처   D:/Claude/Q-Design/patterns/responsive.ts
// 갱신   cd D:/Claude/Q-Design
//        node tools/extract-all.mjs && node tools/sync.mjs --write
//
// 고칠 일이 생기면 Q-Design 의 원본을 고치고 추출기를 다시 돌립니다.
// 여기서 고치면 제품들의 화면·문서가 갈립니다.
// 아래 지문은 본문의 sha256 이고, 이 저장소의 검사가 대조합니다.
//
// q-design-nav-sha256: 8c546be994f4285663d26b8a6460f470666c27b3720abc72f6a361be05fb64fc
// =============================================================================
// q-design-header-end
/** Shared intrinsic sizing. Column counts are upper bounds, not viewport promises. */
export function responsiveColumns(
  columns?: number,
  minimum: number | string = "var(--qd-grid-min-width)",
  gap: number | string = "var(--qd-grid-gap)",
): string {
  const length = (value: number | string) => {
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0)
        throw new RangeError("Invalid grid length");
      return `${value}px`;
    }
    return value;
  };
  const min = length(minimum);
  if (columns === undefined)
    return `repeat(auto-fit, minmax(min(100%, ${min}), 1fr))`;
  if (!Number.isInteger(columns) || columns < 1)
    throw new RangeError("Invalid column count");
  const preferred = `calc((100% - ${columns - 1} * ${length(gap)}) / ${columns} - 0.5px)`;
  return `repeat(auto-fit, minmax(min(100%, max(${min}, ${preferred})), 1fr))`;
}
