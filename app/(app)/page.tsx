import Link from 'next/link';
import { requireUser, hasRole, ROLE_LABEL, type RoleCode } from '@/lib/session';
import { withActor } from '@/lib/db';
import { NUMBERING_TARGETS, M1_CRITICAL_TARGETS } from '@/lib/forms';
import { fmtDateTime } from '@/lib/fmt';
import ActionChip from '@/components/action-chip';

export const dynamic = 'force-dynamic';

interface Coverage { target: string; common_active: number; item_active: number }
interface AuditRow { table_name: string; action: string; acted_at: Date; actor_name: string | null }

export default async function Dashboard() {
  const user = await requireUser();
  const admin = hasRole(user, 'SYS_ADMIN');

  const data = await withActor(user.id, async (db) => ({
    coverage: await db.rows<Coverage>(
      `select target::text as target,
              count(*) filter (where is_active and item_id is null)::int     as common_active,
              count(*) filter (where is_active and item_id is not null)::int as item_active
         from numbering_rule group by target`,
    ),
    accounts: await db.one<{ active: number; inactive: number; dev: number; nologin: number }>(
      `select count(*) filter (where is_active)::int      as active,
              count(*) filter (where not is_active)::int  as inactive,
              count(*) filter (where is_developer)::int   as dev,
              count(*) filter (where not can_login)::int  as nologin
         from app_user`,
    ),
    roles: await db.rows<{ role: RoleCode; n: number }>(
      `select role::text as role, count(*)::int as n
         from user_role group by role order by role`,
    ),
    recent: await db.rows<AuditRow>(
      `select a.table_name, a.action, a.acted_at, u.full_name as actor_name
         from audit_log a
         left join app_user u on u.id = a.actor_id
        order by a.id desc limit 8`,
    ),
    auditTotal: await db.val<number>(`select count(*)::int from audit_log`),
  }));

  const byTarget = new Map(data.coverage.map((c) => [c.target, c]));
  const missing = NUMBERING_TARGETS.filter((t) => !byTarget.get(t.code)?.common_active);
  const blockingM1 = missing.filter((t) => M1_CRITICAL_TARGETS.includes(t.code));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">현황</h1>
        <p className="mt-1 text-sm text-muted">M0 범위 — 사용자 · 권한 · 감사추적 · 채번 규칙</p>
      </div>

      <section
        className={`card p-5 ${
          blockingM1.length ? 'border-warn/40 bg-warn-bg' : 'border-ok/30 bg-ok-bg'
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            className={`chip mt-0.5 shrink-0 ${
              blockingM1.length ? 'bg-warn text-white' : 'bg-ok text-white'
            }`}
          >
            {blockingM1.length ? '채번 규칙 미등록' : 'M1 착수 가능'}
          </span>
          <div className="text-sm leading-relaxed">
            {blockingM1.length ? (
              <>
                <p className="font-semibold text-ink">
                  {blockingM1.map((t) => t.label).join(' · ')} 규칙이 없습니다.
                </p>
                <p className="mt-1 text-muted">
                  M1의 자재 로트 등록이 채번에 의존합니다. 규칙 없이 채번을 부르면 예외가
                  납니다. <b className="text-ink">M1이 끝나기 전에 실제 로트를 등록하지
                  마십시오 — 계보는 소급이 안 됩니다.</b>
                </p>
                {admin && (
                  <Link href="/numbering" className="btn-primary mt-3 h-9 px-3 text-xs">
                    채번 규칙 등록하기
                  </Link>
                )}
              </>
            ) : (
              <p className="text-ink">M1이 의존하는 채번 대상에 모두 활성 규칙이 있습니다.</p>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card overflow-hidden lg:col-span-2">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-bold text-ink">채번 대상별 규칙</h2>
            {admin && (
              <Link href="/numbering" className="text-xs font-semibold text-brand hover:underline">
                관리 →
              </Link>
            )}
          </header>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">대상</th>
                  <th className="th">공통 규칙</th>
                  <th className="th">품목별</th>
                  <th className="th">비고</th>
                </tr>
              </thead>
              <tbody>
                {NUMBERING_TARGETS.map((t) => {
                  const c = byTarget.get(t.code);
                  const has = !!c?.common_active;
                  return (
                    <tr key={t.code}>
                      <td className="td font-semibold">{t.label}</td>
                      <td className="td">
                        <span
                          className={`chip ${has ? 'bg-ok-bg text-ok' : 'bg-canvas text-faint'}`}
                        >
                          {has ? '있음' : '없음'}
                        </span>
                      </td>
                      <td className="td tnum text-muted">{c?.item_active ?? 0}</td>
                      <td className="td font-mono text-xs text-faint">{t.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card overflow-hidden">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-bold text-ink">계정</h2>
            {admin && (
              <Link href="/users" className="text-xs font-semibold text-brand hover:underline">
                관리 →
              </Link>
            )}
          </header>
          <div className="grid grid-cols-2 gap-px bg-line">
            <Stat label="활성" value={data.accounts?.active ?? 0} />
            <Stat label="비활성" value={data.accounts?.inactive ?? 0} />
            <Stat label="개발 계정" value={data.accounts?.dev ?? 0} />
            <Stat label="로그인 불가" value={data.accounts?.nologin ?? 0} hint="QP 등" />
          </div>
          <div className="border-t border-line px-4 py-3">
            <p className="label">역할 부여 현황</p>
            <div className="flex flex-wrap gap-1.5">
              {data.roles.length === 0 && <span className="text-xs text-faint">없음</span>}
              {data.roles.map((r) => (
                <span key={r.role} className="chip bg-brand-soft text-brand">
                  {ROLE_LABEL[r.role]} {r.n}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="card overflow-hidden">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-bold text-ink">
            최근 감사추적
            <span className="ml-2 text-xs font-normal tnum text-muted">
              전체 {data.auditTotal ?? 0}건
            </span>
          </h2>
          {hasRole(user, 'SYS_ADMIN', 'PROD_MGR') && (
            <Link href="/audit" className="text-xs font-semibold text-brand hover:underline">
              전체 보기 →
            </Link>
          )}
        </header>
        {data.recent.length === 0 ? (
          <p className="px-4 py-6 text-sm text-faint">기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">일시</th>
                  <th className="th">표</th>
                  <th className="th">작업</th>
                  <th className="th">수행자</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={i}>
                    <td className="td tnum text-muted">{fmtDateTime(r.acted_at)}</td>
                    <td className="td font-mono text-xs">{r.table_name}</td>
                    <td className="td"><ActionChip action={r.action} /></td>
                    <td className="td">{r.actor_name ?? <span className="text-faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tnum text-ink">{value}</div>
      {hint && <div className="text-xs text-faint">{hint}</div>}
    </div>
  );
}
