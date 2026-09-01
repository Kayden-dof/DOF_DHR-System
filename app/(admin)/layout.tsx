import Link from 'next/link';
import { withActor } from '@/lib/db';
import { redirect } from 'next/navigation';
import { requireUser, hasRole, ROLE_LABEL } from '@/lib/session';
import { isAdmin, isWorker, isViewerOnly, isQpOnly } from '@/lib/roles';
import Watermark, { stamp } from '@/components/watermark';
import BackFab from '@/components/back-fab';
import DemoBanner from '@/components/demo-banner';
import FindUnit from '@/components/find-unit';
import { BrandMark, BrandCopyright, SystemName } from '@/components/brand-mark';
import { yearKST } from '@/lib/kst';
import IdleLock from '@/components/idle-lock';
import { logout } from './actions';
import Nav, { type NavItem } from './nav';
import Clock from '@/components/clock';

/* ---------------------------------------------------------------------------
   관리 화면

   키보드와 마우스를 쓰는 사무 환경을 전제한다. 밀도를 높이고 표를 많이 쓴다.
   현장 패드용 화면은 /work 쪽이며 조작 크기가 다르다.

   상단은 한 줄로 끝낸다. 두 줄이 되면 표가 밀려 내려가 화면당 보이는 행이
   줄어든다. 이 시스템은 목록을 훑는 시간이 대부분이다.
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
  if (!isAdmin(user.roles) && !viewer && !qp) {
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
        { href: '/settings/dmr', label: '제품표준서' },
        { href: '/equipment', label: '설비' },
        { href: '/material', label: '자재' },
        { href: '/trace', label: '조회' },
        { href: '/settings/audit', label: '감사추적' },
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

  const initial = user.full_name.slice(0, 1);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="brand-rule" />

      {/*
        * 상단은 밝게 둔다. 어두운 면은 현장 화면이 가져갔다. 두 모드가 같은
        * 얼굴을 하면 관리 화면인 줄 알고 현장 기록을 만지게 된다.
        *
        * 대신 자리를 넉넉히 준다. 44px 에 다 밀어 넣으니 로고도 메뉴도 이름도
        * 전부 작아져서 무엇 하나 서지 못했다. 크기를 키우는 대신 높이를 준다.
        */}
      <DemoBanner seededAt={demo.seededAt ?? null}
                  canPurge={hasRole(user, 'SYS_ADMIN') && demo.gateOpen === true} />

      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-5 lg:gap-9">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="현황으로">
            {/*
              * 로고 상자를 글자보다 크게 잡는다.
              *
              * 올라온 PNG 는 둘레에 투명 여백을 두른다. 지금 것은 그림이 상자
              * 높이의 절반뿐이라, 상자를 글자와 같은 20px 로 두면 실제 그림은
              * 10px 로 그려져 옆의 DHR 보다 한참 작아 보였다 (사용자 지적).
              *
              * 여백은 올린 파일의 성질이라 프로그램이 알 수 없다. 여백을 잘라
              * 올리면 상자와 그림이 같아져 이 보정이 필요 없다 - 설정 화면이
              * 그렇게 안내한다.
              */}
            <BrandMark className="h-7 w-auto text-[1.125rem]" />
            <span className="h-5 w-px bg-line-strong" aria-hidden />
            <SystemName className="display text-[1.125rem] leading-none text-ink" />
          </Link>

          <div className="flex h-full min-w-0 flex-1 items-stretch">
            <Nav items={items} />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {/*
              * 오늘 며칠 몇 시인가. 시각만 덩그러니 두면 무엇의 시각인지
              * 짚이지 않는다 (사용자 지적 2026-09-01). 한국 시각으로 못 박는다
              * (components/clock.tsx).
              *
              * 자리를 많이 먹으므로 넓은 화면에서만 낸다. 좁아지면 차림표가
              * 먼저다 - 시계는 알아 두면 좋은 것이고 차림표는 일하는 길이다.
              */}
            <Clock withDate className="hidden text-xs text-faint xl:inline" />

            {/* 어느 화면에서 전화를 받든 바로 부를 수 있어야 한다 */}
            <FindUnit />

            {isWorker(user.roles) && (
              <Link href="/work" className="btn-ghost h-9">현장 화면</Link>
            )}

            <div className="hidden items-center gap-2.5 md:flex">
              {/*
                * 개발 계정 표시를 이름 옆 꼬리표에서 동그라미 자체로 옮긴다.
                * 꼬리표로 두면 이름 줄에 세 번째 색이 끼어들어 머리글이 시끄럽고,
                * 정작 봐야 할 이름보다 꼬리표가 먼저 읽힌다.
                *
                * 동그라미를 물들이면 색은 하나로 줄면서 오히려 더 눈에 띈다.
                * 이 표시는 장식이 아니라 "지금 개발 계정이다"라는 경고다.
                */}
              <span
                aria-hidden
                className={`grid size-9 place-items-center rounded-full text-[0.8125rem] font-bold ${
                  user.is_developer
                    ? 'bg-warn-bg text-warn ring-1 ring-warn/25'
                    : 'bg-brand-tint text-brand'
                }`}
              >
                {initial}
              </span>
              <div className="leading-tight">
                <div className="text-[0.8125rem] font-bold text-ink">
                  {user.full_name}
                </div>
                <div className="text-[0.6875rem] text-muted">
                  {user.is_developer && <span className="font-bold text-warn">개발 · </span>}
                  {user.roles.length
                    ? user.roles.map((r) => ROLE_LABEL[r]).join(' · ')
                    : '역할 없음'}
                </div>
              </div>
            </div>

            <span className="hidden h-5 w-px bg-line md:block" aria-hidden />

            <form action={logout}>
              <button type="submit" className="btn-quiet h-9">로그아웃</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-8">{children}</main>

      <footer className="mx-auto w-full max-w-[1400px] px-5 pb-10 pt-6">
        <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
          {/* 바닥글은 눈을 끌 자리가 아니다. 흐리게 얹는다 */}
          <span className="opacity-35">
            <BrandMark className="h-3.5 w-auto text-[0.8125rem]" />
          </span>
          <p className="text-[0.6875rem] tracking-wide text-faint">
            <BrandCopyright year={yearKST()} />
          </p>
        </div>
      </footer>

      {/*
        * 자리 비움 잠금 (감사 지적 12).
        *
        * 현장보다 길게 준다. 여기서는 한 화면을 오래 읽는 일이 흔해서, 읽는
        * 중에 덮이면 잠금이 아니라 방해가 된다. 대신 여기서 하는 일이 더
        * 되돌리기 어렵다 - 작업 지시 발행, 기준정보 변경, 인쇄.
        */}
      <IdleLock minutes={30} name={user.full_name} initial={user.full_name.slice(0, 1)} />

      {/* 감사 04. 캡처를 막지는 못하고, 찍히면 누가 언제 봤는지가 함께 남는다 */}
      <Watermark text={stamp(user.full_name, user.login_code)} />

      {/*
        * 홈 화면에서 전체 화면으로 띄우면 브라우저 뒤로가기가 없다.
        * 첫 화면에서는 스스로 숨는다 (components/back-fab.tsx).
        */}
      <BackFab />
    </div>
  );
}
