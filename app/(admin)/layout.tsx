import Link from 'next/link';
import { withActor } from '@/lib/db';
import { redirect } from 'next/navigation';
import { requireUser, hasRole, ROLE_LABEL } from '@/lib/session';
import { isAdmin, isWorker, isViewerOnly, isQpOnly } from '@/lib/roles';
import { canOpen } from '@/lib/access';
import { cookies, headers } from 'next/headers';
import { PATH_HEADER } from '@/lib/auth-const';
import Watermark, { stamp } from '@/components/watermark';
import BackFab from '@/components/back-fab';
import DemoBanner from '@/components/demo-banner';
import FindUnit from '@/components/find-unit';
import { BrandMark, BrandMonogram, BrandCopyright, SystemName } from '@/components/brand-mark';
import { yearKST } from '@/lib/kst';
import IdleLock from '@/components/idle-lock';
import { logout } from './actions';
import { type NavItem } from './nav';
import Clock from '@/components/clock';
import Rail from './rail';
import { RAIL_COOKIE_PREFIX } from '@/lib/rail';
import { APP_VERSION } from '@/lib/version';

/* ---------------------------------------------------------------------------
   관리 화면

   키보드와 마우스를 쓰는 사무 환경을 전제한다. 밀도를 높이고 표를 많이 쓴다.
   현장 패드용 화면은 /work 쪽이며 조작 크기가 다르다.

   셸은 DOF Design 시스템의 레일이다 (오너 결정 2026-11-07 «A»). 왼쪽 레일이
   척추이고 본문 위에는 띠를 두지 않는다 - 머리줄이 없으니 표가 밀려 내려가지
   않는다. 1024px 미만은 레일이 서랍이 된다 (./rail.tsx).
--------------------------------------------------------------------------- */

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  /* 시연 자료가 들어 있으면 모든 화면 맨 위에 알린다 (0049) */
  /*
   * 표식과 함께 "지금 비울 수 있는가" 도 묻는다. only_demo_data() 는 표식 이후
   * 감사추적이 조용할 때만 참이라, 이관을 한 번이라도 돌리면 닫힌다. 닫힌 문
   * 앞에 단추를 걸어 두면 누르는 사람만 헛수고한다 (2026-08-31 확인).
   */
  const demo = await withActor(user.id, async (db) => ({
    seededAt: await db.val<string>(`select seeded_at::text from demo_marker limit 1`),
    gateOpen: await db.val<boolean>(`select only_demo_data()`),
  }));

  /* ---------------------------------------------------------------------------
     지정 자리 밖에서 두드린 것 (0110 · 사용자 지시 2026-09-11)

     설정 > 개요에 목록을 두었더니 **그 화면을 열어야 보였다.** 알림은 찾아가서
     보는 것이 아니라 눈에 들어오는 것이라야 한다. 그래서 머리줄에 따로 건다.

     세는 것은 **계정을 들고 두드린 것뿐이다** (0110). 익명 두드림까지 세면
     표시가 늘 켜져 있고, 늘 켜져 있는 표시는 알림이 아니라 가구다.

     묻는 사람을 좁힌다. 이 표시는 개발계정과 시스템관리자의 것이고, 다른
     사람에게는 할 일이 아니다. 질의도 그때만 돈다 - 머리줄은 화면마다
     다시 그려지므로 아무에게나 한 번씩 더 묻게 두지 않는다.
  --------------------------------------------------------------------------- */
  const watches = user.is_developer || hasRole(user, 'SYS_ADMIN');
  const outside = watches
    ? (await withActor(user.id, (db) =>
        db.val<number>(`select access_block_alert()`))) ?? 0
    : 0;


  /*
   * 작업자 전용 계정은 현장 화면으로 보낸다. 열람자는 여기 남는다 - 볼 것이
   * 이 화면들에 있고, 쓰는 단추는 화면마다 감춘다.
   */
  const viewer = isViewerOnly(user.roles);
  /*
   * 품질책임자도 들인다 (사용자 결정 2026-09-01). 판정하려면 지금 무엇을
   * 기준으로 돌고 있는지를 봐야 한다. 세션은 읽기 전용이다 (lib/roles.ts).
   */
  const qp = isQpOnly(user.roles);

  /*
   * 관리 화면 그룹 전체의 문이다.
   *
   * 여기까지 오는 역할이 아니어도 **관리자가 이 화면을 열어 주었으면 들인다**
   * (0116). 그러지 않으면 계정별 배정으로 열어 준 자리가 이 한 줄에 막혀
   * 아무 뜻이 없다.
   *
   * 경로는 미들웨어가 실어 준다 (proxy.ts).
   */
  const here = (await headers()).get(PATH_HEADER);
  const opened = here ? user.screens.get(here) === true : false;
  if (!isAdmin(user.roles) && !viewer && !qp && !opened) {
    redirect(isWorker(user.roles) ? '/work' : '/no-role');
  }

  /*
   * 열람자 메뉴는 셋뿐이다 (사용자 지시).
   *
   * 오늘 · 이번 달 숫자와 개체 번호 찾기는 경영 현황 한 장에 다 있다. 배치를
   * 눌러 들어가는 일이 있으므로 생산을 남기고, 누가 무엇을 고쳤는지는 경영진이
   * 보는 것이 자연스러워 감사추적을 남긴다.
   *
   * 자재 · 설비 · 출하 · 조회는 운영하는 사람의 화면이다. 볼 것이 없어서가
   * 아니라, 볼 것을 넷으로 줄여야 그 넷이 눈에 들어오기 때문이다.
   */
  /*
   * 품질책임자 메뉴는 열람자와 다르다. 열람자(대표)는 숫자를 보고, 품질책임자는
   * 기준을 본다 - 어느 제품표준서 개정이 발효 중인지, 자재 구성표에 무엇이
   * 걸려 있는지, 설비 밸리데이션이 언제까지인지.
   */
  const items: NavItem[] = qp
    ? [
        { href: '/production', label: '생산' },
        /*
         * 제품표준서는 머리줄에 남긴다. 품질책임자가 매일 여는 자리라 한 칸
         * 안으로 들이면 그만큼 매번 멀어진다.
         */
        { href: '/settings/dmr', label: '제품표준서' },
        { href: '/equipment', label: '설비' },
        { href: '/material', label: '자재' },
        { href: '/trace', label: '조회' },
        /*
         * 감사추적이 있던 자리에 설정을 둔다 (사용자 지시 2026-09-01).
         *
         * 채번 규칙과 사용자가 새로 열리면서 머리줄에 자리가 없는 화면이
         * 둘 생겼다. 낱낱이 올리면 일곱 칸이 되고, 그 일곱이 서로를 가린다.
         * 감사추적 · 공급자 · 채번 규칙 · 사용자는 전부 설정 아래에 있으므로
         * 문 하나로 모은다. 하위 차림표는 이 사람이 여는 것만 낸다.
         */
        { href: '/settings', label: '설정' },
      ]
    : viewer
    ? [
        /*
         * 경영열람은 대표이사 · 본부장급이 보는 자리다 (사용자 설명 2026-09-01).
         * 결론이 모인 경영 현황과, 불만이 들어왔을 때 되짚는 조회 두 갈래면 된다.
         * 조작 화면은 넣지 않는다 - 볼 일이 없고 쓰지도 못한다.
         */
        { href: '/board', label: '경영 현황' },
        { href: '/production', label: '생산' },
        { href: '/trace', label: '조회' },
        { href: '/settings/audit', label: '감사추적' },
      ]
    : [
        { href: '/', label: '현황' },
        { href: '/board', label: '경영' },
        { href: '/production', label: '생산' },
        { href: '/material', label: '자재' },
        { href: '/equipment', label: '설비' },
        { href: '/shipping', label: '출하' },
        { href: '/trace', label: '조회' },
        /*
         * 설정은 생산관리자에게도 연다 (사용자 지시 2026-09-01). 품목 · 공급자 ·
         * 제품표준서 · 감사추적이 이미 열려 있었는데 머리줄에 자리가 없어 주소를
         * 아는 사람만 갔다. 열지 못하는 항목은 하위 차림표에서 빠진다
         * (settingsNav).
         */
        { href: '/settings', label: '설정' },
      ];

  /*
   * 관리자가 닫아 둔 자리는 머리줄에서도 뺀다 (0116).
   *
   * 위 목록은 역할이 정하는 **기본 차림**이다. 계정마다 배정이 다르면 그대로
   * 걸러 낸다 - 못 여는 자리를 내놓고 눌렀을 때 막는 것보다 아예 보이지
   * 않는 편이 낫다. 문은 requireUser 가 한 번 더 지킨다 (lib/session.ts).
   */
  const menu = items.filter((n) => canOpen(n.href, user.roles, user.screens));

  const initial = user.full_name.slice(0, 1);

  /* 레일을 접어 두었는가. 계정별로 기억한다 (./rail.tsx) */
  const railCollapsed = (await cookies()).get(RAIL_COOKIE_PREFIX + user.id)?.value === '1';
  const roleLine = user.roles.length
    ? user.roles.map((r) => ROLE_LABEL[r]).join(' · ')
    : '역할 없음';

  /*
   * 지정 자리 밖에서 두드렸다 (사용자 지시 2026-09-11).
   *
   * 이름 동그라미에 붙이지 않고 **따로** 둔다. 계정 상태가 아니라 시스템에 지금
   * 일어난 일이다. 붉은색이 뜻을 지고 있으므로 회사 색을 따르지 않는다. 숫자를
   * 함께 적는다 - 색만으로 말하지 않는다.
   */
  const alert = outside > 0 && (
    <Link
      href="/settings"
      className="qd-tag qd-tag--sm qd-tag--red qd-tag--primary shrink-0"
      data-hangul=""
      title="로그인된 기기가 지정 자리 밖에서 열었습니다. 눌러서 확인하십시오"
    >
      <span aria-hidden className="qd-tag-dot" />
      밖에서 접속 <span className="tnum">{outside}</span>
    </Link>
  );

  return (
    <div className="flex min-h-screen flex-col bg-canvas lg:flex-row">
      <Rail
        items={menu}
        version={APP_VERSION}
        brand={
          <>
            <span className="qd-rail-mark"><BrandMark className="h-auto w-full text-2xl" /></span>
            <SystemName className="qd-rail-org" />
          </>
        }
        brandMini={<span className="dof-rail-monogram"><BrandMonogram className="h-auto w-full text-2xl" /></span>}
        collapsed={railCollapsed}
        who={user.id}
        foot={
          <>
            <div className="qd-rail-user">
              {/* 개발 계정은 동그라미 자체를 물들인다. 꼬리표보다 덜 시끄럽고 더 눈에 띈다 */}
              <span aria-hidden className={`qd-avatar${user.is_developer ? ' !bg-warn-bg !text-warn' : ''}`}>
                {initial}
              </span>
              <span className="qd-rail-user-text">
                <span className="qd-rail-user-name">{user.full_name}</span>
                <span className="qd-rail-user-meta" data-hangul="">
                  {user.is_developer && <span className="text-warn">개발 · </span>}
                  {roleLine}
                </span>
              </span>
            </div>
            <form action={logout}>
              {/* 접힌 레일에서는 글귀 대신 표식 하나 (원본 접힘의 로그아웃과 같다) */}
              <button type="submit" className="qd-rail-logout" aria-label="로그아웃" title="로그아웃">
                <span className="dof-rail-full">로그아웃</span>
                <span className="dof-rail-mini" aria-hidden>⎋</span>
              </button>
            </form>
          </>
        }
        bar={<><FindUnit />{alert}</>}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner seededAt={demo.seededAt ?? null}
                    canPurge={hasRole(user, 'SYS_ADMIN') && demo.gateOpen === true} />

        {/*
          * 본문 우상단 띠 (Q-Design 7장). 시각 · 개체 번호 찾기 · 현장 화면 ·
          * 알림. 좁은 화면에서는 레일 자리의 머리 줄이 찾기와 알림을 대신 든다.
          */}
        <div className="hidden items-center justify-end gap-3 px-10 pt-5 lg:flex">
          <Clock withDate className="text-xs text-faint" />
          <FindUnit />
          {isWorker(user.roles) && (
            <Link href="/work" className="qd-text-action">현장 화면</Link>
          )}
          {alert}
        </div>

        {/* 본문 여백은 정본 3단 반응 구간 (Q-Design 4장): 데스크톱 40 · 태블릿 28 · 폰 16 */}
        <main className="qd-main mx-auto w-full max-w-[1320px] flex-1
                         max-lg:[--qd-main-pad-x:28px] max-md:[--qd-main-pad-x:16px]">{children}</main>

        {/* 바닥 여백은 떠 있는 뒤로가기(44px)가 바닥글을 덮지 않을 만큼. 정본 .qd-main 이 본문에 주는
            «여백 + 4.5rem» 과 같은 셈이다. 폰에서는 그 단추가 숨으므로(정본) 보통 여백 */}
        <footer className="mx-auto w-full max-w-[1320px] px-4 pb-10 pt-2 sm:pb-[calc(var(--qd-main-pad-y)+4.5rem)] md:px-7 lg:px-10">
          <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
            <span className="opacity-35"><BrandMark className="h-3.5 w-auto text-sm" /></span>
            <p className="text-xs text-faint"><BrandCopyright year={yearKST()} /></p>
          </div>
        </footer>
      </div>

      {/*
        * 자리 비움 잠금 (감사 지적 12). 여기서는 한 화면을 오래 읽는 일이 흔해
        * 현장보다 길게 준다. 워터마크(감사 04)는 캡처를 막지 못하지만 찍히면
        * 누가 언제 봤는지가 함께 남는다. 뒤로가기는 홈 화면 앱에서 브라우저
        * 뒤로가기가 없는 자리를 메운다.
        */}
      <IdleLock minutes={30} sid={String(user.issued_at)} name={user.full_name} initial={initial} />
      <Watermark text={stamp(user.full_name, user.login_code)} />
      <BackFab />
    </div>
  );
}
