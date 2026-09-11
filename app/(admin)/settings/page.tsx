import Link from 'next/link';
import Denied from '@/components/denied';
import { requireUser, blocksViewer, canWrite, hasRole } from '@/lib/session';
import { fmtDateTime, fmtTime } from '@/lib/fmt';
import { withActor } from '@/lib/db';
import { NUMBERING_TARGETS, M1_CRITICAL_TARGETS } from '@/lib/forms';
import { ROLE_ORDER } from '@/lib/roles';
import { canOpen } from '@/lib/access';
import { schemaDrift, kindLabel } from '@/lib/schema-check';
import { Tag } from '@/components/ui';
import { PageShell } from '@/components/shell';
import { SubNav } from '../nav';
import { settingsNav } from '../sections';
import { APP_VERSION, BUILD_REF } from '@/lib/version';
import { printKeyPinned, cronKeyPinned } from '@/lib/print';
import { headers } from 'next/headers';
import { allowState, clientIp, clientCountry, clientPlace } from '@/lib/net';
import { getBrand } from '@/lib/brand';
import { SetupSteps, type SetupStep } from './setup-steps';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '설정' };

interface Counts {
  items: number; finished: number; suppliers: number; approved: number;
  dmr: number; dmr_verified: number; users: number; rules: number; audit: number;
  /* 첫 설정 차례표가 보는 것 (M5-3) */
  supplies: number; equipment: number; dmr_issuable: number; workers: number;
  schemes: number; segments: number;
}

/** 문 앞에서 막힌 접속 한 묶음 (0109) */
interface Block {
  day: Date; ip: string | null;
  country: string | null; region: string | null; city: string | null;
  who: string | null; reason: string; path: string | null;
  hits: number; first_at: Date; last_at: Date;
}

/*
 * 언제부터 언제까지 두드렸는가.
 *
 * **몇 번인지는 적지 않는다.** 문 앞이 같은 자리를 1분에 한 번만 적으므로
 * (proxy.ts) 그 수는 실제보다 작다. 작은 수를 횟수라 적으면 그것이 거짓말이고,
 * 읽는 사람은 그 수를 믿는다 (§8.5). 폭은 거짓말이 아니다 - 한 번 두드렸으면
 * 한 시각이고, 하루 종일이면 하루가 보인다.
 */
function span(first: Date, last: Date): string {
  const a = fmtDateTime(first);
  const b = fmtDateTime(last);
  if (a === b) return a;
  /* 같은 날이면 뒤쪽은 시각만 */
  const day = a.slice(0, a.length - fmtTime(first).length);
  return b.startsWith(day) ? `${a} ~ ${fmtTime(last)}` : `${a} ~ ${b}`;
}

/** 무엇이 어긋나 막혔는가. 사실만 적는다 (§8.5) */
const BLOCK_REASON: Record<string, string> = {
  COUNTRY: '나라',
  REGION: '시·도',
  CITY: '시',
  ADDRESS: '주소',
};

