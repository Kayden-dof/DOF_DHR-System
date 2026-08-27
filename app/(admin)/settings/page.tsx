import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { withActor } from '@/lib/db';
import { NUMBERING_TARGETS, M1_CRITICAL_TARGETS } from '@/lib/forms';
import { Tag } from '@/components/ui';
import { PageShell } from '@/components/shell';
import { SubNav } from '../nav';
import { SETTINGS_NAV } from '../sections';

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
}

export default async function SettingsHome() {
  const user = await requireUser();

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
              (select count(*)::int from audit_log)                              as audit`),
    covered: await db.rows<{ target: string }>(
      `select distinct target::text as target from numbering_rule
        where is_active and item_id is null`),
  }));

  const c = d.c!;
  const have = new Set(d.covered.map((r) => r.target));
  const missing = NUMBERING_TARGETS.filter((t) => !have.has(t.code));
  const blocking = missing.filter((t) => M1_CRITICAL_TARGETS.includes(t.code));

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
    { href: '/settings/audit', title: '감사추적',
      value: `${c.audit}건`, note: '등록 · 변경 · 회수 이력', tone: 'quiet' },
  ];

  return (
    <PageShell
      section="설정"
      title="기준정보와 계정"
      lede="여기서 정한 것이 생산 화면의 선택지가 됩니다."
      nav={<SubNav items={SETTINGS_NAV} />}
    >
      {blocking.length > 0 && (
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
        {cards.map((x) => (
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

      <section className="card p-4">
        <h3 className="text-xs font-bold text-ink">등록 순서</h3>
        <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>1. <b className="text-ink">채번 규칙</b>. 자재 입고와 작업 지시가 번호를 여기서 받습니다.</li>
          <li>2. <b className="text-ink">품목</b>. 자재를 넣고 완제품 형명은 규칙으로 생성합니다.</li>
          <li>3. <b className="text-ink">공급자</b>와 단가. 자재 입고에서 선택 대상입니다.</li>
          <li>4. <b className="text-ink">제품표준서</b>. 공정과 자재 구성표를 넣고 서면과 대조 확인합니다.</li>
          <li>5. <b className="text-ink">사용자</b>. 작업자에게 역할을 부여하면 현장 화면을 씁니다.</li>
        </ol>
      </section>
    </PageShell>
  );
}
