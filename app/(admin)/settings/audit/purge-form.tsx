'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Msg } from '@/components/ui';
import type { FormState } from '@/lib/forms';
import { purgeLogs } from './actions';

/*
 * 시스템관리자에게만 그린다 (page.tsx). 확인란은 잘못 누르는 일을 막는다.
 *
 * 몇 건이 사라지는지와 마지막 백업을 그 자리에 적는다 (UI/UX 검수 2026-11-11).
 * 지운 기록은 백업 파일에만 남는다. 백업이 오래됐어도 막지 않는다 - 알린다.
 */
export default function PurgeForm({ auditCount, loginCount, lastBackup }: {
  auditCount: number | null; loginCount: number | null;
  /** 마지막 백업. 없으면 null */
  lastBackup: { at: string; daysAgo: number } | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(purgeLogs, {});
  const stale = !lastBackup || lastBackup.daysAgo >= 1;

  return (
    <div className="card py-4">
      <h2 className="text-sm font-semibold text-ink">감사추적 비우기</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        감사추적 <b className="tnum text-ink">{auditCount ?? '?'}</b>건과 로그인 실패 기록{' '}
        <b className="tnum text-ink">{loginCount ?? '?'}</b>건을 모두 지웁니다. 누가 언제 몇 건을
        비웠는지 한 줄만 남고, <b className="text-ink">되돌릴 수 없습니다.</b> 지운 기록은 백업
        파일에만 남습니다.
      </p>
      <p className={`mt-1 text-xs leading-relaxed ${stale ? 'font-bold text-warn' : 'text-muted'}`}>
        {lastBackup
          ? <>마지막 백업 {lastBackup.at}{lastBackup.daysAgo > 0 && ` (${lastBackup.daysAgo}일 전)`}.</>
          : <>받아 둔 백업이 없습니다.</>}
        {stale && <> 비우기 전에 <Link href="/settings/backup" className="underline">백업</Link>을 먼저 받으십시오.</>}
      </p>
      <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="purge-confirm" className="text-xs text-muted">
          확인란에 <b className="text-ink">비우기</b> 를 적습니다
        </label>
        <input id="purge-confirm" name="confirm" autoComplete="off"
               className="input w-28" />
        <button type="submit" disabled={pending} className="btn-danger">
          비우기
        </button>
      </form>
      <Msg state={state} />
    </div>
  );
}
