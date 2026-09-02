import Link from 'next/link';
import Denied from '@/components/denied';
import { requireUser, blocksViewer, canWrite } from '@/lib/session';
import { withActor } from '@/lib/db';
import { storeMissing } from '@/lib/backup-store';
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
    backup: await db.one<{ n: number; days: number; who: string; auto_days: number | null }>(
      `select count(*)::int as n,
              coalesce(min(current_date - (timezone('Asia/Seoul', b.taken_at))::date), 0) as days,
              coalesce((select coalesce(u.full_name, '예약 작업') from backup_log b2
                          left join app_user u on u.id = b2.taken_by
                         order by b2.taken_at desc limit 1), '') as who,
              /*
               * 서버에서 도는 백업이 실제로 떴는가 (5차 감사 C3). 설정만
               * 갖추고 한 번도 안 떴을 수 있으므로 줄로 확인한다.
               */
              (select min(current_date - (timezone('Asia/Seoul', b3.taken_at))::date)
                 from backup_log b3 where b3.source = 'AUTO') as auto_days
         from backup_log b`),
    covered: await db.rows<{ target: string }>(
      `select distinct target::text as target from numbering_rule
        where is_active and item_id is null`),
  }));

  const c = d.c!;
  const backup = d.backup ?? { n: 0, days: 0, who: '', auto_days: null };
  /*
   * 자동 백업이 설정되어 있는가 (5차 감사 C3). 값은 읽지 않고 있는지만 본다 -
   * 비밀은 화면에 내지 않는다.
   */
  const autoMissing = storeMissing();
  const brand = await getBrand();
  const keyPinned = printKeyPinned();
  const cronPinned = cronKeyPinned();
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
      note: backup.n > 0 ? `${backup.n}회 · 마지막 ${backup.who}` : '한 번도 뜨지 않았습니다',
      tone: backup.n === 0 || backup.days >= 7 ? 'warn' : 'quiet' },
    /*
     * 서버에서 도는 백업 (5차 감사 C3). 전에는 사람 PC 의 작업 스케줄러가
     * 유일한 자동 경로였고, 그 PC 가 꺼져 있으면 백업이 없었다. 무엇이
     * 빠졌는지 이름으로 적는다 - "설정하십시오" 만으로는 어디를 볼지 모른다.
     */
    { href: '/settings/backup', title: '자동 백업',
      value: autoMissing ? '꺼짐'
           : backup.auto_days === null ? '아직 안 뜸'
           : `${backup.auto_days}일 전`,
      note: autoMissing ? `${autoMissing} 이(가) 없습니다`
           : backup.auto_days === null ? '설정은 갖춰졌습니다. 다음 예약 작업에서 뜹니다'
           : '예약 작업이 떠서 보관소에 둡니다',
      tone: autoMissing || backup.auto_days === null || backup.auto_days >= 2
        ? 'warn' : 'quiet' },
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
        {!keyPinned && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            지금 상태로 세션 열쇠를 갈면 같은 자료가 다른 자료 식별자를 냅니다.
            지금 쓰는 파생 열쇠는 나중에 되찾을 수 없습니다.
          </p>
        )}
      </section>

      {/*
        * 첫 설정 차례표는 손을 쓰는 사람의 것이다. 읽기 전용 세션에는 내지
        * 않는다 - 누를 수 없는 할 일 목록은 재촉일 뿐이다.
        */}
      {writable && <SetupSteps steps={mine(steps)} />}
    </PageShell>
  );
}