export default async function SettingsHome() {
  const user = await requireUser();
  /*
   * 경영열람에게 열어 둔 화면이 아니다. 주소를 직접 쳐도 들어가지 못한다.
   *
   * 품질책임자는 들어온다 (사용자 지시 2026-09-01) - 채번 규칙 · 공급자 ·
   * 제품표준서 · 사용자 · 감사추적이 이 아래에 있고, 그것이 기준을 보는 자리다.
   */
  if (blocksViewer(user)) return <Denied what="이 화면" need="생산관리자 또는 시스템관리자" />;
  const writable = canWrite(user);


  const d = await withActor(user.id, async (db) => ({
    c: await db.one<Counts>(
      `select (select count(*)::int from item)                                   as items,
              (select count(*)::int from item where type='FIN')                  as finished,
              (select count(*)::int from supplier)                               as suppliers,
              (select count(*)::int from supplier where status='APPROVED')       as approved,
              (select count(*)::int from device_master)                          as dmr,
              (select count(*)::int from device_master where verified_at is not null) as dmr_verified,
              (select count(*)::int from app_user where is_active)               as users,
              (select count(*)::int from numbering_rule where is_active)         as rules,
              (select count(*)::int from audit_log)                              as audit,
              (select count(*)::int from item where type <> 'FIN')               as supplies,
              (select count(*)::int from equipment)                              as equipment,
              (select count(*)::int from model_scheme where is_active)           as schemes,
              (select count(*)::int from model_segment)                          as segments,
              (select count(*)::int from user_role where role = 'WORKER')         as workers,
              /*
               * 발행할 수 있는 표준서. 세 가지가 모두 서야 한다 (0061).
               * 화면이 따로 셈하지 않고 DB 가 막는 조건을 그대로 쓴다.
               */
              (select count(*)::int from device_master
                where verified_at is not null and status = 'ACTIVE'
                  and effective_from is not null
                  and effective_from <= (timezone('Asia/Seoul', now()))::date) as dmr_issuable`),
    drift: await schemaDrift(db),
    backup: await db.one<{ n: number; days: number; who: string }>(
      `select count(*)::int as n,
              coalesce(min(current_date - (timezone('Asia/Seoul', b.taken_at))::date), 0) as days,
              coalesce((select u.full_name from backup_log b2
                          join app_user u on u.id = b2.taken_by
                         order by b2.taken_at desc limit 1), '') as who
         from backup_log b`),
    covered: await db.rows<{ target: string }>(
      `select distinct target::text as target from numbering_rule
        where is_active and item_id is null`),
    /*
     * 문을 두드린 자리 (0109 · 사용자 지시 2026-09-11).
     *
     * 문이 닫혀 있으면 로그인 시도 자체가 일어나지 않으므로, 밖에서 무슨 일이
     * 있었는지는 이 표 말고 알 자리가 없다.
     */
    blocks: await db.rows<Block>(`select * from access_block_recent(14)`),
  }));

  const c = d.c!;
  const backup = d.backup ?? { n: 0, days: 0, who: '' };
  const brand = await getBrand();
  const keyPinned = printKeyPinned();
  const cronPinned = cronKeyPinned();
  /* 망 경계. 켜져 있는지를 화면이 말한다 - 꺼진 줄 모르는 것이 잘못이다 */
  const net = allowState();
  /*
   * 막힌 접속은 개발계정과 시스템관리자만 본다 (사용자 지시 2026-09-11).
   * 현장 작업자에게는 할 일이 아니고, 품질책임자에게는 기록이 아니다.
   */
  const watches = user.is_developer || hasRole(user, 'SYS_ADMIN');
  const blocks = watches ? d.blocks : [];
  /*
   * 지금 이 화면을 보고 있는 접속지 (사용자 지적 2026-09-11).
   *
   * 제조소 공인 주소가 고정이 아니면 그 값을 어딘가에서 알아내 와야 하는데,
   * 바깥 사이트에 물어보는 것은 "그때 그 사이트가 본 주소" 이지 **이 시스템이
   * 본 주소** 가 아니다. 둘이 다를 수 있고(프록시·IPv6), 다르면 넣어 봐야
   * 안 열린다.
   *
   * 그래서 이 시스템이 본 값을 그대로 찍는다. 제조소 패드에서 이 화면을 열면
   * ALLOW_FROM 에 넣을 값이 바로 여기 있다. 막힌 화면도 같은 값을 찍는다.
   */
  const h = await headers();
  const here = clientIp(h);
  /*
   * 나라와 시·도를 함께 찍는다. 나라는 지금 거르는 잣대이고, 시·도는
   * **며칠 지켜보고 좁힐 수 있는지 정하라고** 보여 주는 값이다. 유동 주소는
   * 시·도가 흔들릴 수 있어 판정에 쓰지 않는다.
   */
  const hereCountry = clientCountry(h);
  const herePlace = clientPlace(h);
  const have = new Set(d.covered.map((r) => r.target));
  const missing = NUMBERING_TARGETS.filter((t) => !have.has(t.code));
  const blocking = missing.filter((t) => M1_CRITICAL_TARGETS.includes(t.code));

  /*
   * 첫 설정 차례. 앞의 것이 없으면 뒤 화면에 고를 것이 없는 순서다.
   * 설비는 설정 차림표 밖에 있으나 제품표준서가 공정에 거는 것이므로 여기 온다.
   */
  const steps: SetupStep[] = [
    { href: '/settings/brand', title: '회사 표시',
      fact: [brand.companyName, brand.hasLogo ? '로고 있음' : '로고 없음',
             brand.brandColor].filter(Boolean).join(' · '),
      empty: !brand.companyName,
      blocks: '화면 머리줄과 인쇄물에 나올 이름이 없습니다' },
    { href: '/settings/numbering', title: '채번 규칙',
      fact: `${c.rules}건 활성`,
      empty: blocking.length > 0,
      blocks: `${blocking.map((t) => t.label).join(' · ')} 규칙이 없어 번호를 만들 수 없습니다` },
    { href: '/settings/model', title: '형명 체계',
      fact: c.schemes > 0 ? `${c.schemes}개 · 자리 ${c.segments}개` : '없음',
      empty: c.schemes === 0,
      blocks: '형명 체계가 없으면 완제품 형명을 만들 수 없고 규격 표기가 종이에 나가지 않습니다' },
    { href: '/settings/items', title: '품목',
      fact: `자재 ${c.supplies}종 · 완제품 형명 ${c.finished}종`,
      empty: c.supplies === 0,
      blocks: '자재가 없으면 입고도 자재 구성표도 만들 수 없습니다' },
    { href: '/settings/suppliers', title: '공급자',
      fact: `${c.suppliers}곳 · 승인 ${c.approved}곳`,
      empty: c.suppliers === 0,
      blocks: '입고 등록에서 고를 공급자가 없습니다' },
    { href: '/equipment', title: '설비',
      fact: `${c.equipment}대`,
      empty: c.equipment === 0,
      blocks: '제품표준서의 공정에 걸 설비가 없습니다' },
    { href: '/settings/dmr', title: '제품표준서',
      fact: c.dmr_issuable > 0
        ? `${c.dmr}개정 · 발행할 수 있는 것 ${c.dmr_issuable}건`
        : `${c.dmr}개정 · 대조 확인 ${c.dmr_verified}건`,
      empty: c.dmr_issuable === 0,
      blocks: c.dmr === 0
        ? '공정과 자재 구성표를 담을 제품표준서가 없습니다'
        : '서면 대조 확인 · 발효일 · 상태가 서야 작업 지시를 발행할 수 있습니다',
      },
    { href: '/settings/users', title: '사용자',
      fact: `${c.users}명 · 작업자 ${c.workers}명`,
      empty: c.workers === 0,
      blocks: '현장 화면을 쓸 작업자 계정이 없습니다' },
  ];

  /*
   * 못 여는 자리는 타일에도 차례표에도 내지 않는다. 하위 차림표에서 이미
   * 뺐는데(settingsNav) 여기 남아 있으면 같은 문을 두 곳에서 다르게 말하는
   * 셈이다.
   *
   * 판정은 권한 매트릭스 하나에서 온다 (lib/access.ts). 전에는 여기에 목록을
   * 손으로 하나 더 들고 있었고, 역할이 늘 때마다 세 곳을 따로 고쳐야 했다.
   */
  const mine = <T extends { href: string }>(xs: T[]) =>
    xs.filter((x) => canOpen(x.href, user.roles));

  const cards = [
    { href: '/settings/numbering', title: '채번 규칙',
      value: `${c.rules}건 활성`,
      note: blocking.length
        ? `${blocking.map((t) => t.label).join(' · ')} 미등록`
        : '대상별 번호 형식',
      tone: blocking.length ? 'warn' : 'ok' },
    { href: '/settings/items', title: '품목',
      value: `${c.items}종`, note: `완제품 형명 ${c.finished}종`, tone: 'quiet' },
    { href: '/settings/suppliers', title: '공급자',
      value: `${c.suppliers}곳`, note: `승인 ${c.approved}곳`, tone: 'quiet' },
    { href: '/settings/dmr', title: '제품표준서',
      value: `${c.dmr}개정`,
      note: c.dmr === 0 ? '등록 필요' : `대조 확인 ${c.dmr_verified}건`,
      tone: c.dmr > 0 && c.dmr_verified === 0 ? 'warn' : 'quiet' },
    { href: '/settings/users', title: '사용자',
      value: `${c.users}명`, note: '계정과 역할', tone: 'quiet' },
    { href: '/settings/backup', title: '백업',
      value: backup.n > 0 ? `${backup.days}일 전` : '없음',
      note: backup.n > 0
        ? `${backup.n}회 · 마지막 ${backup.who} · ${brand.backupWarnDays}일마다 묻습니다`
        : '한 번도 뜨지 않았습니다',
      /*
       * 며칠이 지나면 묻는가는 설정에서 온다 (§2.0). 전에는 7 이 박혀 있었다 -
       * 자동 백업이 있을 때는 맞는 값이었는데, 사람이 달마다 또는 분기마다
       * 뜨기로 하면 그 경고가 늘 켜져 있게 된다. **늘 켜진 경고는 경고가
       * 아니라 배경이다.**
       */
      tone: backup.n === 0 || backup.days >= brand.backupWarnDays ? 'warn' : 'quiet' },
    { href: '/settings/access', title: '권한',
      value: `역할 ${ROLE_ORDER.length}`, note: '어느 역할이 어느 화면을 여는가', tone: 'quiet' },
    { href: '/settings/audit', title: '감사추적',
      value: `${c.audit}건`, note: '등록 · 변경 · 회수 이력', tone: 'quiet' },
  ];

  return (
    <PageShell
      section="설정"
      title="기준정보와 계정"
      lede="여기서 정한 것이 생산 화면의 선택지가 됩니다."
      nav={<SubNav items={settingsNav(user.roles)} />}
    >
      {writable && blocking.length > 0 && (
        <div className="card border-warn/40 bg-warn-bg p-4">
          <div className="flex items-start gap-3">
            <Tag tone="warn">먼저 할 일</Tag>
            <div className="text-sm leading-relaxed">
              <p className="font-semibold text-ink">
                {blocking.map((t) => t.label).join(' · ')} 채번 규칙이 없습니다.
              </p>
              <p className="mt-1 text-muted">
                규칙이 없으면 자재 입고와 작업 지시 발행에서 번호를 만들 수 없습니다.
              </p>
              <Link href="/settings/numbering" className="btn-primary mt-3 h-9 px-3 text-xs">
                채번 규칙 등록
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {mine(cards).map((x) => (
          <Link key={x.href} href={x.href}
                className="card-raised group p-4 transition-colors hover:border-brand-line">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">{x.title}</h3>
              <span className="text-xs text-faint transition-colors group-hover:text-brand">열기</span>
            </div>
            <p className="mt-2 text-2xl font-bold tnum text-ink">{x.value}</p>
            <p className="mt-1 text-xs text-muted">
              {x.tone === 'warn' ? <Tag tone="warn">{x.note}</Tag> : x.note}
            </p>
          </Link>
        ))}
      </div>

      {/*
        * 무엇이 깔려 있고 그 판이 무엇인가. §8.0 의 IQ 가 묻는 것이고, 종이에 적힌
        * 기록이 어느 판에서 나왔는지 되짚는 자리다.
        *
        * 인쇄 열쇠도 여기서 말한다. 고정되지 않은 상태는 화면 어디에도
        * 표시가 없어 조용히 지나간다 (lib/print.ts printKeyPinned).
        */}
      {/*
        * 코드와 스키마가 어긋나면 크게 말한다 (4차 감사 C5).
        *
        * 코드 배포와 이관은 따로 논다. 실제로 그것 때문에 화면이 죽었고,
        * 사용자가 알려 줄 때까지 아무 장치도 없었다. IQ 는 사람이 돌리는
        * 것이므로 화면이 스스로도 말해야 한다.
        */}
      {!d.drift.ok && (
        <div className="card border-danger/40 bg-danger-bg p-4">
          <div className="flex items-start gap-3">
            <Tag tone="danger">이관이 덜 올라갔습니다</Tag>
            <div className="text-sm leading-relaxed">
              <p className="font-semibold text-ink">
                이 코드가 기대하는 것이 DB 에 없습니다. 화면이 죽을 수 있습니다.
              </p>
              <ul className="mt-2 space-y-1 text-xs text-body">
                {d.drift.missing.map((m) => (
                  <li key={m.kind}>
                    <b className="text-ink">{kindLabel(m.kind)}</b>{' '}
                    <span className="font-mono">{m.names.slice(0, 6).join(', ')}</span>
                    {m.names.length > 6 && ` 외 ${m.names.length - 6}개`}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                이관을 올리십시오. <code>npm run deploy:db -- --prod</code>
              </p>
            </div>
          </div>
        </div>
      )}

      <section className="card p-4">
        <h3 className="text-xs font-bold text-ink">이 배포</h3>
        <dl className="mt-2 flex flex-wrap gap-x-10 gap-y-3 text-xs">
          <div>
            <dt className="text-muted">프로그램 판</dt>
            <dd className="tnum mt-0.5 font-semibold text-ink">v{APP_VERSION}</dd>
          </div>
          <div>
            <dt className="text-muted">빌드</dt>
            <dd className="tnum mt-0.5 text-ink">{BUILD_REF ?? '로컬 실행'}</dd>
          </div>
          <div>
            <dt className="text-muted">스키마 대조</dt>
            <dd className="mt-0.5">
              {d.drift.checked === 0
                ? <span className="text-muted">기준 파일 없음</span>
                : d.drift.ok
                  ? <span className="tnum text-ink">{d.drift.checked}개 이름 일치</span>
                  : <Tag tone="danger">빠짐 {d.drift.missing.reduce((a, m) => a + m.names.length, 0)}개</Tag>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">일 1회 배치</dt>
            <dd className="mt-0.5">
              {cronPinned
                ? <span className="text-ink">CRON_SECRET 으로 잠김</span>
                : <Tag tone="warn">인증 없이 열려 있음</Tag>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">접속지 제한</dt>
            <dd className="mt-0.5">
              {net.on
                ? (
                  /*
                   * 좁힌 잣대를 좁은 차례로 적는다 - 나라 · 시·도 · 시 ·
                   * 주소 구간. 무엇으로 좁혀 두었는지가 한 줄에 다 보여야
                   * 잠겼을 때 어디를 고칠지 바로 안다.
                   */
                  <span className="text-ink">
                    {[
                      net.countries.length > 0 && net.countries.join('·'),
                      net.regions.length > 0 && net.regions.join('·'),
                      net.cities.length > 0 && net.cities.join('·'),
                      net.count > 0 && `주소 ${net.count}구간`,
                    ].filter(Boolean).join(' · ')}
                    <span className="text-muted"> 에서만 접속</span>
                  </span>
                )
                : <Tag tone="warn">어디서나 접속</Tag>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">지금 이 화면의 접속지</dt>
            <dd className="mt-0.5">
              {here
                ? (
                  <span className="text-ink">
                    <code>{here}</code>
                    {hereCountry && <span className="tnum"> · {hereCountry}</span>}
                    {herePlace && <span className="text-muted"> {herePlace}</span>}
                  </span>
                )
                : <span className="text-muted">읽지 못했습니다</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">인쇄 열쇠</dt>
            <dd className="mt-0.5">
              {keyPinned
                ? <span className="text-ink">PRINT_SECRET 으로 고정됨</span>
                : <Tag tone="warn">고정되지 않음 · 세션 열쇠에서 파생</Tag>}
            </dd>
          </div>
        </dl>
        {!cronPinned && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            일 1회 배치(<code>/api/daily</code>)가 인증 없이 열려 있습니다.
            바깥에서 부를 수 있으나 하는 일은 유효기한 표시와 로그인 실패 청소뿐이라
            같은 결과가 몇 시간 일찍 날 뿐입니다. 배포 환경에
            <code> CRON_SECRET </code>을 넣으면 잠깁니다.
          </p>
        )}
        {/*
          * 여는 방법을 화면에 적지 않는다 (사용자 지시 2026-09-11).
          *
          * `ALLOW_FROM 에 공인 IP를 넣으면…` 같은 것은 이 화면을 보는 사람이
          * 할 일이 아니라 배포하는 사람이 읽을 글이다. 화면에는 **지금 어떤
          * 상태인가** 만 둔다 - 켜졌는지, 지금 접속지가 무엇인지.
          *
          * 방법은 `.env.example` 과 CLAUDE.md §2.3 에 있다. 두 곳에 적으면
          * 갈라지고, 갈라지면 화면 쪽이 먼저 낡는다.
          */}
        {net.bad.length > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-ink">
            <code>ALLOW_FROM</code> 에서 <code>{net.bad.join(' ')}</code> 를 읽지
            못했습니다. 이 조각은 어느 주소도 통과시키지 않습니다.
          </p>
        )}
        {net.placeBad.length > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-ink">
            <code>ALLOW_REGION</code> · <code>ALLOW_CITY</code> 에서
            <code> {net.placeBad.join(' ')}</code> 를 읽지 못했습니다. 이 조각은
            어느 자리도 통과시키지 않습니다.
          </p>
        )}
        {net.countryBad.length > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-ink">
            <code>ALLOW_COUNTRY</code> 에서 <code>{net.countryBad.join(' ')}</code> 를
            읽지 못했습니다. 두 글자 나라 코드만 읽습니다 (<code>KR</code>).
          </p>
        )}
        {!keyPinned && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            지금 상태로 세션 열쇠를 갈면 같은 자료가 다른 자료 식별자를 냅니다.
            지금 쓰는 파생 열쇠는 나중에 되찾을 수 없습니다.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------
        * 문을 두드린 자리 (0109 · 사용자 지시 2026-09-11)
        *
        * "지정 위치 외에서 로그인 시도가 들어오면 개발계정에게는 알림이 가야함.
        * 누가 어디서 시도했는지."
        *
        * 문이 닫혀 있으면 로그인 시도 자체가 일어나지 않는다 - 벽에서 막히므로
        * 사번도 비밀번호도 오지 않는다. 그래서 여기 나오는 것은 "로그인 실패"
        * 가 아니라 **막힌 접속** 이고, 누구인지는 세션 쿠키를 들고 온 경우에만
        * 안다. 모르는 것을 지어내지 않는다 (§1).
        *
        * ── 없으면 아무것도 내지 않는다 ──────────────────────────────────
        * §8.5 가 "이상이 없으면 아무것도 표시하지 않는다. 빈 상태가 정상이다"
        * 라고 정했다. `두드린 자리 0건` 을 띄우면 그 글자를 믿고 넘어가게
        * 되는데, 이 표가 보는 것보다 못 보는 것이 훨씬 많다.
        * ------------------------------------------------------------------ */}
      {watches && blocks.length > 0 && (
        <section className="card border-warn/40 bg-warn-bg p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-sm font-bold text-ink">지정 자리 밖에서 두드렸습니다</h2>
            <span className="text-xs text-muted">
              최근 14일 · <b className="tnum text-ink">{blocks.length}</b>곳
            </span>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted">
                <tr className="border-b border-line-soft">
                  <th className="py-1.5 pr-3 font-semibold">언제</th>
                  <th className="py-1.5 pr-3 font-semibold">접속지</th>
                  <th className="py-1.5 pr-3 font-semibold">계정</th>
                  <th className="py-1.5 pr-3 font-semibold">어긋난 것</th>
                  <th className="py-1.5 pr-3 font-semibold">열려던 자리</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((b, i) => (
                  <tr key={i} className="border-b border-line-soft last:border-0">
                    <td className="whitespace-nowrap py-1.5 pr-3 tnum text-muted">
                      {span(b.first_at, b.last_at)}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className="text-ink">{b.ip ?? '주소를 읽지 못했습니다'}</span>
                      {(b.country || b.region || b.city) && (
                        <span className="text-muted">
                          {' '}{[b.country, b.region, b.city].filter(Boolean).join(' ')}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      {/*
                        * 계정을 들고 두드린 것이 실제로 위험한 쪽이다 -
                        * 제조소 패드가 밖에 나가 있다는 뜻이다.
                        */}
                      {b.who
                        ? <b className="text-danger">{b.who}</b>
                        : <span className="text-faint">알 수 없음</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-muted">
                      {BLOCK_REASON[b.reason] ?? b.reason}
                    </td>
                    <td className="py-1.5 pr-3 text-muted">{b.path ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted">
            계정이 <b className="text-danger">붉게</b> 적힌 줄은 이 시스템에 로그인한
            상태의 기기가 지정 자리 밖에서 열었다는 뜻입니다. 나머지는 자격 없이
            문만 두드린 것으로, 누구인지는 알 수 없습니다.
          </p>
        </section>
      )}

      {/*
        * 첫 설정 차례표는 손을 쓰는 사람의 것이다. 읽기 전용 세션에는 내지
        * 않는다 - 누를 수 없는 할 일 목록은 재촉일 뿐이다.
        */}
      {writable && <SetupSteps steps={mine(steps)} />}
    </PageShell>
  );
}
