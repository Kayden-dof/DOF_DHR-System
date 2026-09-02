/* ---------------------------------------------------------------------------
   장을 우리가 가른다 (4차 감사 B2)

   §7 은 "몇 장이 될지 재어 맞히지 않는다" 고 못 박았다. 그런데 제조기록서가
   A4 297mm 에서 여백을 빼고 한 줄 15mm 로 셈해 장수를 **예측**하고 그 수를
   종이에 찍고 있었다.

   예측이 크면 있지도 않은 2쪽이 생기고, 편철 표지가 그 수를 매수로 옮겨 적어
   검토자가 없는 종이를 찾는다. 예측이 작으면 브라우저가 자른 뒷장에 배치번호도
   자료 식별자도 쪽 번호도 없이 나간다. 나머지 양식은 N 이 1 로 고정이라
   서명란이 실린 둘째 장이 아무 표시 없이 편철됐다.

   줄을 우리가 나눠 장에 담으면 장 수가 곧 결과다. 어긋날 수가 없다.

   아래 값은 "브라우저가 몇 줄을 넣을까" 라는 예측이 아니라 "우리가 한 장에
   몇 줄을 담을까" 라는 결정이다. 넉넉히 잡으면 장이 하나 늘 뿐이고, 늘어난
   장에도 머리글과 쪽 번호가 붙는다.
--------------------------------------------------------------------------- */

/** 줄을 장에 나눠 담는다. 첫 장은 머리 표가 자리를 먹으므로 적게 담는다 */
export function chunkRows<T>(xs: T[], first: number, next: number): T[][] {
  if (xs.length === 0) return [[]];
  const out = [xs.slice(0, first)];
  for (let i = first; i < xs.length; i += next) out.push(xs.slice(i, i + next));
  return out;
}

/**
 * 무게를 재어 담는다.
 *
 * 작업 지시서의 공정 표는 자재 수만큼 rowSpan 이 걸려 있어, 줄 가운데를
 * 자르면 표가 깨진다. 공정 단위로 담되 그 공정이 차지하는 줄 수를 무게로
 * 삼는다.
 */
export function chunkByWeight<T>(
  xs: T[], weight: (x: T) => number, first: number, next: number,
): T[][] {
  if (xs.length === 0) return [[]];
  const out: T[][] = [[]];
  let budget = first;
  let used = 0;
  for (const x of xs) {
    const w = Math.max(1, weight(x));
    if (used > 0 && used + w > budget) {
      out.push([]);
      budget = next;
      used = 0;
    }
    out[out.length - 1].push(x);
    used += w;
  }
  return out;
}
