/* ---------------------------------------------------------------------------
   숫자에 든 항목

   요약 띠의 숫자를 가리키면 그 숫자가 무엇으로 이루어졌는지 뜬다. 뜻풀이가
   아니라 항목이다 — "진행 중인 배치 1건" 옆에는 그 배치가 무엇인지가 나와야
   하고, 항목 설명은 나올 자리가 아니다 (사용자 지시).

   경영 현황에만 있던 짜임을 여기로 옮겨 전 현황 화면이 같은 모양을 쓰게 한다.
   화면마다 각자 그리면 갈라진다 (§10 복제 금지).

   ── 자르면 자른다고 적는다 ────────────────────────────────────────────────
   띄우는 자리가 좁아 여덟 줄까지만 보인다. 그런데 잘라 놓고 말하지 않으면
   보는 사람은 그것이 전부인 줄 안다. 남은 수를 마지막 줄에 적는다.
--------------------------------------------------------------------------- */

export interface StatRow {
  left: React.ReactNode;
  sub?: React.ReactNode;
  right: React.ReactNode;
}

const LIMIT = 8;

/**
 * @param total 조회를 미리 잘라 왔다면 진짜 개수. 없으면 받은 만큼이 전부다.
 *              여기서 셈하면 잘라 온 배열의 길이를 전부인 줄 알고 적게 된다.
 */
export function statRows(items: StatRow[], empty: string, total?: number) {
  if (items.length === 0) return <span className="text-muted">{empty}</span>;

  const shown = items.slice(0, LIMIT);
  const rest = (total ?? items.length) - shown.length;

  return (
    <>
      <ul className="space-y-1">
        {shown.map((r, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              {r.left}
              {r.sub && <span className="ml-1.5 text-xs text-muted">{r.sub}</span>}
            </span>
            <span className="shrink-0 tnum font-semibold">{r.right}</span>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="mt-1.5 text-xs text-muted">외 {rest}건은 화면에서 봅니다</p>
      )}
    </>
  );
}

/** 번호 종류는 폭이 고른 글꼴로 둔다. 자리 수가 눈에 들어와야 견줄 수 있다 */
export function mono(v: string) {
  return <span className="font-mono text-xs">{v}</span>;
}
