import Link from 'next/link';
import { requireUser, hasRole } from '@/lib/session';
import { isViewerOnly } from '@/lib/roles';
import { withUser } from '@/lib/db';
import Denied from '@/components/denied';
import { PageShell } from '@/components/shell';
import { SubNav } from '../../nav';
import { SETTINGS_NAV } from '../../sections';
import { tableLabel } from '@/lib/forms';
import Entry, { type AuditEntry } from './entry';

export const dynamic = 'force-dynamic';

/*
 * 탭 제목. 화면을 여럿 열어 견주는 일이 있으므로 (사용자 요청) 탭마다 다른
 * 이름이 붙어야 한다. 전부 "DOF DHR" 이면 탭을 여러 개 열어도 어느 것이
 * 무엇인지 알 수 없어 여는 의미가 없다.
 */
export const metadata = { title: '감사추적' };

const PER_PAGE = 50;

const ACTIONS = [
  { code: 'INSERT', label: '등록' },
  { code: 'UPDATE', label: '변경' },
  { code: 'DELETE', label: '삭제' },
];

type Search = Promise<{ table?: string; action?: string; actor?: string; page?: string }>;

export default async function AuditPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  if (!hasRole(user, 'SYS_ADMIN', 'PROD_MGR', 'VIEWER', 'QP')) {
    return <Denied what="감사추적 조회" need="시스템관리자 또는 생산관리자" />;
  }

  const sp = await searchParams;
  const table = sp.table || null;
  const action = sp.action || null;
  const actor = sp.actor || null;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const data = await withUser(user, async (db) => ({
    total: await db.val<number>(
      `select count(*)::int from audit_log a
        where ($1::text is null or a.table_name = $1)
          and ($2::text is null or a.action = $2)
          and ($3::uuid is null or a.actor_id = $3)`,
      [table, action, actor],
    ),
    entries: await db.rows<AuditEntry>(
      /*
       * 대상 칸에 uuid 앞 8자리를 찍고 있었다. 034ace74 가 무엇인지 사람은 알
       * 수 없고, 감사추적은 사람이 읽으라고 있는 화면이다.
       *
       * 남겨 둔 값 안에 사람이 아는 번호가 이미 들어 있다. 로트번호 · 배치번호 ·
       * 품목 코드 · 이름. 그것을 꺼내 보여 주고, 없을 때만 uuid 로 떨어진다.
       * 변경 기록이면 바뀌기 전 값에도 같은 번호가 있으므로 양쪽을 본다.
       */
      /*
       * 비밀 컬럼은 서버에서 떼어 낸다.
       *
       * 가리는 코드가 entry.tsx 안에만 있었다. 그건 'use client' 파일이라
       * 서버가 값을 통째로 직렬화해 브라우저로 보낸 뒤 화면에서만 덮는
       * 구조였다. 페이지 소스에 원본이 그대로 있었고, 감사추적은 열람자에게도
       * 열려 있는 화면이다 (3차 검수 결함 2).
       *
       * 0060 이 트리거 쪽에서 아예 담지 않게 했으므로 앞으로 쌓이는 행에는
       * 값이 없다. 그 전에 쌓인 행은 audit_log 를 고칠 수 없어 그대로 있는데,
       * 여기서 떼어 내면 화면으로는 나가지 않는다.
       */
      `select a.id::text as id, a.table_name, a.record_id::text as record_id, a.action,
              a.acted_at, a.reason, u.full_name as actor_name,
              audit_redact(a.old_value, a.table_name) as old_value,
              audit_redact(a.new_value, a.table_name) as new_value,
              coalesce(
                a.new_value->>'lot_no',      a.old_value->>'lot_no',
                a.new_value->>'batch_no',    a.old_value->>'batch_no',
                a.new_value->>'wo_no',       a.old_value->>'wo_no',
                a.new_value->>'po_no',       a.old_value->>'po_no',
                a.new_value->>'code',        a.old_value->>'code',
                a.new_value->>'coa_no',      a.old_value->>'coa_no',
                a.new_value->>'login_code',  a.old_value->>'login_code',
                a.new_value->>'full_name',   a.old_value->>'full_name',
                a.new_value->>'name',        a.old_value->>'name',
                -- 제 번호가 없는 표(인쇄 · 잠금 · 공정 기록 · 자재 투입 · 재고
                -- 증감)는 가리키는 쪽의 번호를 따라간다. 그게 사람이 아는 값이다
                (select wo.batch_no from work_order wo
                  where wo.id = coalesce(a.new_value->>'work_order_id',
                                         a.old_value->>'work_order_id')::uuid),
                (select pl.lot_no from product_lot pl
                  where pl.id = coalesce(a.new_value->>'product_lot_id',
                                         a.old_value->>'product_lot_id')::uuid),
                (select ml.lot_no from material_lot ml
                  where ml.id = coalesce(a.new_value->>'material_lot_id',
                                         a.old_value->>'material_lot_id')::uuid),
                (select wo.batch_no from process_record pr
                   join work_order wo on wo.id = pr.work_order_id
                  where pr.id = coalesce(a.new_value->>'process_record_id',
                                         a.old_value->>'process_record_id')::uuid)
              ) as label
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
      /*
       * 화면에는 한글 이름이 뜨는데 목록은 영문 순으로 늘어서 있었다. 자재
       * 로트가 '자'가 아니라 'm' 자리에 있으면 눈으로 찾지 못한다.
       * 정렬은 화면에서 한다 - 옮긴 말이 lib/forms.ts 에 있다.
       */
      `select distinct table_name from audit_log`,
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
    <PageShell
      section="설정"
      title="감사추적"
      lede="기록은 삭제되지 않습니다 (S03). 등록 · 변경 · 역할 회수가 모두 이전 값과 함께 남으며, 이 기록 자체도 수정하거나 지울 수 없습니다."
      /* 열람자에게는 설정 하위 메뉴를 보이지 않는다. 들어갈 수 없는 곳이다 */
      nav={isViewerOnly(user.roles) ? undefined : <SubNav items={SETTINGS_NAV} />}
    >

      {/* ---------------------------------------------------------------------
          거르개

          표가 스물넷이라 조각으로 늘어놓으니 세 줄짜리 벽이 되고, 스물넷이 전부
          같은 무게라 눈이 걸릴 데가 없었다. 표는 고르는 것이지 훑는 것이 아니므로
          목록에서 고르게 한다. 자바스크립트 없이 폼 제출로 넘긴다.

          작업과 수행자는 서넛뿐이라 조각 그대로 둔다. 지금 무엇으로 걸러 보고
          있는지가 한눈에 보이는 편이 낫다.
      --------------------------------------------------------------------- */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <form className="flex items-center gap-2">
          {action && <input type="hidden" name="action" value={action} />}
          {actor && <input type="hidden" name="actor" value={actor} />}
          <label htmlFor="tbl" className="text-[0.6875rem] font-bold tracking-wide text-muted">
            표
          </label>
          <select id="tbl" name="table" defaultValue={table ?? ''}
                  className="input h-8 w-44 text-xs">
            <option value="">전체</option>
            {[...data.tables].sort((a, b) =>
              tableLabel(a.table_name).localeCompare(tableLabel(b.table_name), 'ko')
            ).map((t) => (
              <option key={t.table_name} value={t.table_name}>
                {tableLabel(t.table_name)}
              </option>
            ))}
          </select>
          <button className="btn-ghost h-8 px-3 text-xs">보기</button>
        </form>
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
    </PageShell>
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
