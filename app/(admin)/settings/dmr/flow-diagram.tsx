import type { OperationRow } from './dmr-forms';

/* ---------------------------------------------------------------------------
   제조 공정도

   공정을 표로만 늘어놓으면 "이 제품이 어떻게 만들어지는가"가 안 보인다.
   열두 줄을 눈으로 훑어 순서를 머리에 다시 세워야 한다. 흐름은 흐름으로
   보여 준다 (사용자 요청).

   ── 무엇을 그리는가 ───────────────────────────────────────────────────────
   이 구조의 중심은 재단이다 (§3). 재단 전은 배치 하나가 통째로 흐르고, 재단
   후는 형명별 제품 로트로 갈라져 각각 흐른다. 그림이 그 갈라짐을 보여 주지
   못하면 표와 다를 바가 없다.

     · 재단 이전 공정   한 줄기. 왼쪽 띠는 배치 단위임을 뜻한다
     · 재단             갈라지는 자리. 굵게 표시하고 그 뒤로 단위가 바뀐다
     · 재단 이후 공정   제품 로트 단위. 들여쓰고 띠 색을 바꾼다

   공정마다 자재 종수와 걸린 설비를 함께 적는다. 셋업하는 사람이 "어디에 아직
   자재를 안 넣었나"를 그림에서 바로 본다.

   ── 왜 SVG 가 아닌가 ──────────────────────────────────────────────────────
   공정 수가 제품마다 다르고 이름 길이도 제각각이다. SVG 로 좌표를 잡으면 긴
   이름이 넘치거나 칸이 겹친다. 흐르는 글상자로 두면 어떤 길이에도 무너지지
   않고 인쇄에서도 그대로 나온다.
--------------------------------------------------------------------------- */

export default function FlowDiagram({
  operations, equipmentByOp,
}: {
  operations: OperationRow[];
  /** 공정 id -> 걸린 설비 코드들 */
  equipmentByOp: Map<string, string[]>;
}) {
  if (operations.length === 0) return null;

  /*
   * 어느 공정이 갈림인가를 **구조로** 찾는다 (6차 감사 N5).
   *
   * 전에는 이름에 '재단' 이 들어가는지로 골랐다. 그 공정을 '절단' 이라 부르는
   * 제조소에서는 갈림 표시가 사라지고, 무엇보다 **DB 와 정의가 달랐다** -
   * cut_operation_id() 는 "재단 이후 공정이 하나라도 있을 때, 그 이전 공정 중
   * 마지막" 으로 찾는다. 같은 것을 두 곳이 다르게 정하면 둘 다 못 믿는다.
   *
   * 여기서도 같은 셈을 쓴다. 이름은 보지 않는다.
   */
  const hasAfter = operations.some((o) => o.after_cutting);
  const cutIndex = hasAfter
    ? operations.map((o) => o.after_cutting).lastIndexOf(false)
    : -1;

  return (
    <div className="px-4 py-4">
      <ol className="space-y-0">
        {operations.map((op, i) => {
          const isCut = i === cutIndex;
          const after = op.after_cutting;
          const eq = equipmentByOp.get(op.id) ?? [];
          const last = i === operations.length - 1;

          return (
            <li key={op.id} className={after ? 'ml-6' : undefined}>
              {/* 재단 뒤에서 단위가 바뀐다. 그 사실을 한 줄로 알린다 */}
              {isCut && (
                <p className="mb-1.5 mt-1 text-[0.6875rem] font-bold tracking-wide text-brand">
                  여기서 형명별로 갈립니다 · 이후 기록은 제품 로트에 붙습니다
                </p>
              )}

              <div className="flex items-stretch gap-3">
                {/* 세로 줄기. 마지막 공정에서 끊는다 */}
                <div className="flex w-4 shrink-0 flex-col items-center">
                  <span
                    aria-hidden
                    className={`size-2.5 shrink-0 rounded-full ${
                      isCut ? 'bg-brand ring-4 ring-brand-tint'
                        : after ? 'bg-brand-pale' : 'bg-line-strong'
                    }`}
                  />
                  {!last && (
                    <span aria-hidden
                          className={`w-px flex-1 ${after ? 'bg-brand-line' : 'bg-line'}`} />
                  )}
                </div>

                <div className={`mb-2 min-w-0 flex-1 rounded-md border px-3 py-2 ${
                  isCut ? 'border-brand bg-brand-soft'
                    : after ? 'border-brand-line bg-surface' : 'border-line bg-surface'
                }`}>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="tnum text-xs text-faint">{op.seq}</span>
                    <span className={`text-sm ${isCut ? 'font-bold text-brand-deep' : 'font-semibold text-ink'}`}>
                      {op.name}
                    </span>
                    <code className="font-mono text-[0.6875rem] text-faint">{op.code}</code>
                    {/* 보통 몇 일차. 흐름을 보며 며칠짜리인지 가늠하게 한다 */}
                    {op.typical_day !== null && (
                      <span className="tnum text-[0.6875rem] text-muted">
                        보통 {op.typical_day}일차
                      </span>
                    )}
                  </div>

                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.6875rem]">
                    {op.bom.length > 0 ? (
                      <span className="text-muted">
                        자재 {op.bom.map((b) => b.item_name).join(' · ')}
                      </span>
                    ) : (
                      <span className="text-faint">자재 없음</span>
                    )}
                    {eq.length > 0 && (
                      <span className="font-mono text-brand">{eq.join(' · ')}</span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-1 text-xs leading-relaxed text-muted">
        재단 이전 공정은 기록이 <b className="text-ink">배치</b>에, 이후 공정은
        <b className="text-ink"> 제품 로트</b>에 붙습니다. 들여쓴 공정이 제품 로트
        단위입니다.
      </p>
    </div>
  );
}
