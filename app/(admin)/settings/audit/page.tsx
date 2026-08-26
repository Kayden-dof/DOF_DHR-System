import Link from 'next/link';
import { requireUser, hasRole } from '@/lib/session';
import { withActor } from '@/lib/db';
import Denied from '@/components/denied';
import { tableLabel } from '@/lib/forms';
import Entry, { type AuditEntry } from './entry';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

const ACTIONS = [
  { code: 'INSERT', label: '등록' },
  { code: 'UPDATE', label: '변경' },
  { code: 'DELETE', label: '삭제' },
];

type Search = Promise<{ table?: string; action?: string; actor?: string; page?: string }>;

export default async function AuditPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR')) {
    return <Denied what="감사추적 조회" need="시스템관리자 또는 생산관리자" />;
  }

  const sp = await searchParams;
  const table = sp.table || null;
  const action = sp.action || null;
  const actor = sp.actor || null;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const data = await withActor(user.id, async (db) => ({
    total: await db.val<number>(
      `select count(*)::int from audit_log a
        where ($1::text is null or a.table_name = $1)
          and ($2::text is null or a.action = $2)
          and ($3::uuid is null or a.actor_id = $3)`,
      [table, action, actor],
    ),
    entries: await db.rows<AuditEntry>(
      `select a.id::text as id, a.table_name, a.record_id::text as record_id, a.action,
              a.acted_at, a.old_value, a.new_value, u.full_name as actor_name
         from audit_log a
         left join app_user u on u.id = a.actor_id
        where ($1::text is null or a.table_name = $1)
          and ($2::text is null or a.action = $2)
          and ($3::uuid is null or a.actor_id = $3)
        order by a.id desc
        limit $4 offset $5`,
      [table, action, actor, PER_PAGE, (page - 1) * PER_PAGE],
    ),
    tables: await db.rows<{ table_name: string }>(
      `select distinct table_name from audit_log order by table_name`,
    ),
    actors: await db.rows<{ id: string; full_name: string }>(
      `select distinct u.id, u.full_name
         from audit_log a join app_user u on u.id = a.actor_id
        order by u.full_name`,
    ),
  }));

  const total = data.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { table, action, actor, page, ...over };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== null && v !== undefined && v !== '' && !(k === 'page' && v === 1)) {
        p.set(k, String(v));
      }
    }
    const s = p.toString();
    return s ? `/settings/audit?${s}` : '/settings/audit';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-bold text-ink">감사추적</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
          기록은 삭제되지 않습니다 (S03). 등록 · 변경 · 역할 회수가 모두 이전 값과 함께 남으며,
          이 기록 자체도 수정하거나 지울 수 없습니다.
        </p>
      </div>

      {/* 필터 --------------------------------------------------------------- */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <Filters
          label="표"
          current={table}
          all="전체"
          base={(v) => qs({ table: v, page: 1 })}
          options={data.tables.map((t) => ({
            code: t.table_name,
            label: tableLabel(t.table_name),
          }))}
        />
        <span className="h-5 w-px bg-line" />
        <Filters
          label="작업"
          current={action}
          all="전체"
          base={(v) => qs({ action: v, page: 1 })}
          options={ACTIONS.map((a) => ({ code: a.code, label: a.label }))}
        />
        {data.actors.length > 0 && (
          <>
            <span className="h-5 w-px bg-line" />
            <Filters
              label="수행자"
              current={actor}
              all="전체"
              base={(v) => qs({ actor: v, page: 1 })}
              options={data.actors.map((a) => ({ code: a.id, label: a.full_name }))}
            />
          </>
        )}
        <span className="ml-auto text-xs tnum text-muted">
          {total}건 · {page}/{pages} 쪽
        </span>
      </div>

      {/* 목록 --------------------------------------------------------------- */}
      <div className="card overflow-hidden">
        {data.entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-faint">해당하는 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">일시</th>
                  <th className="th">표</th>
                  <th className="th">작업</th>
                  <th className="th">대상</th>
                  <th className="th">수행자</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <Entry key={e.id} e={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 && (
            <Link href={qs({ page: page - 1 })} className="btn-ghost h-9 px-3 text-xs">
              이전
            </Link>
          )}
          <span className="text-xs tnum text-muted">
            {page} / {pages}
          </span>
          {page < pages && (
            <Link href={qs({ page: page + 1 })} className="btn-ghost h-9 px-3 text-xs">
              다음
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Filters({
  label, current, all, options, base,
}: {
  label: string;
  current: string | null;
  all: string;
  options: { code: string; label: string }[];
  base: (v: string | undefined) => string;
}) {
  return (
    // 표 이름이 20종 넘는다. 한 줄에 밀어 넣으면 오른쪽이 잘려 안 보이는 거르개가
    // 생긴다. 줄바꿈해서 전부 보이게 둔다.
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-10 shrink-0 text-[0.6875rem] font-bold tracking-wide text-muted">
        {label}
      </span>
      <Link
        href={base(undefined)}
        className={`chip ${!current
          ? 'bg-brand text-white'
          : 'bg-surface-sub text-muted ring-1 ring-line hover:text-ink'}`}
      >
        {all}
      </Link>
      {options.map((o) => (
        <Link
          key={o.code}
          href={base(o.code)}
          className={`chip ${current === o.code
            ? 'bg-brand text-white'
            : 'bg-surface-sub text-muted ring-1 ring-line hover:text-ink'}`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
