// =============================================================================
// DOF Design 시스템 · 반응형 칸 셈
//
// 2026-11-09 부터 DHR 화면은 Q-Design 과 별개인 DOF Design 시스템이다 (사용자 지시).
// 이 파일은 그날 Q-Design 사본(patterns/responsive.ts)에서 갈라져 나왔고, 이제 이 저장소가
// 원본이다. 고칠 일이 있으면 여기서 고친다. Q-Design 에서 다시 받지 않는다.
// =============================================================================
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
