import Link from 'next/link';
import { withActor } from '@/lib/db';
import { redirect } from 'next/navigation';
import { requireUser, idleLockOff } from '@/lib/session';
import { isAdmin, isWorker } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { BrandCopyright, SystemName } from '@/components/brand-mark';
import { yearKST } from '@/lib/kst';
import Watermark, { stamp } from '@/components/watermark';
import BackFab from '@/components/back-fab';
import DemoBanner from '@/components/demo-banner';
import { logout } from './actions';
import IdleLock from '@/components/idle-lock';
import { lockMinutes } from '@/lib/idle-lock';
import Clock from '@/components/clock';
import { RoleSwitch } from '@/components/role-picker';

/* ---------------------------------------------------------------------------
   현장 화면

   장갑 낀 손으로 패드를 쓴다. 전제가 관리 화면과 다르다.

     · 키보드를 쓰지 않는다. 숫자는 패드, 선택은 큰 타일, 사유는 미리 정한 문구
     · 최소 조작 크기 56px (.touch가 --tap을 올린다)
     · 한 화면에 한 가지 일만 둔다. 목록과 입력을 겹치지 않는다
     · 되돌릴 수 없는 조작(마감·인쇄) 앞에는 확인 단계를 둔다

   자유 입력이 꼭 필요한 곳은 관리 화면으로 넘긴다.

   상단에 오늘 날짜와 이름을 크게 둔다. 현장 패드는 여러 사람이 번갈아 쓰므로
   지금 누구로 들어와 있는지가 한눈에 보여야 한다. 남의 계정으로 기록이 남으면
   되돌릴 방법이 없다.
--------------------------------------------------------------------------- */

export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  /* 시연 자료가 들어 있으면 모든 화면 맨 위에 알린다 (0049) */
  const demo = await withActor(user.id, (db) =>
    db.val<string>(`select seeded_at::text from demo_marker limit 1`));


  /*
   * 문은 고른 역할(seat)로 가린다 (사용자 요청 2026-11-20). 역할이 하나인
   * 계정은 seat 가 곧 가진 역할이라 전과 같다.
   */
  const seat = user.seat;
  if (!isWorker(seat) && !isAdmin(seat)) redirect('/no-role');

  /* 역할이 둘 이상이면 이름 옆에 역할 바꾸기를 둔다. 관리 화면으로 가는 길도 이것이다 */
  const many = user.roles.length > 1;
  const chosen = many && seat.length === 1 ? seat[0] : undefined;

  return (
    <div className="touch flex min-h-screen flex-col bg-canvas">
      {/*
        * 현장 화면에서는 알리기만 한다. 비우는 일은 사무 화면에서 한다 -
        * 장갑 낀 손이 오가는 자리에 되돌릴 수 없는 단추를 두지 않는다.
        */}
      <DemoBanner seededAt={demo ?? null} canPurge={false} />

      <header className="band-solid sticky top-0 z-20">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
          <Link href="/work" className="flex h-14 shrink-0 items-center gap-3" aria-label="배치 목록으로">
            {/* 어두운 바탕용 그림은 여백이 더 넓어 상자를 더 크게 잡는다 */}
            <BrandMark className="h-9 w-auto text-lg" />
            <span className="h-5 w-px bg-line-strong" aria-hidden />
            <SystemName className="display text-lg leading-none text-ink" />
            <span className="chip bg-surface text-ink">현장</span>
          </Link>

          {/*
            * 날짜와 시각. 공정을 시작하고 끝낼 때 이 값을 종이에 적으므로
            * 화면이 말하는 시각과 기록에 남는 시각이 같아야 한다
            * (components/clock.tsx).
            */}
          <Clock withDate className="hidden text-sm text-muted sm:inline" />

          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid h-11 w-11 place-items-center rounded-full bg-brand-tint text-base font-semibold text-brand"
              >
                {user.full_name.slice(0, 1)}
              </span>
              <div className="leading-tight">
                <div className="text-base font-semibold text-ink">{user.full_name}</div>
                <div className="text-xs text-muted">
                  {isAdmin(seat) ? '관리자' : '작업자'}
                </div>
              </div>
            </div>

            {many && <RoleSwitch roles={user.roles} current={chosen} className="btn-ghost" />}
            {isAdmin(seat) && (
              <Link href="/"
                    className="btn-ghost">
                관리 화면
              </Link>
            )}
            {/* 비밀번호 · 잠금 시간 (사용자 2026-11-25 «내 계정 설정은 어디있어..?») */}
            <Link href="/work/me" className="btn-ghost">
              내 설정
            </Link>
            <form action={logout}>
              <button type="submit"
                      className="btn-ghost">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 py-6">{children}</main>

      {/*
        * 자리 비움 잠금. 로그아웃이 아니라 화면만 덮는다. 세션은 8시간 그대로다.
        * 시간은 공정 대기 시간을 보고 정해야 한다. 초임계 가공처럼 오래 도는
        * 공정이 있으면 더 길어야 한다.
        *
        * 관리자로 앉아 자동 잠금을 끈 계정만 빠진다 (0153). 작업자로 앉은 세션은
        * 늘 잠근다 (idleLockOff).
        *
        * 시간은 본인이 내 설정에서 고른다 (0157). 고르지 않았으면 20분, 길어도 30분 -
        * 여러 사람이 번갈아 쓰는 패드다 (lib/idle-lock.ts).
        */}
      {!idleLockOff(user) && (
        <IdleLock minutes={lockMinutes('pad', user.idle_lock_pad_min)}
                  sid={String(user.issued_at)} name={user.full_name} initial={user.full_name.slice(0, 1)} />
      )}

      <footer className="mx-auto w-full max-w-[1240px] px-5 pb-8 pt-4">
        <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
          <span className="opacity-30">
            <BrandMark className="h-3.5 w-auto text-sm" />
          </span>
          <p className="text-xs text-faint">
            <BrandCopyright year={yearKST()} />
          </p>
        </div>
      </footer>

      {/* 감사 04. 현장 패드는 여러 사람이 번갈아 쓴다. 바탕이 어두우니 밝게 깐다 */}
      <Watermark text={stamp(user.full_name, user.login_code)} />

      {/*
        * 홈 화면에서 전체 화면으로 띄우면 브라우저 뒤로가기가 없다.
        * 첫 화면에서는 스스로 숨는다 (components/back-fab.tsx).
        */}
      <BackFab />
    </div>
  );
}
