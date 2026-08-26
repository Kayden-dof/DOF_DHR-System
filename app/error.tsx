'use client';

import Link from 'next/link';
import { Wordmark } from '@/components/logo';

/* ---------------------------------------------------------------------------
   오류 화면

   무엇이 저장되고 무엇이 저장되지 않았는지를 먼저 말한다. 현장에서 오류를 보면
   가장 먼저 하는 걱정이 "방금 쓴 게 날아갔나"이기 때문이다.

   DB가 거부한 것이라면 그건 규칙이 작동한 것이므로 그 문구를 그대로 보여 준다.
   우리가 다시 쓰지 않는다.
--------------------------------------------------------------------------- */
export default function ErrorScreen({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-5 py-12">
      <div className="w-full max-w-lg">
        <Wordmark className="h-6 w-auto" />

        <h1 className="mt-7 text-[1.375rem] font-bold text-ink">
          화면을 그리지 못했습니다
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-muted">
          이미 저장된 기록은 그대로 있습니다. 화면을 그리는 중에 멈춘 것이라
          기록이 지워지지는 않습니다. 다만 방금 누른 것이 저장되었는지는
          목록에서 확인하십시오.
        </p>

        {error.message && (
          <pre className="mt-5 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-danger-line bg-danger-bg px-3.5 py-3 text-xs leading-relaxed text-danger">
            {error.message}
          </pre>
        )}
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-faint">식별자 {error.digest}</p>
        )}

        <div className="mt-7 flex flex-wrap gap-2">
          <button onClick={reset} className="btn-primary">다시 시도</button>
          <Link href="/" className="btn-ghost">현황으로</Link>
        </div>
      </div>
    </main>
  );
}
