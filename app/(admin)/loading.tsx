/* ---------------------------------------------------------------------------
   불러오는 동안

   화면을 바꾸는 사이 아무것도 없으면 눌린 건지 아닌지를 모른다. 자리만 잡아
   두고 실제 자료가 오면 그대로 채워진다. 숫자를 흉내 내지 않는다. 흐릿한
   숫자를 잠깐이라도 보여 주면 그걸 읽는 사람이 생긴다.
--------------------------------------------------------------------------- */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="불러오는 중">
      <div className="flex items-end justify-between gap-4 border-b border-line pb-4">
        <div className="space-y-2.5">
          <div className="h-6 w-40 animate-pulse rounded bg-canvas-deep" />
          <div className="h-3.5 w-72 animate-pulse rounded bg-canvas-deep/70" />
        </div>
        <div className="h-9 w-56 animate-pulse rounded-lg bg-canvas-deep/70" />
      </div>

      <div className="card overflow-hidden">
        <div className="section-head">
          <div className="h-3.5 w-28 animate-pulse rounded bg-canvas-deep" />
        </div>
        <div className="divide-y divide-line-soft">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-3.5 w-28 animate-pulse rounded bg-canvas-deep/70" />
              <div className="h-3.5 flex-1 animate-pulse rounded bg-canvas-deep/40" />
              <div className="h-3.5 w-16 animate-pulse rounded bg-canvas-deep/40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
