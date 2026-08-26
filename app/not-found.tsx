import Link from 'next/link';
import { Wordmark } from '@/components/logo';

/* 없는 번호를 눌렀을 때. 무엇을 찾으려 했는지 다시 물어볼 길을 준다. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-5 py-12">
      <div className="w-full max-w-md text-center">
        <Wordmark className="mx-auto h-6 w-auto" />
        <h1 className="mt-7 text-[1.375rem] font-bold text-ink">
          그 번호로는 찾을 수 없습니다
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-muted">
          주소가 잘못되었거나, 취소된 지시서일 수 있습니다.
          번호는 재사용하지 않으므로 취소된 번호는 빈자리로 남습니다.
        </p>
        <div className="mt-7 flex justify-center gap-2">
          <Link href="/" className="btn-primary">현황으로</Link>
          <Link href="/trace" className="btn-ghost">로트 조회</Link>
        </div>
      </div>
    </main>
  );
}
