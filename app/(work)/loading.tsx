/* 현장 화면은 타일이 크므로 뼈대도 타일 모양으로 둔다. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="불러오는 중">
      <div className="space-y-2.5">
        <div className="h-7 w-44 animate-pulse rounded bg-canvas-deep" />
        <div className="h-4 w-72 animate-pulse rounded bg-canvas-deep/70" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card overflow-hidden">
            <div className="space-y-2.5 px-5 pb-3 pt-4">
              <div className="h-6 w-40 animate-pulse rounded bg-canvas-deep" />
              <div className="h-4 w-56 animate-pulse rounded bg-canvas-deep/60" />
            </div>
            <div className="grid grid-cols-3 gap-px border-t border-line-soft bg-line-soft">
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="space-y-2 bg-surface px-5 py-3">
                  <div className="h-3 w-12 animate-pulse rounded bg-canvas-deep/60" />
                  <div className="h-4 w-16 animate-pulse rounded bg-canvas-deep" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
